import sys
import time
import random
import struct
from mt_radio_serial import mt_radio_serial
from mt_lite import mt_lite
from mt_packet import mt_packet
from mt_channel import channel
import pypb
from ghost_fleet import create_user_pb

def create_text_pb(text):
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_VARINT, 1) # portnum: TEXT_MESSAGE_APP = 1
    pb.encode(2, pypb.PB_STRING, text.encode('utf-8'))
    return bytes(pb.get_buffer())

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

def bee_movie_show(port):
    print(f"--- Bee Movie Protocol Stress Test (Injecting from {port}) ---")
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    ch = channel('LongFast', 1)
    
    script = [
        "According to all known laws of aviation,",
        "there is no way a bee should be able to fly.",
        "Its wings are too small to get",
        "its fat little body off the ground.",
        "The bee, of course, flies anyway",
        "because bees don't care",
        "what humans think is impossible.",
        "Yellow, black. Yellow, black.",
        "Yellow, black. Yellow, black.",
        "Ooh, black and yellow!",
        "Let's shake it up a little.",
        "Barry! Breakfast is ready!",
        "Coming! Hang on a second.",
        "Hello?",
        "Barry?",
        "Adam?",
        "Can you believe this is happening?",
        "I can't. I'll pick you up.",
        "Looking sharp.",
        "Use the stairs. Your father",
        "paid good money for those."
    ]

    node_a = {"id": 0xBEE00001, "name": "Barry_B_Benson", "sname": "BEE1"}
    node_b = {"id": 0xBEE00002, "name": "Adam_Flayman", "sname": "BEE2"}
    
    # 1. Quick Deployment
    print("Deploying bees...")
    for n in [node_a, node_b]:
        info_data = pypb.protobuf()
        info_data.encode(1, pypb.PB_VARINT, 4)
        info_data.encode(2, pypb.PB_STRING, create_user_pb(n['id'], n['name'], n['sname']))
        p_info = mt_packet()
        p_info.src = n['id']
        p_info.payload = bytes(info_data.get_buffer())
        p_info.seq = random.getrandbits(32)
        mesht.send(p_info)
        time.sleep(1)

    print("Starting the script (20s limit)...")
    start_time = time.time()
    line_idx = 0
    
    while time.time() - start_time < 20:
        if line_idx >= len(script): break
        
        # Alternate nodes
        current_node = node_a if line_idx % 2 == 0 else node_b
        line = script[line_idx]
        
        print(f"[{current_node['sname']}]: {line}")
        
        p_text = mt_packet()
        p_text.src = current_node['id']
        p_text.payload = create_text_pb(line)
        p_text.seq = random.getrandbits(32)
        mesht.send(p_text)
        
        line_idx += 1
        time.sleep(1.0) # 1 second per line for "too many" effect
        mesht.update()

    print("\nBee test complete.")

if __name__ == '__main__':
    bee_movie_show(sys.argv[1])
