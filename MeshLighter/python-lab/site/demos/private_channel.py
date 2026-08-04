# Private demo channel — move the pipe to a private frequency, live (no reboot).
# Keeps your demo off the public LongFast slot so injects don't reach the real mesh.
# Set your demo/target nodes to the same frequency (Meshtastic: LoRa > override freq).
from device import dev

dev.connect()
print(dev.set_freq(913.0))
print("Injector is now on 913.0 MHz. Point your demo nodes there, then run an inject.")
print("Return to the public channel with:  dev.set_freq(906.875)")
