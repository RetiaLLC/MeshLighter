import sys
import time
import random
from mt_radio_serial import mt_radio_serial
from mt_lite import mt_lite
from mt_packet import mt_packet
from mt_channel import channel
import pypb
from ghost_fleet import create_user_pb, create_data_pb, create_pos_pb

def create_telemetry_pb():
    device_metrics = pypb.protobuf()
    device_metrics.encode(1, pypb.PB_VARINT, random.randint(50, 100)) # Battery level 50-100%
    pb = pypb.protobuf()
    pb.encode(2, pypb.PB_STRING, bytes(device_metrics.get_buffer()))
    return bytes(pb.get_buffer())

def yaoi_fleet(port, count=5, duration=60):
    print(f"Connecting to {port} and launching {count} Yaoi nodes for {duration} seconds...")
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    ch = channel('LongFast', 1)
    
    nodes = []
    base_lat = 34.0522
    base_lon = -118.2437
    
    for i in range(1, count + 1):
        nodes.append({
            "id": 0x8A010000 + i, # "Ya" prefix-ish
            "name": f"Yaoi {i}",
            "sname": f"Y{i}",
            "lat": int((base_lat + (i * 0.002)) * 1e7),
            "lon": int((base_lon + (i * 0.002)) * 1e7)
        })

    start_time = time.time()
    loop_count = 0
    
    while time.time() - start_time < duration:
        loop_count += 1
        print(f"\n--- Loop {loop_count} ---")
        for node in nodes:
            if time.time() - start_time >= duration:
                break
                
            print(f"Broadcasting {node['name']}...")
            
            # 1. NodeInfo
            user_pb = create_user_pb(node['id'], node['name'], node['sname'])
            data_pb_info = create_data_pb(user_pb, portnum=4)
            pkt_info = mt_packet()
            pkt_info.src = node['id']
            pkt_info.payload = data_pb_info
            pkt_info.seq = random.getrandbits(32)
            mesht.send(pkt_info)
            time.sleep(0.5)
            
            # 2. Position
            pos_pb = create_pos_pb(node['lat'], node['lon'], alt=i*10)
            data_pb_pos = create_data_pb(pos_pb, portnum=3)
            pkt_pos = mt_packet()
            pkt_pos.src = node['id']
            pkt_pos.payload = data_pb_pos
            pkt_pos.seq = random.getrandbits(32)
            mesht.send(pkt_pos)
            time.sleep(0.5)
            
            # 3. Telemetry
            telem_pb = create_telemetry_pb()
            data_pb_telem = create_data_pb(telem_pb, portnum=2)
            pkt_telem = mt_packet()
            pkt_telem.src = node['id']
            pkt_telem.payload = data_pb_telem
            pkt_telem.seq = random.getrandbits(32)
            mesht.send(pkt_telem)
            time.sleep(0.5)
            
            mesht.update()
        
        time.sleep(5)

    print("\nInjection complete.")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 yaoi_fleet.py [serial_port]")
        sys.exit(1)
    
    yaoi_fleet(sys.argv[1])
