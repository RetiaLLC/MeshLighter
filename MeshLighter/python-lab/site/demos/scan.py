# Spectrum scan — PASSIVE (no authorization needed).
# Sweep the 900 MHz ISM band and rank channels by peak RSSI. Meshtastic US LongFast
# lives at 906.875 MHz; you'll see it (and any local mesh) rise above the noise floor.
from device import dev

dev.connect()
print("sweeping 902-928 MHz (step 250 kHz) ...")
rows = dev.scan(902, 928, step_khz=250, dwell_ms=20)
print(f"{len(rows)} channels sampled — strongest first:\n")
for freq_khz, rssi in rows[:15]:
    bars = "#" * max(0, (rssi + 135) // 3)
    print(f"  {freq_khz/1000:8.3f} MHz  {rssi:4d} dBm  {bars}")
