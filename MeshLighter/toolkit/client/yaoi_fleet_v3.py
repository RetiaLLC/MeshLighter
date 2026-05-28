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
    pb.encode(1, pypb.PB_STRING, node_id_str.encode('utf-8')) # id
    pb.encode(2, pypb.PB_STRING, long_name.encode('utf-8'))   # long_name
    pb.encode(3, pypb.PB_STRING, short_name[:4].encode('utf-8')) # short_name
    
    # macaddr (field 4): 6 bytes
    mac = struct.pack('>Q', node_id_int)[2:] # simplistic mac
    pb.encode(4, pypb.PB_STRING, mac)
    
    pb.encode(5, pypb.PB_VARINT, 255) # hw_model = PRIVATE_HW
    pb.encode(9, pypb.PB_VARINT, 0)  # role = CLIENT
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
    device_metrics.encode(1, pypb.PB_VARINT, random.randint(50, 100)) # battery_level
    device_metrics.encode(2, pypb.PB_I32, random.randint(3500, 4200)) # voltage (mV)
    
    pb = pypb.protobuf()
    pb.encode(2, pypb.PB_STRING, bytes(device_metrics.get_buffer())) # DeviceMetrics
    return bytes(pb.get_buffer())

def create_data_pb(payload_bytes, portnum):
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_VARINT, portnum)
    pb.encode(2, pypb.PB_STRING, payload_bytes)
    return bytes(pb.get_buffer())

def yaoi_fleet_v3(port, count=5, duration=60):
    print(f"Connecting to {port} and launching {count} Yaoi nodes (v3) for {duration} seconds...")
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    ch = channel('LongFast', 1)
    
    nodes = []
    base_lat = 34.0522
    base_lon = -118.2437
    
    # Use different IDs to avoid collision with previous tests
    for i in range(1, count + 1):
        nodes.append({
            "id": 0xEEEE0000 + i,
            "name": f"Yaoi {i}",
            "sname": f"Y{i}",
            "lat": int((base_lat + (i * 0.005)) * 1e7),
            "lon": int((base_lon + (i * 0.005)) * 1e7)
        })

    start_time = time.time()
    
    while time.time() - start_time < duration:
        print(f"\n--- Broadcast Cycle ---")
        for node in nodes:
            if time.time() - start_time >= duration:
                break
                
            print(f"Broadcasting {node['name']} (ID: {hex(node['id'])})")
            
            # 1. NodeInfo
            info_data = create_data_pb(create_user_pb(node['id'], node['name'], node['sname']), portnum=4)
            p_info = mt_packet()
            p_info.src = node['id']
            p_info.payload = info_data
            p_info.seq = random.getrandbits(32)
            mesht.send(p_info)
            time.sleep(2.0) # Much longer delay for NodeInfo to be processed
            
            # 2. Position
            pos_data = create_data_pb(create_pos_pb(node['lat'], node['lon']), portnum=3)
            p_pos = mt_packet()
            p_pos.src = node['id']
            p_pos.payload = pos_data
            p_pos.seq = random.getrandbits(32)
            mesht.send(p_pos)
            time.sleep(1.0)
            
            # 3. Telemetry
            telem_data = create_data_pb(create_telemetry_pb(), portnum=2)
            p_telem = mt_packet()
            p_telem.src = node['id']
            p_telem.payload = telem_data
            p_telem.seq = random.getrandbits(32)
            mesht.send(p_telem)
            time.sleep(1.0)
            
            mesht.update()
        
        time.sleep(5)

    print("\nInjection complete.")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 yaoi_fleet_v3.py [serial_port]")
        sys.exit(1)
    
    yaoi_fleet_v3(sys.argv[1])
