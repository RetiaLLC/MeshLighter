import sys
import time
import random
import struct
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

def grand_finale(port):
    print(f"--- MeshLighter Grand Finale (Injecting from {port}) ---")
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    ch = channel('LongFast', 1)
    
    # 1. Announce the "Master Nexus"
    master_id = 0x8A040000
    print("Awakening the Master Nexus...")
    info_data = pypb.protobuf()
    info_data.encode(1, pypb.PB_VARINT, 4) # NODEINFO
    info_data.encode(2, pypb.PB_STRING, create_user_pb(master_id, "MASTER_NEXUS", "NEXS"))
    
    p_info = mt_packet()
    p_info.src = master_id
    p_info.payload = bytes(info_data.get_buffer())
    p_info.seq = random.getrandbits(32)
    mesht.send(p_info)
    time.sleep(10)

    # 2. Deploy the "Guardians" (Source-to-Dest test)
    guardians = [
        {"id": 0x8A040001, "name": "Guardian_Alpha", "sname": "GD-A"},
        {"id": 0x8A040002, "name": "Guardian_Beta",  "sname": "GD-B"}
    ]
    
    for g in guardians:
        print(f"Deploying {g['name']}...")
        info_data = pypb.protobuf()
        info_data.encode(1, pypb.PB_VARINT, 4)
        info_data.encode(2, pypb.PB_STRING, create_user_pb(g['id'], g['name'], g['sname']))
        
        p_info = mt_packet()
        p_info.src = g['id']
        p_info.payload = bytes(info_data.get_buffer())
        p_info.seq = random.getrandbits(32)
        mesht.send(p_info)
        time.sleep(5)

    # 3. Directed Message Show
    print("Beginning the neural transmission show...")
    sequences = [
        (master_id, guardians[0]['id'], "Nexus link established."),
        (guardians[0]['id'], master_id, "Copy that, Alpha reporting."),
        (master_id, guardians[1]['id'], "Synchronize neural grid."),
        (guardians[1]['id'], master_id, "Beta online. Signal is clear."),
        (master_id, 0xFFFFFFFF, "PROTOCOL RESEARCH TOOL // COMPLETE.")
    ]

    for src_id, dest_id, msg in sequences:
        print(f"[{hex(src_id)} -> {hex(dest_id)}]: {msg}")
        
        # Position first (Emerge from source)
        p_pos = mt_packet()
        p_pos.src = src_id
        p_pos.dest = dest_id
        
        pos_pb = pypb.protobuf()
        pos_pb.encode(1, pypb.PB_VARINT, 3) # POSITION
        inner_pos = pypb.protobuf()
        inner_pos.encode(1, pypb.PB_I32, int(34.0522 * 1e7))
        inner_pos.encode(2, pypb.PB_I32, int(-118.2437 * 1e7))
        pos_pb.encode(2, pypb.PB_STRING, bytes(inner_pos.get_buffer()))
        
        p_pos.payload = bytes(pos_pb.get_buffer())
        p_pos.seq = random.getrandbits(32)
        mesht.send(p_pos)
        time.sleep(3)
        
        # Text message (Emerge from source, travel to dest)
        p_text = mt_packet()
        p_text.src = src_id
        p_text.dest = dest_id
        p_text.payload = create_text_pb(msg)
        p_text.seq = random.getrandbits(32)
        mesht.send(p_text)
        
        time.sleep(15)
        mesht.update()

    print("\nThe Neural Mesh is complete.")

if __name__ == '__main__':
    grand_finale(sys.argv[1])
