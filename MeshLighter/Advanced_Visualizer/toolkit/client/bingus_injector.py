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
    device_metrics.encode(1, pypb.PB_VARINT, random.randint(60, 99))
    device_metrics.encode(2, pypb.PB_I32, random.randint(3600, 4100))
    pb = pypb.protobuf()
    pb.encode(2, pypb.PB_STRING, bytes(device_metrics.get_buffer()))
    return bytes(pb.get_buffer())

def create_data_pb(payload_bytes, portnum):
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_VARINT, portnum)
    pb.encode(2, pypb.PB_STRING, payload_bytes)
    return bytes(pb.get_buffer())

def run_injection(port, base_name, count, delay_between_packets=1.0, delay_between_nodes=5.0):
    print(f"Connecting to {port}...")
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    ch = channel('LongFast', 1)
    
    nodes = []
    base_lat = 34.0522
    base_lon = -118.2437
    
    for i in range(1, count + 1):
        nodes.append({
            "id": 0xB1460000 + i, # "BING" prefix
            "name": f"{base_name} {i}",
            "sname": f"B{i}",
            "lat": int((base_lat + (i * 0.005)) * 1e7),
            "lon": int((base_lon + (i * 0.005)) * 1e7)
        })

    print(f"Injecting {count} '{base_name}' nodes with {delay_between_packets}s packet delay and {delay_between_nodes}s node padding...")
    
    start_time = time.time()
    for node in nodes:
        print(f"--- Broadcasting {node['name']} (ID: {hex(node['id'])}) ---")
        
        # 1. NodeInfo (Highest priority, first to be registered)
        p_info = mt_packet()
        p_info.src = node['id']
        p_info.payload = create_data_pb(create_user_pb(node['id'], node['name'], node['sname']), 4)
        p_info.seq = random.getrandbits(32)
        mesht.send(p_info)
        time.sleep(delay_between_packets)
        
        # 2. Position (Establishes node on map)
        p_pos = mt_packet()
        p_pos.src = node['id']
        p_pos.payload = create_data_pb(create_pos_pb(node['lat'], node['lon']), 3)
        p_pos.seq = random.getrandbits(32)
        mesht.send(p_pos)
        time.sleep(delay_between_packets)
        
        # 3. Telemetry (Confirms 'liveness' to app)
        p_telem = mt_packet()
        p_telem.src = node['id']
        p_telem.payload = create_data_pb(create_telemetry_pb(), 2)
        p_telem.seq = random.getrandbits(32)
        mesht.send(p_telem)
        
        # Padding between full node sequences to allow receiver processing
        time.sleep(delay_between_nodes)
        mesht.update()

    print("\nInjection cycle complete.")

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Usage: python3 bingus_injector.py [port] [name] [count] [packet_delay] [node_delay]")
        sys.exit(1)
    
    port = sys.argv[1]
    name = sys.argv[2]
    count = int(sys.argv[3])
    p_delay = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
    n_delay = float(sys.argv[5]) if len(sys.argv) > 5 else 5.0
    
    run_injection(port, name, count, p_delay, n_delay)
