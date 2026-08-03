# Verified / "lock" nodes — INJECTION (tick "I am authorized to transmit" first).
# Spoof PKI-verified nodes: each NodeInfo carries a 32-byte public key, so a real
# Meshtastic node stores it and shows the padlock. (is_licensed is intentionally NOT
# set — that flag is rejected as an "is_licensed mismatch" on an encrypted channel.)
from device import dev

dev.connect()
for i, name in enumerate(["ResearchNode Alpha", "ResearchNode Bravo"], 1):
    node_id = 0x5EC00000 + i
    ok = dev.send_nodeinfo(node_id, name, f"RV{i}", verified=True)
    print(f"  {name}  {hex(node_id)}  verified/lock  ack={ok}")
    dev.sleep(0.6)
print("Verified nodes on the air (they register with a 32-byte key = the lock).")
