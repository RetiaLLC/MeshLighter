# MeshCore listen — PASSIVE (no authorization needed).
# MeshCore is a separate LoRa mesh from Meshtastic. This retunes the radio-pipe to a MeshCore
# preset and listens for node ADVERTs (self-signed, unencrypted), so you can discover nodes
# without any keys. Encrypted group/direct messages are counted but not decoded.
#
# Validated against a real US node: on the US915 preset it decoded live adverts (name, type,
# pubkey) and saw group chat. Set PRESET to match your node's Radio settings. If nothing shows
# up, the preset is wrong: check freq / bandwidth / SF / CR on the node and edit PRESETS below.
# (The US default is the narrow 910.525 / BW 62.5 / SF 7 / CR 5 modem.)
from device import dev
import mesh, meshcore, time

PRESET  = "US915"      # one of meshcore.PRESETS — must match the node's radio settings
SECONDS = 40

dev.connect()
p = meshcore.PRESETS[PRESET]
print(f"tuning to MeshCore {PRESET}: {p['freq']} MHz, BW {p['bw']}, SF {p['sf']}, CR 4/{p['cr']}, sync 0x{p['sync']:02x}")
dev.tune(freq=p["freq"], bw=p["bw"], sf=p["sf"], cr=p["cr"], sync=p["sync"])
dev.sleep(0.5)
print(f"listening {SECONDS}s for MeshCore packets (Meshtastic decode is off while tuned here)\n")

seen = {}          # pubkey -> node info
counts = {}
t0 = time.time()
while time.time() - t0 < SECONDS:
    for f in dev.read_frames(0.4, 0.1):
        m = mesh.protobuf(f).to_map()
        raw = m.get(2)
        if not isinstance(raw, (bytes, bytearray)):
            continue
        rssi = m.get(3, 0); snr = m.get(4, 0) / 4.0
        pk = meshcore.parse_packet(raw)
        if not pk:
            continue
        counts[pk["ptype"]] = counts.get(pk["ptype"], 0) + 1
        if pk["ptype"] == "ADVERT":
            adv = meshcore.parse_advert(pk["payload"])
            if adv:
                key = adv["pubkey"]
                first = key not in seen
                seen[key] = adv
                loc = f'  @ {adv["lat"]:.5f},{adv["lon"]:.5f}' if "lat" in adv else ""
                nm = adv.get("name", "(no name)")
                tag = "NEW " if first else "    "
                print(f'{tag}ADVERT {adv["id"]}  {adv.get("node_type","?"):8}  "{nm}"{loc}  rssi={rssi} snr={snr:.1f}')
    dev.sleep(0.05)

print(f"\n--- {int(time.time()-t0)}s: {len(seen)} node(s), packets by type: {counts or 'none'}")
for adv in seen.values():
    loc = f'  {adv["lat"]:.5f},{adv["lon"]:.5f}' if "lat" in adv else ""
    print(f'  {adv["id"]}  {adv.get("node_type","?"):8}  "{adv.get("name","?")}"{loc}')
if not seen and not counts:
    print("  Nothing heard. The preset likely does not match the node. Confirm the node's")
    print("  frequency / bandwidth / SF / CR in its app and edit meshcore.PRESETS, then re-run.")
