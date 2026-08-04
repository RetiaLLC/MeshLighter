# mesh.py — self-contained Meshtastic toolkit for the browser Python lab (Pyodide).
# No pyserial, no external crypto: a compact pure-Python AES-128 backs the AES-CTR
# so it runs anywhere Pyodide runs. Serial I/O is the JS bridge (dev.*), not here.
# Validated: crypto matches the bench known-answer vector; built packets land on a
# real Meshtastic node.

# ---------------------------------------------------------------- pure AES-128
_SBOX = []
def _init_sbox():
    p = q = 1
    sbox = [0]*256
    while True:
        p = p ^ ((p << 1) & 0xff) ^ (0x1b if p & 0x80 else 0)
        q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff
        if q & 0x80: q ^= 0x09
        x = q ^ ((q << 1)|(q >> 7)) ^ ((q << 2)|(q >> 6)) ^ ((q << 3)|(q >> 5)) ^ ((q << 4)|(q >> 4))
        sbox[p] = (x ^ 0x63) & 0xff
        if p == 1: break
    sbox[0] = 0x63
    return sbox
_SBOX = _init_sbox()
_RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36]

def _xtime(a): return ((a << 1) ^ 0x1b) & 0xff if a & 0x80 else (a << 1)
def _mul(a, b):
    r = 0
    for _ in range(8):
        if b & 1: r ^= a
        hi = a & 0x80; a = (a << 1) & 0xff
        if hi: a ^= 0x1b
        b >>= 1
    return r

