# Spectrum scan (PASSIVE, no authorization needed).
# Sweep the 900 MHz ISM band and rank channels by peak RSSI. Meshtastic US LongFast
# lives at 906.875 MHz; you'll see it (and any local mesh) rise above the noise floor.
#
# This needs the RADIO-PIPE firmware. A stock Meshtastic node will not answer the scan
# (it does not speak the radio-pipe protocol), so you'll get no samples. Flash a Nibble
# with "Flash firmware -> Radio-pipe", or open the page with ?demo=1 for a simulated sweep.
from device import dev

dev.connect()
print("sweeping 902-928 MHz (step 250 kHz) ...")
rows = dev.scan(902, 928, step_khz=250, dwell_ms=20)

if not rows:
    print("\nNo scan samples came back within a few seconds.")
    print("The scan (and monitor/inject) need the RADIO-PIPE firmware. A stock")
    print("Meshtastic node stays silent here. Fix: click 'Flash firmware' and install")
    print("Radio-pipe onto a Nibble, then Connect it. Or load the page with ?demo=1")
    print("to see a simulated sweep with the noise floor.")
else:
    print(f"{len(rows)} channels sampled, strongest first:\n")
    for freq_khz, rssi in rows[:15]:
        bars = "#" * max(0, (rssi + 135) // 3)
        print(f"  {freq_khz/1000:8.3f} MHz  {rssi:4d} dBm  {bars}")
