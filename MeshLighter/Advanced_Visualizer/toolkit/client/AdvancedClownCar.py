import sys
import time
import random
import struct
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
    pb.encode(6, pypb.PB_VARINT, 0) # Start with False to avoid signature requirements
    
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

def run_advanced_clown_car(port, base_name, count):
    print(f"--- Advanced ClownCar (Green Lock Experiment) ---")
    print(f"Port: {port}")
    print(f"Name: {base_name}")
    print(f"Nodes: {count}")
    print("-------------------------------------------------")
    
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    ch = channel('LongFast', 1)
    
    base_lat = 34.0522
    base_lon = -118.2437
    
    for i in range(1, count + 1):
        node_id = 0x8A010000 + i # "av" prefix
        node_name = f"{base_name} {i}"
        node_sname = f"A{i:02d}"
        
        # Generate Ed25519 keypair for this node
        private_key = ed25519.Ed25519PrivateKey.generate()
        public_key = private_key.public_key()
        pub_bytes = public_key.public_bytes_raw()
        
        lat = int((base_lat + (i * 0.002)) * 1e7)
        lon = int((base_lon + (i * 0.002)) * 1e7)
        
        print(f"[{i}/{count}] Deploying '{node_name}' with public key...")
        
        # 1. NodeInfo (Include Public Key)
        user_pb = create_user_pb(node_id, node_name, node_sname, pub_bytes)
        data_pb_info = create_data_pb(user_pb, 4)
        
        pkt_info = mt_packet()
        pkt_info.src = node_id
        pkt_info.payload = data_pb_info
        pkt_info.seq = random.getrandbits(32)
        
        # Experiments show that sometimes public_key field in MeshPacket (16) is used
        # We can try setting it there too
        pkt_info.public_key = pub_bytes 
        
        mesht.send(pkt_info)
        time.sleep(2.0)
        
        # 2. Position
        pkt_pos = mt_packet()
        pkt_pos.src = node_id
        pkt_pos.payload = create_data_pb(create_pos_pb(lat, lon), 3)
        pkt_pos.seq = random.getrandbits(32)
        # pkt_pos.public_key = pub_bytes # Sign?
        mesht.send(pkt_pos)
        time.sleep(1.5)
        
        # 3. Telemetry
        pkt_telem = mt_packet()
        pkt_telem.src = node_id
        pkt_telem.payload = create_data_pb(create_telemetry_pb(), 2)
        pkt_telem.seq = random.getrandbits(32)
        mesht.send(pkt_telem)
        
        print(f"      '{node_name}' is on the air.")
        time.sleep(5.0)
        mesht.update()

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python3 AdvancedClownCar.py [serial_port] [name] [count]")
        sys.exit(1)
    
    port = sys.argv[1]
    name = sys.argv[2]
    count = int(sys.argv[3])
    
    run_advanced_clown_car(port, name, count)
