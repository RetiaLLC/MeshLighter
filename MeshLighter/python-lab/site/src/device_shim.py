# device_shim.py — the `dev` object the demos use. Async methods bridge to JS
# (device_js); packet crypto/build is pure Python (mesh). The auto-await pass in
# app.js makes dev.x() read like sync code. Keep DEVICE_METHODS (app.js) in sync.
import device_js
import mesh, time, struct

CH = mesh.channel('LongFast', 1)
def _now(): return int(time.time()) & 0xffffffff

class Device:
    def __init__(self):
        self.seq = 0x1000

    async def connect(self): await device_js.connect(); return self
    async def disconnect(self): await device_js.disconnect()
    async def sleep(self, s): await device_js.sleep(float(s))

    async def send_frame(self, data):
        await device_js.send_frame(list(int(b) & 0xff for b in data))
    async def read_frames(self, timeout=0.3, quiet=0.12):
        raw = await device_js.read_frames(float(timeout) * 1000, float(quiet) * 1000)
        return [bytes(list(f)) for f in raw]

    def _next_seq(self):
        self.seq = (self.seq + 1) & 0xffffffff; return self.seq

    # ---- config / control (built in Python, sent via the bridge) ----
    async def _cfg(self, op, extra=None):
        w = mesh.protobuf(); w.encode(1, mesh.PB_VARINT, 2); w.encode(2, mesh.PB_VARINT, op)
        for fid, t, v in (extra or []): w.encode(fid, t, v)
        await self.send_frame(w.get_buffer())

    async def set_freq(self, mhz):
        await self._cfg(1, [(3, mesh.PB_STRING, b'freq'), (4, mesh.PB_STRING, struct.pack('<f', float(mhz)))])
        await self._cfg(2); await self.sleep(0.3); await self._cfg(4)
        return 'freq -> %s MHz (live, no reboot)' % mhz

    async def set_power(self, dbm):
        await self._cfg(1, [(3, mesh.PB_STRING, b'power'), (4, mesh.PB_STRING, bytes([int(dbm) & 0xff]))])
        await self._cfg(2); await self.sleep(0.3); await self._cfg(4)
        return 'power -> %s dBm (live)' % dbm

    async def sniff(self, sync=0x12, crc=False):
        await self._cfg(5, [(3, mesh.PB_VARINT, int(sync) & 0xff), (4, mesh.PB_VARINT, 1 if crc else 0)])
        return 'promiscuous sniff: sync=0x%02x crc=%s' % (int(sync) & 0xff, bool(crc))

    async def scan(self, start_mhz=902, end_mhz=928, step_khz=500, dwell_ms=20, timeout=25):
        await self._cfg(6, [(3, mesh.PB_VARINT, int(start_mhz * 1000)), (4, mesh.PB_VARINT, int(end_mhz * 1000)),
                            (5, mesh.PB_VARINT, int(step_khz)), (6, mesh.PB_VARINT, int(dwell_ms))])
        out = []; t0 = time.time(); got = False
        while time.time() - t0 < timeout:
            for f in await self.read_frames(0.2, 0.05):
                m = mesh.protobuf(f).to_map()
                if m.get(1) == 4:
                    got = True
                    r = m.get(3, 0); r = r - (1 << 32) if r >= (1 << 31) else r
                    out.append((m.get(2, 0), r))
                elif m.get(1) == 5:
                    return sorted(out, key=lambda x: -x[1])
            if not got and time.time() - t0 > 4.0:
                return []          # no radio-pipe response; scan.py explains why
            await self.sleep(0.02)
        return sorted(out, key=lambda x: -x[1])

    # ---- injection (gated) ----
    async def _tx(self, src, portnum, payload):
        tx = mesh.build_tx(src, portnum, payload, self._next_seq(), CH)
        await self.send_frame(tx)
        t0 = time.time()                        # wait for TX-done ACK -> flow control
        while time.time() - t0 < 2.0:
            for f in await self.read_frames(0.1, 0.03):
                if mesh.protobuf(f).to_map().get(1) == 3: return True
            await self.sleep(0.02)
        return False

    async def send_nodeinfo(self, node_id, long_name, short_name, verified=False):
        self.require_auth()
        pk = bytes((i * 7 + 3) & 0xff for i in range(32)) if verified else None
        u = mesh.user_pb(node_id, long_name, short_name, hw=(255 if verified else 38), public_key=pk)
        return await self._tx(node_id, 4, mesh.data_pb(4, u))
    async def send_position(self, node_id, lat, lon, alt=100):
        self.require_auth()
        return await self._tx(node_id, 3, mesh.data_pb(3, mesh.position_pb(lat, lon, alt, _now())))
    async def send_text(self, src, text):
        self.require_auth()
        return await self._tx(src, 1, mesh.data_pb(1, str(text).encode()))
    async def send_portnum(self, src, portnum, payload):
        self.require_auth()
        pl = payload if isinstance(payload, (bytes, bytearray)) else str(payload).encode()
        return await self._tx(src, portnum, mesh.data_pb(portnum, pl))

    async def monitor(self, seconds=20):
        t0 = time.time(); n = 0
        while time.time() - t0 < seconds:
            for f in await self.read_frames(0.3, 0.1):
                d = mesh.decode_rx(f, CH)
                if d and d.get('portnum') is not None:
                    print('RX src=%s portnum=%s rssi=%s snr=%.2f' % (hex(d['src']), d['portnum'], d['rssi'], d['snr']))
                    n += 1
            await self.sleep(0.05)
        print('(%d packets in %ss)' % (n, seconds)); return n

    def require_auth(self):
        if not device_js.authorized():
            raise PermissionError('Injection is GATED. Tick "I am authorized to transmit" above first '
                                  '(you own or are explicitly authorized to test this hardware/RF).')

dev = Device()
