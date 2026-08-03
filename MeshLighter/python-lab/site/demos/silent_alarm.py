# Silent Alarm — INJECTION (tick "I am authorized to transmit" first).
# A covert channel on an undefined PortNum (77): official nodes route/repeat the
# packet but never display it, while a cooperating radio-pipe can act on it.
from device import dev

dev.connect()
ok = dev.send_portnum(0xA1A20077, 77, b"WAKE UP")
print("PortNum 77 covert packet sent, ack =", ok)
print("Official nodes propagate it silently; they won't show it to the user.")
