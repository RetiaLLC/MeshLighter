# Ghost Fleet — INJECTION (tick "I am authorized to transmit" first).
# Populate the mesh with virtual nodes. Each send blocks on the firmware TX-done ACK,
# so injection is paced to real LoRa airtime.
from device import dev

dev.connect()
COUNT = 5
for i in range(1, COUNT + 1):
    node_id = 0xA17E0000 + i
    ok = dev.send_nodeinfo(node_id, f"Ghost_{i:02d}", f"G{i:02d}")
    print(f"  Ghost_{i:02d}  {hex(node_id)}  ack={ok}")
    dev.sleep(0.4)
print(f"Ghost fleet deployed ({COUNT} nodes).")
