import sys
import time
import random
import struct
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
    mac = struct.pack('>Q', node_id_int)[2:]
    pb.encode(4, pypb.PB_STRING, mac)
    pb.encode(5, pypb.PB_VARINT, 255) # PRIVATE_HW
    pb.encode(9, pypb.PB_VARINT, 0)   # CLIENT
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
    device_metrics.encode(1, pypb.PB_VARINT, random.randint(60, 99)) # Battery
    device_metrics.encode(2, pypb.PB_I32, random.randint(3600, 4100)) # Voltage
    pb = pypb.protobuf()
    pb.encode(2, pypb.PB_STRING, bytes(device_metrics.get_buffer()))
    return bytes(pb.get_buffer())

def create_data_pb(payload_bytes, portnum):
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_VARINT, portnum)
    pb.encode(2, pypb.PB_STRING, payload_bytes)
    return bytes(pb.get_buffer())

def hoodyaoi_stress_test(port, count=25, duration=120):
    print(f"Connecting to {port} and launching {count} HoodYaoi nodes for {duration} seconds...")
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    ch = channel('LongFast', 1)
    
    nodes = []
    base_lat = 33.9000
    base_lon = -118.1000
    
    for i in range(1, count + 1):
        nodes.append({
            "id": 0x484F4F00 + i, # "HOO" prefix
            "name": f"HoodYaoi {i}",
            "sname": f"HY{i}",
            "lat": int((base_lat + (i * 0.003)) * 1e7),
            "lon": int((base_lon + (i * 0.003)) * 1e7)
        })

    start_time = time.time()
    
    while time.time() - start_time < duration:
        print(f"\n--- Stress Broadcast Cycle ({int(time.time() - start_time)}s elapsed) ---")
        for node in nodes:
            if time.time() - start_time >= duration:
                break
                
            print(f"Broadcasting {node['name']}...")
            
            # Sequence: Info -> Pos -> Telem
            # Using slightly tighter timing for higher volume
            
            p_info = mt_packet()
            p_info.src = node['id']
            p_info.payload = create_data_pb(create_user_pb(node['id'], node['name'], node['sname']), 4)
            p_info.seq = random.getrandbits(32)
            mesht.send(p_info)
            time.sleep(0.3)
            
            p_pos = mt_packet()
            p_pos.src = node['id']
            p_pos.payload = create_data_pb(create_pos_pb(node['lat'], node['lon']), 3)
            p_pos.seq = random.getrandbits(32)
            mesht.send(p_pos)
            time.sleep(0.3)
            
            p_telem = mt_packet()
            p_telem.src = node['id']
            p_telem.payload = create_data_pb(create_telemetry_pb(), 2)
            p_telem.seq = random.getrandbits(32)
            mesht.send(p_telem)
            time.sleep(0.4)
            
            mesht.update()
        
        time.sleep(1)

    print("\nStress test complete.")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 hoodyaoi_fleet.py [serial_port]")
        sys.exit(1)
    
    hoodyaoi_stress_test(sys.argv[1])
