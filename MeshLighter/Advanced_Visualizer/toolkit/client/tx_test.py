import sys
import time
import struct
from mt_radio_serial import mt_radio_serial
from mt_lite import mt_lite
from mt_packet import mt_packet

def send_test_packet(port):
    print(f"Connecting to {port} and sending test packet...")
    radio = mt_radio_serial(port, diag=True)
    mesht = mt_lite(radio)
    
    # Construct a simple Meshtastic-like packet
    # This is a bit simplified, but mt_packet handles the structure
    pkt = mt_packet()
    pkt.payload = b"Hello from lora-lite!"
    pkt.decrypted = False
    
    print("Sending...")
    mesht.send(pkt)
    print("Packet sent to MCU for transmission.")
    
    # Wait to see if it updates
    time.sleep(2)
    mesht.update()
    print("Done.")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 tx_test.py [serial_port]")
        sys.exit(1)

    send_test_packet(sys.argv[1])
