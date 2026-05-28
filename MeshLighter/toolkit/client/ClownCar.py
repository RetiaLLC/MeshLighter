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
    
    # macaddr (Field 4) - Required for realism
    mac = struct.pack('>Q', node_id_int)[2:]
    pb.encode(4, pypb.PB_STRING, mac)
    
    # hw_model (Field 5): 255 is PRIVATE_HW
    pb.encode(5, pypb.PB_VARINT, 255)
    
    # role (Field 9): 0 is CLIENT
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
    # DeviceMetrics sub-message
    device_metrics = pypb.protobuf()
    device_metrics.encode(1, pypb.PB_VARINT, random.randint(70, 99))  # battery_level
    device_metrics.encode(2, pypb.PB_I32, random.randint(3700, 4200))  # voltage (mV)
    
    pb = pypb.protobuf()
    pb.encode(2, pypb.PB_STRING, bytes(device_metrics.get_buffer()))
    return bytes(pb.get_buffer())

def create_data_pb(payload_bytes, portnum):
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_VARINT, portnum)
    pb.encode(2, pypb.PB_STRING, payload_bytes)
    return bytes(pb.get_buffer())

def run_clown_car(port, base_name, count, p_delay=1.5, n_delay=5.0):
    print(f"--- ClownCar Mesh Injector ---")
    print(f"Port: {port}")
    print(f"Name: {base_name}")
    print(f"Nodes: {count}")
    print(f"Timing: {p_delay}s pkt delay, {n_delay}s node padding")
    print("------------------------------")
    
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    ch = channel('LongFast', 1)
    
    base_lat = 34.0522
    base_lon = -118.2437
    
    for i in range(1, count + 1):
        # Unique node ID with "C10" (Clown) prefix
        node_id = 0xC1000000 + i
        node_name = f"{base_name} {i}"
        node_sname = f"C{i:02d}"
        
        # Unique coordinates in a grid
        lat = int((base_lat + (i * 0.002)) * 1e7)
        lon = int((base_lon + (i * 0.002)) * 1e7)
        
        print(f"[{i}/{count}] Packing '{node_name}' into the car...")
        
        # 1. NodeInfo (Identity)
        pkt_info = mt_packet()
        pkt_info.src = node_id
        pkt_info.payload = create_data_pb(create_user_pb(node_id, node_name, node_sname), 4)
        pkt_info.seq = random.getrandbits(32)
        mesht.send(pkt_info)
        time.sleep(p_delay)
        
        # 2. Position (Location)
        pkt_pos = mt_packet()
        pkt_pos.src = node_id
        pkt_pos.payload = create_data_pb(create_pos_pb(lat, lon), 3)
        pkt_pos.seq = random.getrandbits(32)
        mesht.send(pkt_pos)
        time.sleep(p_delay)
        
        # 3. Telemetry (Liveness)
        pkt_telem = mt_packet()
        pkt_telem.src = node_id
        pkt_telem.payload = create_data_pb(create_telemetry_pb(), 2)
        pkt_telem.seq = random.getrandbits(32)
        mesht.send(pkt_telem)
        
        print(f"      '{node_name}' is on the air.")
        time.sleep(n_delay)
        mesht.update()

    print("\nAll clowns have been deployed. The ClownCar is empty.")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python3 ClownCar.py [serial_port] [name] [count] [optional: pkt_delay] [optional: node_delay]")
        print("Example: python3 ClownCar.py /dev/ttyACM0 'Bingus' 10")
        sys.exit(1)
    
    port = sys.argv[1]
    name = sys.argv[2]
    count = int(sys.argv[3])
    
    # Use verified default timings
    p_delay = float(sys.argv[4]) if len(sys.argv) > 4 else 1.5
    n_delay = float(sys.argv[5]) if len(sys.argv) > 5 else 5.0
    
    run_clown_car(port, name, count, p_delay, n_delay)
