# meshcore.py — MeshCore support for the lab. MeshCore (github.com/ripplebiz/MeshCore) is a
# separate LoRa mesh from Meshtastic: different PHY presets, different packet format, no
# channel-hash header. The radio-pipe is protocol-agnostic on receive, so if you tune it to a
# MeshCore preset (dev.tune) it hands up raw MeshCore packets you can parse here.
#
# ADVERTs are self-signed (Ed25519) and NOT encrypted, so node discovery works passively with
# no keys. Direct/group (GRP_TXT) messages are encrypted and are only counted, not decoded.
#
# Validated on a real US node: the pipe on the US915 preset below decoded live ADVERTs
# (pubkey / node-type / name) and saw group-text traffic. Encrypted-message decode is future work.

# ---- standard radio presets (freq MHz, bw kHz, sf, cr=4/x, sync) ----------------
# MeshCore's default modem is narrow: BW 62.5 kHz, SF 7, CR 5 (confirmed against a US node's
# "USA/Canada (Recommended)" radio settings). Region presets keep that modem and only change
# frequency. Match them to your node's Radio settings — if the preset is off, the pipe hears
# nothing. sync 0x12 is MeshCore's LoRa sync word.
PRESETS = {
    "US915":  {"freq": 910.525, "bw": 62.5, "sf": 7, "cr": 5, "sync": 0x12},   # USA/Canada, confirmed
    "EU868":  {"freq": 869.525, "bw": 62.5, "sf": 7, "cr": 5, "sync": 0x12},   # freq per region docs
    "EU433":  {"freq": 433.5,   "bw": 62.5, "sf": 7, "cr": 5, "sync": 0x12},
    "AU915":  {"freq": 915.0,   "bw": 62.5, "sf": 7, "cr": 5, "sync": 0x12},
}

# ---- packet header ----------------------------------------------------------------
ROUTE = {0: "TRANSPORT_FLOOD", 1: "FLOOD", 2: "DIRECT", 3: "TRANSPORT_DIRECT"}
PTYPE = {0: "REQ", 1: "RESPONSE", 2: "TXT_MSG", 3: "ACK", 4: "ADVERT", 5: "GRP_TXT",
         6: "GRP_DATA", 7: "ANON_REQ", 8: "PATH", 9: "TRACE", 15: "RAW_CUSTOM"}
NODE_TYPE = {0: "none", 1: "chat", 2: "repeater", 3: "room", 4: "sensor"}
ADV_HAS_LOCATION = 0x10
ADV_HAS_FEAT1    = 0x20
ADV_HAS_FEAT2    = 0x40
ADV_HAS_NAME     = 0x80

def parse_packet(raw):
    """Split a raw MeshCore packet into {route, ptype, ver, path, payload}."""
    b = bytes(raw)
    if len(b) < 2: return None
    h = b[0]; route = h & 0x03; ptype = (h >> 2) & 0x0F; ver = (h >> 6) & 0x03
    i = 1
    transport = None
    if route in (0, 3):                       # transport variants carry 2x uint16 codes
        if len(b) < i + 4: return None
        transport = b[i:i+4]; i += 4
    if i >= len(b): return None
    path_len = b[i]; i += 1
    if i + path_len > len(b): return None
    path = b[i:i+path_len]; i += path_len
    return {"route": ROUTE.get(route, route), "ptype": PTYPE.get(ptype, ptype),
            "ver": ver, "path": path, "path_len": path_len, "transport": transport, "payload": b[i:]}

def parse_advert(payload):
    """Decode an ADVERT payload -> node identity. Adverts are public + self-signed."""
    p = bytes(payload)
    if len(p) < 100: return None              # 32 pubkey + 4 ts + 64 sig
    pub = p[0:32]
    ts = int.from_bytes(p[32:36], "little")
    sig = p[36:100]
    app = p[100:]
    out = {"pubkey": pub.hex(), "id": pub[:4].hex(), "timestamp": ts, "sig_len": len(sig)}
    if not app: return out
    flags = app[0]; i = 1
    out["node_type"] = NODE_TYPE.get(flags & 0x0F, flags & 0x0F)
    out["flags"] = flags
    if flags & ADV_HAS_LOCATION and len(app) >= i + 8:
        out["lat"] = int.from_bytes(app[i:i+4], "little", signed=True) / 1e6
        out["lon"] = int.from_bytes(app[i+4:i+8], "little", signed=True) / 1e6
        i += 8
    if flags & ADV_HAS_FEAT1 and len(app) >= i + 2: out["feat1"] = int.from_bytes(app[i:i+2], "little"); i += 2
    if flags & ADV_HAS_FEAT2 and len(app) >= i + 2: out["feat2"] = int.from_bytes(app[i:i+2], "little"); i += 2
    if flags & ADV_HAS_NAME:
        out["name"] = app[i:].decode("utf-8", "replace")
    return out

def build_advert(pub32, name, node_type=1, lat=None, lon=None, timestamp=0, sig64=None):
    """Build an ADVERT payload for testing the parser (signature is a placeholder unless given)."""
    flags = node_type & 0x0F
    app = bytearray()
    if lat is not None and lon is not None:
        flags |= ADV_HAS_LOCATION
    if name:
        flags |= ADV_HAS_NAME
    app.append(flags)
    if lat is not None and lon is not None:
        app += int(round(lat * 1e6)).to_bytes(4, "little", signed=True)
        app += int(round(lon * 1e6)).to_bytes(4, "little", signed=True)
    if name:
        app += name.encode()
    return bytes(pub32[:32]) + int(timestamp).to_bytes(4, "little") + bytes(sig64 or bytes(64)) + bytes(app)

def advert_packet(advert_payload, route=1):
    """Wrap an ADVERT payload as a full FLOOD packet (header + path_len=0 + payload)."""
    header = (route & 0x03) | (4 << 2)        # payload_type ADVERT = 4
    return bytes([header, 0]) + bytes(advert_payload)
