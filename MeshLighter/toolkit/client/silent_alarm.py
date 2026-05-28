import sys
import time
import struct
import random
from mt_radio_serial import mt_radio_serial
from mt_lite import mt_lite
from mt_packet import mt_packet
from mt_channel import channel
import pypb

def silent_alarm(port):
    print(f"Connecting to {port} and triggering the Silent Alarm (PortNum 77)...")
    radio = mt_radio_serial(port, diag=False)
    mesht = mt_lite(radio)
    
    ch = channel('LongFast', 1)
    
    # Payload can be anything. We'll send "WAKE UP"
    alarm_pb = pypb.protobuf()
    alarm_pb.encode(1, pypb.PB_VARINT, 77) # portnum: custom 77
    alarm_pb.encode(2, pypb.PB_STRING, b"WAKE UP")
    
    pkt = mt_packet()
    pkt.src = 0xDEADE000
    pkt.dest = 0xFFFFFFFF
    pkt.payload = bytes(alarm_pb.get_buffer())
    pkt.decrypted = True
    pkt.hash = ch.getHash()
    pkt.seq = random.getrandbits(32)
    
    print("Sending Silent Alarm...")
    mesht.send(pkt)
    time.sleep(1)
    mesht.update()
    print("Done.")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 silent_alarm.py [serial_port]")
        sys.exit(1)
    
    silent_alarm(sys.argv[1])
