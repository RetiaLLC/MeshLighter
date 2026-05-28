import sys
import time
import random
from mt_radio_serial import mt_radio_serial
from mt_lite import mt_lite
from mt_packet import mt_packet
from mt_channel import channel
import pypb

def create_user_pb(node_id_int, long_name, short_name):
    node_id_str = f"!{node_id_int:08x}"
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_STRING, node_id_str.encode('utf-8'))
    pb.encode(2, pypb.PB_STRING, long_name.encode('utf-8'))
    pb.encode(3, pypb.PB_STRING, short_name[:4].encode('utf-8'))
    
    # macaddr
    mac = struct.pack('>Q', node_id_int)[2:]
    pb.encode(4, pypb.PB_STRING, mac)
    
    # hw_model = PRIVATE_HW
    pb.encode(5, pypb.PB_VARINT, 255)
    
    # role = CLIENT
    pb.encode(9, pypb.PB_VARINT, 0)  
    return bytes(pb.get_buffer())

def create_pos_pb(lat_i, lon_i, alt=0):
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_I32, lat_i)
    pb.encode(2, pypb.PB_I32, lon_i)
    pb.encode(3, pypb.PB_VARINT, alt)
    pb.encode(4, pypb.PB_I32, int(time.time()))
    return bytes(pb.get_buffer())

def create_telemetry_pb():
    device_metrics = pypb.protobuf()
    device_metrics.encode(1, pypb.PB_VARINT, random.randint(50, 100)) # Battery level 50-100%
    device_metrics.encode(2, pypb.PB_I32, random.randint(3600, 4100)) # Voltage
    
    pb = pypb.protobuf()
    pb.encode(2, pypb.PB_STRING, bytes(device_metrics.get_buffer())) # Send as sub-message
    return bytes(pb.get_buffer())

def create_data_pb(payload_bytes, portnum):
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_VARINT, portnum)
    pb.encode(2, pypb.PB_STRING, payload_bytes)
    return bytes(pb.get_buffer())

import struct

def ghost_fleet_fixed(port, count=5, duration=120):
    print(f"Connecting to {port} and launching {count} fixed ghost nodes for {duration} seconds...")
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    ch = channel('LongFast', 1)
    
    nodes = []
    base_lat = 34.000000
    base_lon = -118.000000
    
    for i in range(1, count + 1):
        nodes.append({
            "id": 0x77770000 + i,
            "name": f"GhostFixed {i}",
            "sname": f"G{i:02d}",
            "lat": int((base_lat + (i * 0.005)) * 1e7),
            "lon": int((base_lon + (i * 0.005)) * 1e7)
        })

    print("Deploying fleet...")
    start_time = time.time()
    
    while time.time() - start_time < duration:
        for node in nodes:
            if time.time() - start_time >= duration:
                break
                
            print(f"[{int(time.time() - start_time)}s] Broadcasting {node['name']}...")
            
            # 1. NodeInfo (PortNum 4)
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
            time.sleep(0.5)
            
            # 2. Position (PortNum 3)
            pos_pb = create_pos_pb(node['lat'], node['lon'], alt=i*10)
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
            
            # 3. Telemetry (PortNum 2)
            telem_pb = create_telemetry_pb()
            data_pb_telem = create_data_pb(telem_pb, portnum=2)
            
            pkt_telem = mt_packet()
            pkt_telem.src = node['id']
            pkt_telem.dest = 0xFFFFFFFF
            pkt_telem.payload = data_pb_telem
            pkt_telem.decrypted = True
            pkt_telem.hash = ch.getHash()
            pkt_telem.seq = random.getrandbits(32)
            mesht.send(pkt_telem)
            time.sleep(0.5)
            
            mesht.update()
        
        # Brief pause before next cycle of all nodes
        time.sleep(2.0)

    print("\nTest complete.")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 ghost_fleet_fixed.py [serial_port] [count]")
        sys.exit(1)
    
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    ghost_fleet_fixed(sys.argv[1], count)
