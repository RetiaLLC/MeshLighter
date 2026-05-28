import sys
import time
import struct
from mt_radio_serial import mt_radio_serial
from mt_lite import mt_lite
import mt_packet

def setup_longfast(mesht):
    print("Setting Frequency to 906.875 MHz (US LongFast)...")
    mesht.set_config('freq', struct.pack('<f', 906.875))
    # LongFast defaults in Meshtastic:
    # BW: 250kHz, SF: 11, CR: 4/5 (5 in RadioLib)
    mesht.set_config('bw', struct.pack('<f', 250.0))
    mesht.set_config('sf', int(11).to_bytes(1, 'little'))
    mesht.set_config('cr', int(5).to_bytes(1, 'little'))
    mesht.save_config()
    print("Settings saved. Restarting...")
    mesht.restart()
    time.sleep(5)

def listen_for_packets(port):
    print(f"Connecting to {port} and listening for packets...")
    radio = mt_radio_serial(port, diag=True)
    mesht = mt_lite(radio)
    
    start_time = time.time()
    print("Waiting for packets (30s timeout)...")
    while time.time() - start_time < 30:
        mesht.update()
        pkt = mesht.get()
        if pkt:
            print("\n--- PACKET RECEIVED ---")
            print(f"RSSI: {pkt.rssi}")
            if hasattr(pkt, 'decrypted') and pkt.decrypted:
                print(f"Decrypted Payload: {pkt.payload}")
            else:
                print(f"Raw Payload: {pkt.payload.hex() if isinstance(pkt.payload, bytes) else pkt.payload}")
            return True
        time.sleep(0.1)
    
    print("\nNo packets received.")
    return False

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 ota_test.py [serial_port] [mode: setup|listen]")
        sys.exit(1)

    port = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else "listen"

    if mode == "setup":
        radio = mt_radio_serial(port, diag=True)
        mesht = mt_lite(radio)
        setup_longfast(mesht)
    else:
        listen_for_packets(port)
