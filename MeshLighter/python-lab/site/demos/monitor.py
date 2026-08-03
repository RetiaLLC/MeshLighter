# Live monitor — PASSIVE (no authorization needed).
# Decode received LongFast packets in real time: source, PortNum, RSSI and SNR.
# (In ?demo mode the mock radio-pipe streams a few sample packets.)
from device import dev

dev.connect()
print("listening for 20 s ... (PortNum 1=text, 3=position, 4=nodeinfo, 67=telemetry)")
dev.monitor(seconds=20)
