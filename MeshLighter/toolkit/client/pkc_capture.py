#!/usr/bin/env python3
"""pkc_capture.py — PASSIVE (RX-only) capture of Meshtastic PKC / DM traffic, with
optional decryption when you hold the recipient's private key.

This never transmits. It puts the radio-pipe into promiscuous sniff and reports
every directed (non-broadcast) packet whose channel-hash is 0 — the over-air
marker for a public-key DM (meshtastic-firmware Router.cpp: `p->channel == 0 &&
isToUs(p) && !isBroadcast(p->to)` -> decryptCurve25519). Even without keys this
surfaces the PKC metadata vector: who is DMing whom, when, and how big.

Over-air DMs do NOT carry the sender's public key (the receiver looks it up from
its NodeDB); supply sender pubkeys with --peer, and the recipient private key
with --my-priv/--my-num, to decrypt.

  # passive recon only (no keys) — list PKC DMs as they pass:
  pkc_capture.py <port>

  # decrypt DMs addressed to a node whose private key you hold (path-a export):
  pkc_capture.py <port> --my-num 0x2e4cfec --my-priv <64hex> \
                        --peer 0x2e4bba4:<64hex_pubkey> [--peer ...]

  # or load a {nodenum_hex: pubkey_hex} map and the private key from JSON:
  pkc_capture.py <port> --my-num 0x2e4cfec --my-priv <64hex> --keys peers.json

<port> = /dev/ttyACM* or a USB serial (e.g. 3C0F02E4BBA4). Meshtastic US sync = 0x2B.
"""
import sys, os, time, glob, json, subprocess, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mt_radio_serial import mt_radio_serial
from mt_lite import mt_lite
import mt_pkc

BROADCAST = 0xFFFFFFFF

def portfor(a):
    if a.startswith('/dev/'): return a
    a = a.replace(':', '').upper()
    for p in glob.glob('/dev/ttyACM*'):
        out = subprocess.run(['udevadm','info','-q','property','-n',p],
                             capture_output=True, text=True).stdout
        if a in out.replace(':','').upper(): return p
    return a

def parse_peer(s):
    num, _, pub = s.partition(':')
    return int(num, 16), bytes.fromhex(pub)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('port')
    ap.add_argument('--my-num', help='recipient node number (hex) whose DMs to decrypt')
    ap.add_argument('--my-priv', help='recipient X25519 private key (64 hex)')
    ap.add_argument('--peer', action='append', default=[], help='sendernum_hex:pubkey_hex')
    ap.add_argument('--keys', help='JSON {nodenum_hex: pubkey_hex} of sender pubkeys')
    ap.add_argument('--sync', default='2b', help='LoRa sync word hex (2b=Meshtastic, default)')
    ap.add_argument('--secs', type=float, default=0, help='capture window (0 = until Ctrl-C)')
    args = ap.parse_args()

    my_num  = int(args.my_num, 16) if args.my_num else None
    my_priv = bytes.fromhex(args.my_priv) if args.my_priv else None
    peers = {}
    for p in args.peer:
        n, pub = parse_peer(p); peers[n] = pub
    if args.keys:
        with open(args.keys) as f:
            for k, v in json.load(f).items():
                peers[int(k, 16)] = bytes.fromhex(v)
    can_decrypt = my_priv is not None and my_num is not None

    r = mt_radio_serial(portfor(args.port)); time.sleep(1.5)
    m = mt_lite(r)
    m.set_sniff(sync=int(args.sync, 16), crc=True)   # Meshtastic TX includes CRC
    m.apply_live()
    print("PASSIVE PKC capture — sync 0x%s%s. Ctrl-C to stop.\n" % (
        args.sync, "" if not can_decrypt else "  (decrypting DMs to 0x%x)" % my_num))
    print("  %-10s %-10s %-6s %5s  %s" % ("FROM", "TO", "bytes", "rssi", "note"))

    seen = set(); t0 = time.time()
    try:
        while args.secs == 0 or time.time() - t0 < args.secs:
            m.update()
            pkt = m.get()
            if pkt is None:
                time.sleep(0.003); continue
            # PKC DM over-air marker: channel-hash 0 + directed (non-broadcast) + not channel-decoded
            is_pkc = (getattr(pkt, 'hash', None) == 0 and pkt.dest != BROADCAST
                      and pkt.dest != 0 and not getattr(pkt, 'decrypted', False))
            if not is_pkc:
                continue
            wire = bytes(pkt.payload) if not isinstance(pkt.payload, dict) else b''
            key = (pkt.src, pkt.seq)
            if key in seen:
                continue
            seen.add(key)
            note = "PKC DM (%dB enc)" % len(wire)
            if can_decrypt and pkt.dest == my_num and pkt.src in peers:
                try:
                    pt = mt_pkc.decrypt_dm(my_priv, peers[pkt.src], pkt.src, pkt.seq, wire)
                    txt = _as_text(pt)
                    note = "DECRYPTED: %s" % txt
                except Exception as e:
                    note = "decrypt FAILED (%s)" % e.__class__.__name__
            elif can_decrypt and pkt.dest == my_num and pkt.src not in peers:
                note += "  [need --peer 0x%x:<pubkey>]" % pkt.src
            print("  0x%08x 0x%08x %5dB  %4d  %s" % (pkt.src, pkt.dest, len(wire),
                                                     getattr(pkt, 'rssi', 0), note))
    except KeyboardInterrupt:
        pass
    print("\n%d unique PKC DM(s) observed." % len(seen))

def _as_text(pt):
    # A decrypted DM payload is a Data protobuf; portnum 1 (TEXT) carries UTF-8 in field 2.
    try:
        import pypb
        d = pypb.protobuf(pt).to_map()
        if d.get(1) == 1 and isinstance(d.get(2), (bytes, bytearray)):
            return d[2].decode('utf-8', 'replace')
        return "portnum=%s payload=%s" % (d.get(1), (d.get(2) or b'').hex())
    except Exception:
        return pt.hex()

if __name__ == '__main__':
    main()
