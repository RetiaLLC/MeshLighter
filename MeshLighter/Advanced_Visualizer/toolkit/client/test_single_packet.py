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
    mac = struct.pack('>Q', node_id_int)[2:]
    pb.encode(4, pypb.PB_STRING, mac)
    pb.encode(5, pypb.PB_VARINT, 255) # PRIVATE_HW
    pb.encode(6, pypb.PB_VARINT, 1)   # is_licensed
    pb.encode(9, pypb.PB_VARINT, 0)   # role = CLIENT
    if public_key_bytes:
        pb.encode(8, pypb.PB_STRING, public_key_bytes)
    return bytes(pb.get_buffer())

def create_data_pb(payload_bytes, portnum):
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_VARINT, portnum)
    pb.encode(2, pypb.PB_STRING, payload_bytes)
    return bytes(pb.get_buffer())

def test_single_injection(port, name):
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    ch = channel('LongFast', 1)
    
    node_id = 0xBEEF0001
    
    private_key = ed25519.Ed25519PrivateKey.generate()
    pub_bytes = private_key.public_key().public_bytes_raw()
    
    print(f"Sending NodeInfo for {name} (ID: {hex(node_id)})...")
    
    user_pb = create_user_pb(node_id, name, "BEEF", pub_bytes)
    data_pb = create_data_pb(user_pb, 4)
    
    pkt = mt_packet()
    pkt.src = node_id
    pkt.payload = data_pb
    pkt.seq = random.getrandbits(32)
    
    mesht.send(pkt)
    time.sleep(2)
    mesht.update()
    print("Sent.")

if __name__ == '__main__':
    test_single_injection(sys.argv[1], sys.argv[2])
