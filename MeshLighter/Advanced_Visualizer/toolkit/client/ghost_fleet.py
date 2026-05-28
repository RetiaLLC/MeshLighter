import sys
import time
import struct
import random
from mt_radio_serial import mt_radio_serial
from mt_lite import mt_lite
from mt_packet import mt_packet
from mt_channel import channel
import pypb

def create_user_pb(node_id_int, long_name, short_name):
    # node_id_str is "!hex8"
    node_id_str = f"!{node_id_int:08x}"
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_STRING, node_id_str.encode('utf-8')) # id
    pb.encode(2, pypb.PB_STRING, long_name.encode('utf-8'))   # long_name
    pb.encode(3, pypb.PB_STRING, short_name[:4].encode('utf-8')) # short_name (max 4)
    # hw_model: field 5. 38 is PRIVATE_HW
    pb.encode(5, pypb.PB_VARINT, 38)
    # role: field 9. 0 is CLIENT
    pb.encode(9, pypb.PB_VARINT, 0)
    return bytes(pb.get_buffer())

def create_pos_pb(lat_i, lon_i, alt=0):
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_I32, lat_i)
    pb.encode(2, pypb.PB_I32, lon_i)
    pb.encode(3, pypb.PB_VARINT, alt)
    pb.encode(4, pypb.PB_I32, int(time.time()))
    return bytes(pb.get_buffer())

def create_data_pb(payload_bytes, portnum=4):
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_VARINT, portnum) # portnum: NODEINFO_APP = 4
    pb.encode(2, pypb.PB_STRING, payload_bytes) # payload
    return bytes(pb.get_buffer())

def ghost_fleet(port, count=50):
    print(f"Connecting to {port} and launching the Ghost Fleet ({count} nodes)...")
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    
    ch = channel('LongFast', 1)
    
    for i in range(1, count + 1):
        # deterministic-ish IDs for debugging
        fake_id = 0xDEADE000 + i
        name = f"Ghost_{i:02d}"
        sname = f"G_{i:02d}"
        
        print(f"Broadcasting {name} (ID: {hex(fake_id)})...")
        
        user_pb = create_user_pb(fake_id, name, sname)
        data_pb = create_data_pb(user_pb, portnum=4)
        
        pkt = mt_packet()
        pkt.src = fake_id
        pkt.dest = 0xFFFFFFFF
        pkt.payload = data_pb
        pkt.decrypted = True # Encrypt with LongFast key
        pkt.hash = ch.getHash()
        pkt.seq = (int(time.time()) + i) & 0xFFFFFFFF
        
        mesht.send(pkt)
        
        # Increase delay to avoid collisions/overload
        time.sleep(1.0)
        mesht.update()

    print("Ghost Fleet deployed.")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 ghost_fleet.py [serial_port] [count]")
        sys.exit(1)
    
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    ghost_fleet(sys.argv[1], count)
