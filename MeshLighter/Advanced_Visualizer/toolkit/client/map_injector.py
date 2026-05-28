import sys
import time
import struct
import math
import random
from mt_radio_serial import mt_radio_serial
from mt_lite import mt_lite
from mt_packet import mt_packet
from mt_channel import channel
import pypb

def create_position_pb(lat_i, lon_i, alt=100):
    pb = pypb.protobuf()
    # latitude_i: field 1, wire 5 (PB_I32)
    pb.encode(1, pypb.PB_I32, lat_i)
    # longitude_i: field 2, wire 5 (PB_I32)
    pb.encode(2, pypb.PB_I32, lon_i)
    # altitude: field 3, wire 0 (PB_VARINT)
    pb.encode(3, pypb.PB_VARINT, alt)
    # time: field 4, wire 5 (PB_I32)
    pb.encode(4, pypb.PB_I32, int(time.time()))
    return bytes(pb.get_buffer())

def create_data_pb(payload_bytes, portnum=3):
    pb = pypb.protobuf()
    pb.encode(1, pypb.PB_VARINT, portnum) # portnum: POSITION_APP = 3
    pb.encode(2, pypb.PB_STRING, payload_bytes) # payload
    return bytes(pb.get_buffer())

def map_injector(port, center_lat=37.7749, center_lon=-122.4194, radius=0.01, steps=20):
    print(f"Connecting to {port} and launching the Phantom Traveler...")
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    
    ch = channel('LongFast', 1)
    fake_id = 0xDEADE000
    
    # First, announce the node
    from ghost_fleet import create_user_pb
    user_pb = create_user_pb(fake_id, "PhantomTraveler", "TRAV")
    u_data_pb = pypb.protobuf()
    u_data_pb.encode(1, pypb.PB_VARINT, 4) # NODEINFO
    u_data_pb.encode(2, pypb.PB_STRING, user_pb)
    
    pkt = mt_packet()
    pkt.src = fake_id
    pkt.dest = 0xFFFFFFFF
    pkt.payload = bytes(u_data_pb.get_buffer())
    pkt.decrypted = True
    pkt.hash = ch.getHash()
    pkt.seq = random.getrandbits(32)
    
    print("Announcing Phantom Traveler...")
    mesht.send(pkt)
    time.sleep(2)

    for i in range(steps):
        angle = (2 * math.pi / steps) * i
        lat = center_lat + radius * math.sin(angle)
        lon = center_lon + radius * math.cos(angle)
        
        lat_i = int(lat * 1e7)
        lon_i = int(lon * 1e7)
        
        print(f"Injecting Position: {lat:.4f}, {lon:.4f} (Step {i+1}/{steps})...")
        
        pos_pb = create_position_pb(lat_i, lon_i)
        data_pb = create_data_pb(pos_pb, portnum=3)
        
        pkt = mt_packet()
        pkt.src = fake_id
        pkt.dest = 0xFFFFFFFF
        pkt.payload = data_pb
        pkt.decrypted = True
        pkt.hash = ch.getHash()
        pkt.seq = random.getrandbits(32)
        
        mesht.send(pkt)
        
        # Inject at high speed (1 position per second)
        time.sleep(1.0)
        mesht.update()

    print("Phantom Traveler has completed the journey.")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 map_injector.py [serial_port] [lat] [lon]")
        sys.exit(1)
    
    lat = float(sys.argv[2]) if len(sys.argv) > 2 else 37.7749
    lon = float(sys.argv[3]) if len(sys.argv) > 3 else -122.4194
    
    map_injector(sys.argv[1], lat, lon)
