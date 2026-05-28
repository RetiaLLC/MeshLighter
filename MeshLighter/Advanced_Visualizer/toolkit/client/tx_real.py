import sys
import time
import struct
from mt_radio_serial import mt_radio_serial
from mt_lite import mt_lite
from mt_packet import mt_packet
import pypb

def send_real_text(port, text):
    print(f"Connecting to {port} and sending real Meshtastic text message...")
    radio = mt_radio_serial(port, diag=True)
    mesht = mt_lite(radio)
    
    # 1. Create the Payload Protobuf (Data)
    # portnum = 1 (TEXT_MESSAGE_APP)
    # payload = text
    data_pb = pypb.protobuf()
    data_pb.encode(1, pypb.PB_VARINT, 1) # portnum
    data_pb.encode(2, pypb.PB_STRING, text.encode('utf-8')) # payload
    
    # 2. Create the Packet
    pkt = mt_packet()
    pkt.payload = data_pb.get_buffer()
    pkt.decrypted = True # Let mt_lite encrypt it
    pkt.src = 0x02e442cc # Mock source ID
    pkt.seq = int(time.time()) & 0xFFFFFFFF
    pkt.hash = 0x08 # Default hash for LongFast? Let's check
    # Actually, mt_lite calculates the hash from the channel
    # Wait, mt_lite.send(msg) uses msg.hash to find the key
    
    # Calculate correct hash for LongFast
    from mt_channel import channel
    ch = channel('LongFast', 1)
    pkt.hash = ch.getHash()
    print(f"Using Channel Hash: {hex(pkt.hash)}")
    
    print(f"Sending text: '{text}'")
    mesht.send(pkt)
    print("Sent.")
    
    time.sleep(2)
    mesht.update()

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 tx_real.py [serial_port] [text]")
        sys.exit(1)
    
    text = sys.argv[2] if len(sys.argv) > 2 else "Hello from Nibble Zero!"
    send_real_text(sys.argv[1], text)
