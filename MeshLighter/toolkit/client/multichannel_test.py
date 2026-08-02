#!/usr/bin/env python3
"""multichannel_test.py — prove multi-channel / multi-key decode.

Register several channels (public LongFast + a private PSK); a packet encrypted on
the private channel is auto-decoded by channel hash, with no prior knowledge of
which channel it used. Exit 0 = pass.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mt_channel, mt_crypto, mt_packet, pypb

mt_channel.channel_list.clear()
lf  = mt_channel.add_channel('LongFast', 1)                      # public
sec = mt_channel.add_channel_psk('Secret', bytes(range(1, 17)))  # private 16-byte PSK
print('registered: LongFast hash=%s  Secret hash=%s' % (hex(lf.getHash()), hex(sec.getHash())))
assert lf.getHash() != sec.getHash(), 'channel hashes collide'

def make_on(chan, longname):
    u = pypb.protobuf(); u.encode(1, pypb.PB_STRING, b'!5ec00001')
    u.encode(2, pypb.PB_STRING, longname); u.encode(5, pypb.PB_VARINT, 38)
    d = pypb.protobuf(); d.encode(1, pypb.PB_VARINT, 4)
    d.encode(2, pypb.PB_STRING, bytes(u.get_buffer()))
    p = mt_packet.mt_packet(); p.src = 0x5EC00001; p.dest = 0xffffffff
    p.payload = bytes(d.get_buffer()); p.decrypted = True
    p.hash = chan.getHash(); p.seq = 0x1000
    mt_crypto.encrypt_packet(p, chan.key); p.decrypted = False   # encrypt on this channel
    return p.to_buffer()                                          # raw over-air bytes

# an over-air packet sent on the PRIVATE channel
raw = make_on(sec, b'SecretNode')

# decode with no hint of which channel: pick by hash, decrypt, parse
mp = mt_packet.mt_packet(raw)
chan = mt_channel.get_channel_by_hash(mp.hash)      # auto-select
mt_crypto.encrypt_packet(mp, chan.key)              # decrypt
dec  = pypb.protobuf(mp.payload).to_map()
user = pypb.protobuf(dec[2]).to_map()

ok = (chan.name == 'Secret' and dec.get(1) == 4 and user.get(2) == b'SecretNode')
print('decoded on channel %r, portnum=%s, name=%r' % (chan.name, dec.get(1), user.get(2)))
print('multichannel_test:', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
