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

def create_text_pb(text):
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_VARINT, 1) # portnum: TEXT_MESSAGE_APP = 1
    pb.encode(2, pypb.PB_STRING, text.encode('utf-8'))
    return bytes(pb.get_buffer())

def create_user_pb(node_id_int, long_name, short_name, public_key_bytes):
    node_id_str = f"!{node_id_int:08x}"
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_STRING, node_id_str.encode('utf-8'))
    pb.encode(2, pypb.PB_STRING, long_name.encode('utf-8'))
    pb.encode(3, pypb.PB_STRING, short_name[:4].encode('utf-8'))
    mac = struct.pack('>Q', node_id_int)[2:]
    pb.encode(4, pypb.PB_STRING, mac)
    pb.encode(5, pypb.PB_VARINT, 255) # PRIVATE_HW
    # is_licensed REMOVED: =1 trips Meshtastic's "is_licensed mismatch" -> node dropped.
    # PKI verified/lock comes from public_key (field 8) below.
    pb.encode(7, pypb.PB_VARINT, 0)   # role = CLIENT
    if public_key_bytes:
        pb.encode(8, pypb.PB_STRING, public_key_bytes)
    return bytes(pb.get_buffer())

def run_uwu_show(port):
    print(f"--- UwU Neural Mesh Show (Injecting from {port}) ---")
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    ch = channel('LongFast', 1)
    
    names = ["UwU_Master", "OwO_Guardian", "Senpai_Node", "Kawaii_Repeater"]
    snames = ["UWU1", "OWO2", "SEN3", "KAW4"]
    nodes = []

    # 1. Deployment & UwU Greeting
    for i in range(4):
        node_id = 0x50500000 + i
        private_key = ed25519.Ed25519PrivateKey.generate()
        pub_bytes = private_key.public_key().public_bytes_raw()
        
        print(f"Deploying {names[i]}...")
        info_data = pypb.protobuf()
        info_data.encode(1, pypb.PB_VARINT, 4) # NODEINFO
        info_data.encode(2, pypb.PB_STRING, create_user_pb(node_id, names[i], snames[i], pub_bytes))
        
        p_info = mt_packet()
        p_info.src = node_id
        p_info.payload = bytes(info_data.get_buffer())
        p_info.seq = random.getrandbits(32)
        mesht.send(p_info)
        time.sleep(2)
        
        # Broadcast Greeting
        greet = random.choice(["Hewwo mesh!", "UwU what is this?", "OwO signal found!", "M-meow!"])
        p_greet = mt_packet()
        p_greet.src = node_id
        p_greet.payload = create_text_pb(greet)
        p_greet.seq = random.getrandbits(32)
        mesht.send(p_greet)
        
        nodes.append({"id": node_id, "name": names[i], "sname": snames[i]})
        time.sleep(5)

    print("\nStarting Cross-Node Neural Bonding...")
    
    # 2. Directed Messages (A -> B, B -> C, etc.)
    for i in range(len(nodes)):
        src = nodes[i]
        dest = nodes[(i + 1) % len(nodes)]
        
        msg = f"Linkie with {dest['sname']}! UwU"
        print(f"[{src['sname']} -> {dest['sname']}]: {msg}")
        
        p_msg = mt_packet()
        p_msg.src = src['id']
        p_msg.to = dest['id']
        p_msg.payload = create_text_pb(msg)
        p_msg.seq = random.getrandbits(32)
        
        mesht.send(p_msg)
        time.sleep(15)
        mesht.update()

    print("\nThe UwU Mesh is complete.")

if __name__ == '__main__':
    run_uwu_show(sys.argv[1])
