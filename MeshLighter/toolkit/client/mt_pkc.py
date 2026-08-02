#!/usr/bin/env python3
"""mt_pkc.py — Meshtastic PKC (public-key / DM) decrypt.

STATUS: X25519 shared-secret derivation is standard and self-tested (symmetry);
the AES-CCM key/nonce LAYOUT follows Meshtastic's CryptoEngine as understood and is
marked BEST-EFFORT / UNVALIDATED until checked against a real captured PKC DM plus
the recipient's private key (neither is available on the bench). Do not rely on the
decrypt output until that validation is done.
"""
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESCCM

def shared_secret(my_priv_bytes, their_pub_bytes):
    priv = X25519PrivateKey.from_private_bytes(bytes(my_priv_bytes))
    pub  = X25519PublicKey.from_public_bytes(bytes(their_pub_bytes))
    return priv.exchange(pub)                       # 32-byte X25519 shared secret

def _nonce(packet_id, from_node, extra_nonce):
    # BEST-EFFORT layout: packetId(4 LE) | fromNode(4 LE) | extraNonce(4 LE) | 0
    n = bytearray(13)
    n[0:4]  = (packet_id   & 0xffffffff).to_bytes(4, 'little')
    n[4:8]  = (from_node   & 0xffffffff).to_bytes(4, 'little')
    n[8:12] = (extra_nonce & 0xffffffff).to_bytes(4, 'little')
    return bytes(n)

def decrypt_dm(my_priv, their_pub, packet_id, from_node, extra_nonce, ciphertext_with_tag):
    """UNVALIDATED. ciphertext_with_tag = encrypted payload + 8-byte CCM auth tag."""
    key = shared_secret(my_priv, their_pub)         # AES-256 key = raw shared secret
    ccm = AESCCM(key, tag_length=8)
    return ccm.decrypt(_nonce(packet_id, from_node, extra_nonce), bytes(ciphertext_with_tag), None)

def selftest():
    a = X25519PrivateKey.generate(); b = X25519PrivateKey.generate()
    apub = a.public_key().public_bytes_raw(); bpub = b.public_key().public_bytes_raw()
    apriv = a.private_bytes_raw();            bpriv = b.private_bytes_raw()
    s1 = shared_secret(apriv, bpub); s2 = shared_secret(bpriv, apub)
    print("PKC X25519 shared-secret symmetry:", "PASS" if s1 == s2 else "FAIL")
    ccm = AESCCM(s1, tag_length=8); n = _nonce(0x1234, 0xdeadbeef, 0x11)
    ct = ccm.encrypt(n, b'hello DM', None); pt = ccm.decrypt(n, ct, None)
    print("PKC AES-CCM round-trip:", "PASS" if pt == b'hello DM' else "FAIL")
    print("NOTE: Meshtastic key/nonce layout is BEST-EFFORT / UNVALIDATED "
          "(needs a real PKC DM + recipient private key to confirm).")

if __name__ == '__main__':
    selftest()