def _key_expansion(key):
    ks = [list(key[i*4:i*4+4]) for i in range(4)]
    for i in range(4, 44):
        t = list(ks[i-1])
        if i % 4 == 0:
            t = t[1:] + t[:1]
            t = [_SBOX[b] for b in t]
            t[0] ^= _RCON[i//4 - 1]
        ks.append([ks[i-4][j] ^ t[j] for j in range(4)])
    return ks

def aes128_encrypt_block(key, block):
    ks = _key_expansion(key)
    s = [[block[r + 4*c] for c in range(4)] for r in range(4)]
    def add(rnd):
        for c in range(4):
            for r in range(4):
                s[r][c] ^= ks[rnd*4 + c][r]
    add(0)
    for rnd in range(1, 10):
        for r in range(4):
            for c in range(4): s[r][c] = _SBOX[s[r][c]]
        for r in range(1, 4): s[r] = s[r][r:] + s[r][:r]
        for c in range(4):
            a = [s[r][c] for r in range(4)]
            s[0][c] = _mul(a[0],2)^_mul(a[1],3)^a[2]^a[3]
            s[1][c] = a[0]^_mul(a[1],2)^_mul(a[2],3)^a[3]
            s[2][c] = a[0]^a[1]^_mul(a[2],2)^_mul(a[3],3)
            s[3][c] = _mul(a[0],3)^a[1]^a[2]^_mul(a[3],2)
        add(rnd)
    for r in range(4):
        for c in range(4): s[r][c] = _SBOX[s[r][c]]
    for r in range(1, 4): s[r] = s[r][r:] + s[r][:r]
    add(10)
    return bytes(s[r][c] for c in range(4) for r in range(4))

# ---------------------------------------------------------------- protobuf (pypb)
PB_VARINT, PB_STRING, PB_I32 = 0, 2, 5
class protobuf:
    def __init__(self, buffer=None):
        self.buffer = b'' if buffer is None else buffer
        self.offset = 0
    def get_buffer(self): return self.buffer
    def encode_varint(self, num):
        while num > 127:
            self.buffer += bytes([0x80 | (num & 0x7f)]); num >>= 7
        self.buffer += bytes([num])
    def encode(self, index, t, data):
        self.buffer += bytes([index << 3 | t])
        if t == PB_VARINT: self.encode_varint(data)
        elif t == PB_I32: self.buffer += (data & 0xffffffff).to_bytes(4, 'little')
        elif t == PB_STRING:
            self.encode_varint(len(data))
            self.buffer += bytes(ord(b) if isinstance(b, str) else b for b in data)
    def to_map(self):
        m, o, b = {}, 0, self.buffer
        while o < len(b):
            key = b[o]; o += 1; idx, typ = key >> 3, key & 7
            if typ == PB_VARINT:
                num = shift = 0
                while True:
                    num |= (b[o] & 0x7f) << shift; shift += 7
                    if b[o] < 128: o += 1; break
                    o += 1
                m[idx] = num
            elif typ == PB_STRING:
                ln = 0; shift = 0
                while True:
                    ln |= (b[o] & 0x7f) << shift; shift += 7
                    if b[o] < 128: o += 1; break
                    o += 1
                m[idx] = b[o:o+ln]; o += ln
            elif typ == PB_I32:
                m[idx] = int.from_bytes(b[o:o+4], 'little', signed=True); o += 4
            else: break
        return m

# ---------------------------------------------------------------- channel + crypto
DEFAULT_KEY = [0xd4,0xf1,0xbb,0x3a,0x20,0x29,0x07,0x59,0xf0,0xbc,0xff,0xab,0xcf,0x4e,0x69,0x01]
class channel:
    def __init__(self, name='LongFast', key=1):
        self.name = name
        self.key = list(DEFAULT_KEY) if key == 1 else list(key)
    def getHash(self):
        h = 0
        for c in self.name: h ^= ord(c)
        for c in self.key: h ^= c
        return h

def _crypt(seq, src, key, payload):
    # Meshtastic AES-CTR: nonce = id(4 LE) | 0(4) | from(4 LE) | 0(4); XOR keystream.
    nonce = bytearray(16)
    nonce[0:4] = seq.to_bytes(4,'little'); nonce[8:12] = src.to_bytes(4,'little')
    out = bytearray(len(payload)); i = 0
    while i < len(payload):
        block = aes128_encrypt_block(bytes(key), bytes(nonce))
        for j in range(16):
            if i+j < len(payload): out[i+j] = block[j] ^ payload[i+j]
        nonce[15] = (nonce[15] + 1) & 0xff; i += 16
    return bytes(out)

# ---------------------------------------------------------------- packet build/parse
def _hdr(dest, src, seq, chash, hopcount=7, maxhop=7):
    flags = (hopcount & 7) | ((maxhop & 7) << 5)
    return (dest.to_bytes(4,'little') + src.to_bytes(4,'little') + seq.to_bytes(4,'little')
            + bytes([flags, chash, 0, 0]))

def data_pb(portnum, payload):
    pb = protobuf(); pb.encode(1, PB_VARINT, portnum); pb.encode(2, PB_STRING, payload)
    return pb.get_buffer()

def user_pb(node_id, long_name, short_name, hw=38, public_key=None):
    pb = protobuf()
    pb.encode(1, PB_STRING, ('!%08x' % node_id).encode())
    pb.encode(2, PB_STRING, long_name.encode()); pb.encode(3, PB_STRING, short_name[:4].encode())
    pb.encode(5, PB_VARINT, hw)
    if public_key: pb.encode(8, PB_STRING, public_key)   # PKI "lock" (any 32 bytes)
    pb.encode(9, PB_VARINT, 0)
    return pb.get_buffer()

def position_pb(lat, lon, alt=100, t=0):
    pb = protobuf()
    pb.encode(1, PB_I32, int(lat*1e7)); pb.encode(2, PB_I32, int(lon*1e7))
    pb.encode(3, PB_VARINT, alt); pb.encode(4, PB_I32, t)
    return pb.get_buffer()

def build_tx(src, portnum, payload, seq, ch, dest=0xffffffff):
    """Return the framed serial wrapper bytes for the radio pipe: {1:1, 2:meshpacket}."""
    chash = ch.getHash()
    enc = _crypt(seq, src, ch.key, payload)
    meshpacket = _hdr(dest, src, seq, chash) + enc
    w = protobuf(); w.encode(1, PB_VARINT, 1); w.encode(2, PB_STRING, meshpacket)
    return w.get_buffer()

def decode_rx(wrapper_bytes, ch):
    """Decode a received wrapper {1:1, 2:meshpacket, 3:rssi, 4:snr, 6:t} -> dict."""
    m = protobuf(bytes(wrapper_bytes)).to_map()
    if m.get(1) != 1 or 2 not in m: return None
    mp = bytes(m[2])
    src = int.from_bytes(mp[4:8],'little'); seq = int.from_bytes(mp[8:12],'little')
    dec = _crypt(seq, src, ch.key, mp[16:])
    d = protobuf(dec).to_map()
    return {'src': src, 'dest': int.from_bytes(mp[0:4],'little'), 'seq': seq,
            'rssi': m.get(3,0), 'snr': m.get(4,0)/4.0, 'portnum': d.get(1), 'payload': d.get(2, b'')}

def selftest():
    ks = _crypt(0x01020304, 0xA1A2A3A4, DEFAULT_KEY, bytes(16)).hex()
    ok = ks == '35512633a4602f1a5a8747ce6dd26fb8'
    print('mesh.py AES-CTR KAT:', 'PASS' if ok else 'FAIL got ' + ks)
    return ok

if __name__ == '__main__':
    selftest()
