#!/usr/bin/env python3
"""radio_ctl.py — drive the radio-pipe's runtime controls (all no-reboot).

  radio_ctl.py <port> scan [start_mhz end_mhz step_khz dwell_ms]  # spectrum sweep
  radio_ctl.py <port> freq <mhz>                                  # live channel change
  radio_ctl.py <port> power <dbm>                                 # live TX power
  radio_ctl.py <port> sniff <sync_hex> [crc0|crc1]                # promiscuous sniff
  radio_ctl.py <port> private [mhz]                               # move to a private freq
  radio_ctl.py <port> monitor [secs]                              # RX w/ rssi/snr/time

<port> may be a /dev/ttyACM* path or a USB serial (e.g. 3C0F02E4BBA4).
"""
import sys, os, time, struct, glob, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mt_radio_serial import mt_radio_serial
from mt_lite import mt_lite

def portfor(a):
    if a.startswith('/dev/'): return a
    a = a.replace(':', '').upper()
    for p in glob.glob('/dev/ttyACM*'):
        out = subprocess.run(['udevadm','info','-q','property','-n',p],capture_output=True,text=True).stdout
        if a in out.replace(':','').upper(): return p
    return a

def open_pipe(port):
    r = mt_radio_serial(port); time.sleep(1.5)   # settle any open-time reset
    return r, mt_lite(r)

def cmd_scan(m, a):
    s = int(float(a[0])*1000) if len(a)>0 else 902000
    e = int(float(a[1])*1000) if len(a)>1 else 928000
    step = int(a[2]) if len(a)>2 else 250
    dwell = int(a[3]) if len(a)>3 else 25
    print(f"scanning {s/1000:.1f}-{e/1000:.1f} MHz, step {step} kHz, dwell {dwell} ms ...")
    res = m.scan(s, e, step, dwell)
    res.sort(key=lambda x: -x[1])
    print(f"{len(res)} channels sampled; strongest:")
    for f, r in res[:14]:
        bars = '#' * max(0, (r + 135) // 3)
        print(f"  {f/1000:8.3f} MHz  {r:4d} dBm  {bars}")

def cmd_freq(m, a, save=True):
    mhz = float(a[0]); m.set_config('freq', struct.pack('<f', mhz))
    if save: m.save_config()
    time.sleep(0.3); m.apply_live()
    print(f"freq -> {mhz} MHz (applied live)")

def cmd_power(m, a):
    dbm = int(a[0]); m.set_config('power', bytes([dbm & 0xff])); m.save_config()
    time.sleep(0.3); m.apply_live()
    print(f"power -> {dbm} dBm (applied live)")

def cmd_sniff(m, a):
    sync = int(a[0], 16) if len(a)>0 else 0x12
    crc = (len(a) > 1 and a[1] == 'crc1')
    m.set_sniff(sync, crc)
    print(f"promiscuous sniff: sync=0x{sync:02x} crc={crc}  (0x2B=Meshtastic, 0x12=generic)")

def cmd_private(m, a):
    mhz = float(a[0]) if len(a)>0 else 913.0
    cmd_freq(m, [str(mhz)])
    print(f"PRIVATE demo channel: injector is now on {mhz} MHz, off the public LongFast slot.")
    print("Set your demo/target nodes to the same frequency (Meshtastic: LoRa > override freq).")

def cmd_monitor(m, a):
    secs = int(a[0]) if len(a)>0 else 30
    print(f"monitoring RX for {secs}s ...")
    t = time.time(); n = 0
    while time.time() - t < secs:
        m.update(); pkt = m.get()
        if pkt is not None:
            pn = pkt.payload.get(1) if (getattr(pkt,'decrypted',False) and isinstance(pkt.payload,dict)) else None
            print("  RX src=%s rssi=%s snr=%.2f t=%s portnum=%s" % (
                hex(pkt.src), getattr(pkt,'rssi',0), getattr(pkt,'snr',0.0),
                getattr(pkt,'rxtime',0), pn)); n += 1
        time.sleep(0.02)
    print(f"({n} packets)")

CMDS = {'scan':cmd_scan,'freq':cmd_freq,'power':cmd_power,'sniff':cmd_sniff,
        'private':cmd_private,'monitor':cmd_monitor}

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    port = portfor(sys.argv[1]); cmd = sys.argv[2]; args = sys.argv[3:]
    r, m = open_pipe(port)
    CMDS[cmd](m, args)
