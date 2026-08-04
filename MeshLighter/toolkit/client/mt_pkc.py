#!/usr/bin/env python3
"""mt_pkc.py — Meshtastic PKC (public-key / DM) encrypt + decrypt.

VALIDATED against the firmware source: this implements meshtastic-firmware
src/mesh/CryptoEngine.cpp encryptCurve25519 / decryptCurve25519 exactly.

Algorithm (from CryptoEngine.cpp, verified 2026-08-03):
  shared   = X25519(my_private, their_public)                 # 32-byte ECDH secret
  key      = SHA256(shared)                                   # AES-256 key  (CryptoEngine::hash)
  nonce    = packetId(4 LE) | extraNonce(4 LE) | fromNode(4 LE) | 0x00   # 13 bytes, initNonce()
  cipher   = AES-256-CCM, 8-byte auth tag, no AAD             # aes_ccm_ae(key,32, nonce,8, ...)
  wire     = ciphertext || tag(8) || extraNonce(4 LE)         # what rides in MeshPacket.encrypted

hostap's aes_ccm (L=2, M=8, 13-byte nonce) is standard RFC-3610 CCM, so
cryptography's AESCCM(key, tag_length=8) with a 13-byte nonce is byte-compatible
and interoperates with real Meshtastic PKC DMs. selftest() proves the full
round-trip deterministically (A->B encrypt, B decrypt) with no hardware.
"""
import hashlib
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESCCM

PKC_OVERHEAD = 12   # 8-byte CCM tag + 4-byte extraNonce appended to every PKC payload


def shared_secret(my_priv_bytes, their_pub_bytes):
    priv = X25519PrivateKey.from_private_bytes(bytes(my_priv_bytes))
    pub  = X25519PublicKey.from_public_bytes(bytes(their_pub_bytes))
    return priv.exchange(pub)                       # 32-byte X25519 shared secret


def pkc_key(my_priv_bytes, their_pub_bytes):
    """AES-256 key = SHA256(X25519 shared secret) — CryptoEngine::hash(shared_key, 32)."""
    return hashlib.sha256(shared_secret(my_priv_bytes, their_pub_bytes)).digest()


def _nonce(packet_id, from_node, extra_nonce):
    # initNonce(fromNode, packetId, extraNonce): packetId low32 @0, extraNonce @4, fromNode @8.
    n = bytearray(13)
    n[0:4]  = (packet_id   & 0xffffffff).to_bytes(4, 'little')
    n[4:8]  = (extra_nonce & 0xffffffff).to_bytes(4, 'little')
    n[8:12] = (from_node   & 0xffffffff).to_bytes(4, 'little')
    return bytes(n)


def encrypt_dm(my_priv, their_pub, from_node, packet_id, plaintext, extra_nonce):
    """Build a PKC MeshPacket.encrypted payload: ciphertext || tag(8) || extraNonce(4 LE).

    from_node = the SENDER's node number; their_pub = the RECIPIENT's public key.
    extra_nonce is a 32-bit value (firmware uses random()); pass one in for determinism.
    """
    key = pkc_key(my_priv, their_pub)
    ct_tag = AESCCM(key, tag_length=8).encrypt(
        _nonce(packet_id, from_node, extra_nonce), bytes(plaintext), None)
    return ct_tag + (extra_nonce & 0xffffffff).to_bytes(4, 'little')


def decrypt_dm(my_priv, their_pub, from_node, packet_id, wire):
    """Decrypt a PKC MeshPacket.encrypted payload.

    from_node = the SENDER's node number; their_pub = the SENDER's public key
    (as the recipient sees it); my_priv = the recipient's private key. `wire` is the
    full encrypted field: ciphertext || tag(8) || extraNonce(4 LE).
    """
    wire = bytes(wire)
    if len(wire) < PKC_OVERHEAD:
        raise ValueError("PKC payload too short (%d < %d)" % (len(wire), PKC_OVERHEAD))
    extra_nonce = int.from_bytes(wire[-4:], 'little')       # last 4 bytes
    ct_tag      = wire[:-4]                                 # ciphertext || tag(8)
    key = pkc_key(my_priv, their_pub)
    return AESCCM(key, tag_length=8).decrypt(
        _nonce(packet_id, from_node, extra_nonce), ct_tag, None)


# --- MeshPacket wire helpers -------------------------------------------------
# PKC MeshPacket fields (meshtastic/mesh.proto): from=1(fx32) to=2(fx32)
# channel=3 encrypted=5(bytes) id=6(fx32) public_key=16(bytes,sender) pki_encrypted=17(bool)

def _read_varint(b, o):
    n = sh = 0
    while True:
        n |= (b[o] & 0x7f) << sh; sh += 7
        last = b[o] < 0x80; o += 1
        if last:
            return n, o

def _uv(n):                             # bare varint
    out = b''
    while n > 0x7f:
        out += bytes([0x80 | (n & 0x7f)]); n >>= 7
    return out + bytes([n])

def _tag(idx, wt):                      # field tag (fields >=16 are multi-byte)
    return _uv((idx << 3) | wt)

def _fx32(idx, v):                      # fixed32 field
    return _tag(idx, 5) + (v & 0xffffffff).to_bytes(4, 'little')

def _ld(idx, b):                        # length-delimited (bytes) field
    return _tag(idx, 2) + _uv(len(b)) + bytes(b)

def _vf(idx, n):                        # varint field
    return _tag(idx, 0) + _uv(n)

