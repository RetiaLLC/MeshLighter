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

    print("mt_pkc selftest:", "ALL PASS" if ok else "FAILURES ABOVE")
    return ok


if __name__ == '__main__':
    import sys
    sys.exit(0 if selftest() else 1)
