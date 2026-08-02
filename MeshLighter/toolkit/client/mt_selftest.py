#!/usr/bin/env python3
"""mt_selftest.py — self-consistency + interop tests for the MeshLighter crypto.

Run:  PYTHONPATH=. python3 mt_selftest.py     (exit 0 = all pass)

Purpose: catch the class of bug that shipped in this toolkit — an AES-CTR nonce
with fromNode at the wrong byte offset, which made every injected packet get
rejected by real Meshtastic nodes ("bad psk"). A 2-second test beats a bench.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mt_crypto, mt_packet, mt_channel, pypb

CH = mt_channel.channel('LongFast', 1)          # default LongFast PSK

# Known-answer keystream for (seq=0x01020304, src=0xA1A2A3A4) under the LongFast
# key with the CORRECT Meshtastic nonce layout  id(4) | 0(4) | from(4) | 0(4).
KAT_KEYSTREAM       = '35512633a4602f1a5a8747ce6dd26fb8'
# The OLD buggy layout (fromNode at bytes [4:8]) produced this — must NOT match.
KAT_KEYSTREAM_BUGGY = 'd226af17f7af5f9a711a5ec381ce8127'
# A real over-air Meshtastic POSITION packet (portnum 3) captured on the bench;
# it must decrypt to a valid portnum with the correct crypto.
KAT_REAL_PACKET_HEX = 'ffffffff14ce83690aba3927e008003c6ae3664164272755dc0af96249ca03f679c3fe786205d2b431f3860b0083df2e50'

fails = []
def check(name, ok):
    print(('  PASS ' if ok else '  FAIL ') + name)
    if not ok: fails.append(name)

def keystream(seq, src):
    p = mt_packet.mt_packet(); p.decrypted = True
    p.seq = seq; p.src = src; p.payload = bytes(16)
    mt_crypto.encrypt_packet(p, CH.key)
    return p.payload

# 1. AES-CTR is symmetric: encrypt then encrypt == identity
plain = bytes(range(48))
p = mt_packet.mt_packet(); p.decrypted = True
p.seq = 0x11223344; p.src = 0xDEADBEEF; p.payload = plain
mt_crypto.encrypt_packet(p, CH.key); ct = p.payload
mt_crypto.encrypt_packet(p, CH.key)
check('AES-CTR round-trip is identity', p.payload == plain)
check('ciphertext != plaintext', ct != plain)

# 2. Nonce-layout known-answer — the exact regression guard for the nonce bug
ks = keystream(0x01020304, 0xA1A2A3A4).hex()
check('keystream matches Meshtastic nonce layout (KAT)', ks == KAT_KEYSTREAM)
check('guard is meaningful (differs from the buggy layout)', ks != KAT_KEYSTREAM_BUGGY)

# 3. Channel hash for the default LongFast channel
check('LongFast channel hash == 0x08', CH.getHash() == 0x08)

# 4. Interop: a real captured Meshtastic packet must decrypt to a valid portnum
if KAT_REAL_PACKET_HEX:
    mp = mt_packet.mt_packet(bytes.fromhex(KAT_REAL_PACKET_HEX))
    mt_crypto.encrypt_packet(mp, CH.key)
    try: dec = pypb.protobuf(mp.payload).to_map()
    except Exception: dec = {}
    check('real over-air packet decrypts to a valid portnum', dec.get(1) in (1,3,4,67,71,73))
else:
    print('  SKIP real-over-air interop (set KAT_REAL_PACKET_HEX from capture_kat.py)')

print()
print('mt_selftest:', 'ALL PASS' if not fails else ('FAILED -> ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