def parse_meshpacket(mp):
    """Parse a raw MeshPacket into the fields PKC decrypt needs."""
    b = bytes(mp); o = 0; out = {}
    while o < len(b):
        tag, o = _read_varint(b, o); idx, wt = tag >> 3, tag & 7
        if   wt == 0: out[idx], o = _read_varint(b, o)
        elif wt == 5: out[idx] = int.from_bytes(b[o:o+4], 'little'); o += 4
        elif wt == 1: out[idx] = int.from_bytes(b[o:o+8], 'little'); o += 8
        elif wt == 2:
            ln, o = _read_varint(b, o); out[idx] = b[o:o+ln]; o += ln
        else: break
    return {'from': out.get(1), 'to': out.get(2), 'channel': out.get(3),
            'encrypted': out.get(5), 'id': out.get(6),
            'public_key': out.get(16), 'pki_encrypted': bool(out.get(17))}

def decrypt_meshpacket(my_priv, mp, sender_pub=None):
    """Decrypt a captured PKC MeshPacket. sender_pub defaults to the packet's own
    public_key (field 16); supply it if the sender omitted it. Returns (plaintext, fields)."""
    f = parse_meshpacket(mp)
    pub = sender_pub if sender_pub is not None else f['public_key']
    if pub is None:
        raise ValueError("no sender public key (field 16 absent and none supplied)")
    if not f['encrypted']:
        raise ValueError("MeshPacket has no encrypted payload (field 5)")
    return decrypt_dm(my_priv, pub, f['from'], f['id'], f['encrypted']), f

def build_pkc_meshpacket(my_priv, my_pub, my_num, their_pub, their_num, packet_id,
                         plaintext, extra_nonce, want_ack=True, include_pubkey=True):
    """Build a PKC DM MeshPacket that a real node can decrypt (AUTHORIZED-TX path).
    my_pub is embedded as field 16 so the recipient can derive the shared secret."""
    enc = encrypt_dm(my_priv, their_pub, my_num, packet_id, plaintext, extra_nonce)
    p  = _fx32(1, my_num)                 # from
    p += _fx32(2, their_num)              # to
    p += _ld(5, enc)                      # encrypted = ciphertext|tag(8)|extraNonce(4)
    p += _fx32(6, packet_id)              # id
    if include_pubkey:
        p += _ld(16, my_pub)              # public_key (sender's)
    if want_ack:
        p += _vf(10, 1)                   # want_ack
    p += _vf(17, 1)                       # pki_encrypted = true
    return p


def selftest():
    ok = True
    a = X25519PrivateKey.generate(); b = X25519PrivateKey.generate()
    apub = a.public_key().public_bytes_raw(); bpub = b.public_key().public_bytes_raw()
    apriv = a.private_bytes_raw();            bpriv = b.private_bytes_raw()

    # 1. shared-secret symmetry (X25519 property the whole scheme rests on)
    s1 = shared_secret(apriv, bpub); s2 = shared_secret(bpriv, apub)
    p = (s1 == s2); ok &= p
    print("PKC X25519 shared-secret symmetry:", "PASS" if p else "FAIL")

    # 2. key = SHA256(shared), not raw secret
    p = (pkc_key(apriv, bpub) == hashlib.sha256(s1).digest()); ok &= p
    print("PKC key = SHA256(shared):        ", "PASS" if p else "FAIL")

    # 3. full round-trip: A encrypts a DM to B, B decrypts it (the real firmware path)
    from_node, pid, extra = 0x11223344, 0x55667788, 0xAABBCCDD
    msg = b'\x08\x01\x12\x0bsecret DM!!'           # a plausible Data-portnum payload
    wire = encrypt_dm(apriv, bpub, from_node, pid, msg, extra)
    pt   = decrypt_dm(bpriv, apub, from_node, pid, wire)
    p = (pt == msg); ok &= p
    print("PKC A->B encrypt / B decrypt:    ", "PASS" if p else "FAIL")

    # 4. wire overhead is exactly 12 bytes (8 tag + 4 extraNonce)
    p = (len(wire) - len(msg) == PKC_OVERHEAD); ok &= p
    print("PKC wire overhead == 12 bytes:   ", "PASS" if p else "FAIL",
          "(%d)" % (len(wire) - len(msg)))

    # 5. extraNonce round-trips through the wire tail
    p = (int.from_bytes(wire[-4:], 'little') == extra); ok &= p
    print("PKC extraNonce carried on wire:  ", "PASS" if p else "FAIL")

    # 6. auth check: a wrong packet_id (=> wrong nonce) must fail the CCM tag
    try:
        decrypt_dm(bpriv, apub, from_node, pid ^ 1, wire)
        print("PKC auth rejects wrong nonce:    ", "FAIL (decrypted anyway)"); ok = False
    except Exception:
        print("PKC auth rejects wrong nonce:    ", "PASS")

    # 7. full MeshPacket wire round-trip: A builds a PKC DM MeshPacket to B,
    #    B parses + decrypts using only my_priv + the embedded sender public_key.
    a_num, b_num = 0x02e4bba4, 0x02e4cfec
    mp = build_pkc_meshpacket(apriv, apub, a_num, bpub, b_num, pid, msg, extra)
    f = parse_meshpacket(mp)
    p = (f['from'] == a_num and f['to'] == b_num and f['id'] == pid
         and f['pki_encrypted'] and f['public_key'] == apub); ok &= p
    print("PKC MeshPacket parse fields:     ", "PASS" if p else "FAIL")
    pt2, _ = decrypt_meshpacket(bpriv, mp)     # sender_pub taken from embedded field 16
    p = (pt2 == msg); ok &= p
    print("PKC MeshPacket build->decrypt:   ", "PASS" if p else "FAIL")

    print("mt_pkc selftest:", "ALL PASS" if ok else "FAILURES ABOVE")
    return ok


if __name__ == '__main__':
    import sys
    sys.exit(0 if selftest() else 1)
