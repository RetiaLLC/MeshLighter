import sys
import time
import struct
import random
from mt_radio_serial import mt_radio_serial
from mt_lite import mt_lite
from mt_packet import mt_packet
from mt_channel import channel
import pypb
from ghost_fleet import create_user_pb, create_data_pb, create_pos_pb

def ghost_fleet_timed(port, count=50, duration_sec=300):
    print(f"Connecting to {port}...")
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    ch = channel('LongFast', 1)
    
    # Pre-generate IDs to keep them consistent for each "Gaylord"
    nodes = []
    for i in range(1, count + 1):
        nodes.append({
            "id": 0x61790000 + i, # "ay" prefix
            "name": f"Gaylord {i}",
            "sname": f"G{i}"
        })

    start_time = time.time()
    print(f"Launching persistent Ghost Fleet for {duration_sec}s...")
    
    loop_count = 0
    while time.time() - start_time < duration_sec:
        loop_count += 1
        print(f"\n--- Broadcast Loop {loop_count} ---")
        for node in nodes:
            elapsed = time.time() - start_time
            if elapsed > duration_sec:
                break
                
            print(f"[{int(elapsed)}s] Broadcasting {node['name']} (NodeInfo + Position)...")
            
            # 1. NodeInfo
            user_pb = create_user_pb(node['id'], node['name'], node['sname'])
            data_pb_info = create_data_pb(user_pb, portnum=4)
            
            pkt_info = mt_packet()
            pkt_info.src = node['id']
            pkt_info.dest = 0xFFFFFFFF
            pkt_info.payload = data_pb_info
            pkt_info.decrypted = True
            pkt_info.hash = ch.getHash()
            pkt_info.seq = random.getrandbits(32)
            
            mesht.send(pkt_info)
            time.sleep(0.3)
            
            # 2. Position (Fixed dummy location)
            # Lat: 34.0, Lon: -118.0 (Los Angeles area-ish for context)
            pos_pb = create_pos_pb(340000000, -1180000000)
            data_pb_pos = create_data_pb(pos_pb, portnum=3)
            
            pkt_pos = mt_packet()
            pkt_pos.src = node['id']
            pkt_pos.dest = 0xFFFFFFFF
            pkt_pos.payload = data_pb_pos
            pkt_pos.decrypted = True
            pkt_pos.hash = ch.getHash()
            pkt_pos.seq = random.getrandbits(32)
            
            mesht.send(pkt_pos)
            time.sleep(0.5) 
            
            mesht.update()
            
        time.sleep(2) # Brief pause between full fleet sweeps

    print(f"\nTest complete. Deployed fleet for {int(time.time() - start_time)} seconds.")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 ghost_fleet_timed.py [serial_port]")
        sys.exit(1)
    
    ghost_fleet_timed(sys.argv[1])
