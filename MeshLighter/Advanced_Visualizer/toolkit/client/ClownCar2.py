import sys
import time
import random
import struct
import argparse
from cryptography.hazmat.primitives.asymmetric import ed25519
from mt_radio_serial import mt_radio_serial
from mt_lite import mt_lite
from mt_packet import mt_packet
from mt_channel import channel
import pypb

def create_user_pb(node_id_int, long_name, short_name, public_key_bytes):
    node_id_str = f"!{node_id_int:08x}"
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_STRING, node_id_str.encode('utf-8'))
    pb.encode(2, pypb.PB_STRING, long_name.encode('utf-8'))
    pb.encode(3, pypb.PB_STRING, short_name[:4].encode('utf-8'))
    
    # macaddr (Field 4)
    mac = struct.pack('>Q', node_id_int)[2:]
    pb.encode(4, pypb.PB_STRING, mac)
    
    # hw_model (Field 5): 255 is PRIVATE_HW
    pb.encode(5, pypb.PB_VARINT, 255)
    
    # is_licensed (Field 6)
    pb.encode(6, pypb.PB_VARINT, 1)
    
    # role (Field 7): 0 is CLIENT
    pb.encode(7, pypb.PB_VARINT, 0)
    
    # public_key (Field 8)
    if public_key_bytes:
        pb.encode(8, pypb.PB_STRING, public_key_bytes)
        
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
    device_metrics.encode(1, pypb.PB_VARINT, random.randint(70, 99))
    device_metrics.encode(2, pypb.PB_I32, random.randint(3700, 4200))
    pb = pypb.protobuf()
    pb.encode(2, pypb.PB_STRING, bytes(device_metrics.get_buffer()))
    return bytes(pb.get_buffer())

def create_data_pb(payload_bytes, portnum):
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_VARINT, portnum)
    pb.encode(2, pypb.PB_STRING, payload_bytes)
    return bytes(pb.get_buffer())

def run_clown_car_v2(port, names_list, p_delay=2.0, n_delay=8.0):
    print(f"--- ClownCar2 Advanced Mesh Injector ---")
    print(f"Port: {port}")
    print(f"Total Nodes to Deploy: {len(names_list)}")
    print(f"Verified Timing: {p_delay}s pkt delay, {n_delay}s node padding")
    print("----------------------------------------")
    
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    ch = channel('LongFast', 1)
    
    base_lat = 34.0522
    base_lon = -118.2437
    
    for i, node_name in enumerate(names_list, 1):
        # Generate a unique, deterministic-ish ID based on index + random seed
        node_id = (0x8A020000 + i) & 0xFFFFFFFF
        node_sname = node_name.replace(" ", "")[:2].upper() + f"{i:02d}"
        
        # Unique coordinates in a grid
        lat = int((base_lat + (i * 0.003)) * 1e7)
        lon = int((base_lon + (i * 0.003)) * 1e7)
        
        # Generate Ed25519 keypair
        private_key = ed25519.Ed25519PrivateKey.generate()
        pub_bytes = private_key.public_key().public_bytes_raw()
        
        print(f"[{i}/{len(names_list)}] Deploying '{node_name}' (ID: {hex(node_id)}) [Verified Mode]...")
        
        # 1. NodeInfo (Identity + Public Key)
        pkt_info = mt_packet()
        pkt_info.src = node_id
        pkt_info.payload = create_data_pb(create_user_pb(node_id, node_name, node_sname, pub_bytes), 4)
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
        
        print(f"      '{node_name}' is fully verified and on the air.")
        time.sleep(n_delay)
        mesht.update()

    print("\nMission complete. All nodes have exited the ClownCar2.")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="ClownCar2: Advanced Verified Meshtastic Node Injector")
    parser.add_argument("port", help="Serial port of the Nibble Zero modem")
    
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--name", help="Base name for numbered nodes")
    group.add_argument("--names", nargs='+', help="List of specific names to inject")
    
    parser.add_argument("--count", type=int, default=5, help="Number of nodes to create (for --name mode)")
    parser.add_argument("--p_delay", type=float, default=2.0, help="Delay between packets (default: 2.0s)")
    parser.add_argument("--n_delay", type=float, default=8.0, help="Padding between nodes (default: 8.0s)")
    
    args = parser.parse_args()
    
    if args.name:
        names_to_inject = [f"{args.name} {i}" for i in range(1, args.count + 1)]
    else:
        names_to_inject = args.names
        
    run_clown_car_v2(args.port, names_to_inject, args.p_delay, args.n_delay)
