import sys
import time
import random
import struct
from mt_radio_serial import mt_radio_serial
from mt_lite import mt_lite
from mt_packet import mt_packet
import pypb
from ghost_fleet import create_user_pb

def create_text_pb(text):
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_VARINT, 1)
    pb.encode(2, pypb.PB_STRING, text.encode('utf-8'))
    return bytes(pb.get_buffer())

def run_demo(port):
    print(f"--- Neural Symphony V3.7 Demo (Injecting from {port}) ---")
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    
    nodes = [
        {'id': 0x50501001, 'name': 'Command_Center', 'sname': 'CMD'},
        {'id': 0x50501002, 'name': 'Tactical_Alpha', 'sname': 'T-A'},
        {'id': 0x50501003, 'name': 'Tactical_Beta',  'sname': 'T-B'},
        {'id': 0x50501004, 'name': 'Recon_Gamma',    'sname': 'R-G'},
        {'id': 0x50501005, 'name': 'Logistics_Zero', 'sname': 'LOG'}
    ]

    # 1. Broad deployment and greetings
    for n in nodes:
        print(f"Deploying {n['name']}...")
        info_data = pypb.protobuf()
        info_data.encode(1, pypb.PB_VARINT, 4)
        info_data.encode(2, pypb.PB_STRING, create_user_pb(n['id'], n['name'], n['sname']))
        
        p_info = mt_packet()
        p_info.src = n['id']
        p_info.payload = bytes(info_data.get_buffer())
        mesht.send(p_info)
        time.sleep(2)
        
        greet = f"Station {n['sname']} is now online."
        print(f"[{n['sname']}]: {greet}")
        
        p_greet = mt_packet()
        p_greet.src = n['id']
        p_greet.payload = create_text_pb(greet)
        mesht.send(p_greet)
        time.sleep(4)

    print("\nStarting Neural Inter-Link sequence...")
    
    # 2. Directed messages to create bonds
    for i in range(len(nodes)):
        src = nodes[i]
        dest = nodes[(i + 1) % len(nodes)]
        
        msg = f"Establishing neural bond with {dest['sname']}..."
        print(f"[{src['sname']} -> {dest['sname']}]: {msg}")
        
        p = mt_packet()
        p.src = src['id']
        p.to = dest['id']
        p.payload = create_text_pb(msg)
        mesht.send(p)
        
        time.sleep(12)
        mesht.update()

    print("\nNeural Symphony complete.")

if __name__ == '__main__':
    run_demo(sys.argv[1])
