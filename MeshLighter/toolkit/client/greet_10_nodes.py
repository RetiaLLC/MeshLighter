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

def create_user_pb(node_id_int, long_name, short_name, hw):
    node_id_str = f"!{node_id_int:08x}"
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_STRING, node_id_str.encode('utf-8'))
    pb.encode(2, pypb.PB_STRING, long_name.encode('utf-8'))
    pb.encode(3, pypb.PB_STRING, short_name[:4].encode('utf-8'))
    mac = struct.pack('>Q', node_id_int)[2:]
    pb.encode(4, pypb.PB_STRING, mac)
    pb.encode(5, pypb.PB_VARINT, hw)
    pb.encode(9, pypb.PB_VARINT, 0)   # CLIENT
    return bytes(pb.get_buffer())

def node_show(port):
    print(f"--- 10 Node Greeting Show (Injecting from {port}) ---")
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    ch = channel('LongFast', 1)
    
    hws = [1, 4, 9, 43, 255] # Variety of hardware
    
    nodes = []
    for i in range(1, 11):
        n_id = 0x8A050000 + i
        name = f"Researcher_{i}"
        sname = f"R{i:02d}"
        hw = random.choice(hws)
        nodes.append({"id": n_id, "name": name, "sname": sname, "hw": hw})

    # 1. Sequential Deployment
    for node in nodes:
        print(f"Deploying {node['name']}...")
        info_data = pypb.protobuf()
        info_data.encode(1, pypb.PB_VARINT, 4) # NODEINFO
        info_data.encode(2, pypb.PB_STRING, create_user_pb(node['id'], node['name'], node['sname'], node['hw']))
        
        p_info = mt_packet()
        p_info.src = node['id']
        p_info.payload = bytes(info_data.get_buffer())
        p_info.seq = random.getrandbits(32)
        mesht.send(p_info)
        time.sleep(3)

    # 2. Sequential Greetings
    greetings = [
        "Hello from the mesh!",
        "Protocol research in progress.",
        "Nexus link stable.",
        "Signal clear, data flowing.",
        "Visualizer V3.3 online.",
        "MeshLighter is 100% successful.",
        "Checking in from the field.",
        "Telemetry heartbeat active.",
        "Geospatial grid confirmed.",
        "End of mission. Standby."
    ]

    for i, node in enumerate(nodes):
        msg = greetings[i]
        print(f"[{node['sname']}] says: '{msg}'")
        
        # Text message
        p_text = mt_packet()
        p_text.src = node['id']
        p_text.payload = create_text_pb(msg)
        p_text.seq = random.getrandbits(32)
        mesht.send(p_text)
        
        time.sleep(12)
        mesht.update()

    print("\nShow complete.")

if __name__ == '__main__':
    node_show(sys.argv[1])
