import sys
import select
import serial
import time
import datetime
import traceback

import mt_radio_serial

import pypb
from mt_lite import mt_lite
from sql_wrapper import sqlwrapper
#import mt_packet
#import mt_crypto
        
sources = {}

dedup_naive = []

def check_dedup(pkt):
    global dedup_naive
    if pkt.seq in dedup_naive:
        return True
    dedup_naive.append(pkt.seq)
    if len(dedup_naive) > 100:
        dedup_naive = dedup_naive[1:]
    return False

def nodeinfo(pkt):
    global sources
    pb = pypb.protobuf(pkt.payload[2])
    for name, t, value in pb:
        print(name,t,value)
    sources[pkt.src] = pb.to_map()
        

def pos(pkt):
    for b in pkt.payload[2]:
        sys.stdout.write('{:02x} '.format(b))
    print('')
    pb = pypb.protobuf(pkt.payload[2])
    for name, t, value in pb:
        if t == 'PB_I32':
            if value >= 2**31:
                value -= 2**32
            #value = pypb.pb_unsigned_to_signed(value)
            value /=10000000
        print(name,t,value)
    print(pb.to_map())
    

if __name__ == '__main__':
    log = open('test.log','w')
    
    users = sqlwrapper()
    radio = mt_radio_serial.mt_radio_serial(sys.argv[1])
    mesht = mt_lite(radio)
    while True:
        mesht.update()
        pkt = mesht.get()
        if pkt != None:
            if check_dedup(pkt):
                pass
                continue
            if not pkt.src in sources:
                sources[pkt.src] = {2:hex(pkt.src)}
            if not pkt.dest in sources:
                sources[pkt.dest] = {2:hex(pkt.dest)}
            print('packet')
            print('from: {}'.format(sources[pkt.src][2]))
            print('to:   {}'.format(sources[pkt.dest][2]))
            print('hops: {}/{}'.format(pkt.hopcount,pkt.maxhop))
            print('rssi: {}'.format(pkt.rssi))
            if pkt.decrypted == True:
                try:
                    print(pkt.payload)
                    if pkt.payload[1] == 1:
                        print('text')
                        
                    elif pkt.payload[1] == 3:
                        print('pos')
                        pos(pkt)
                    elif pkt.payload[1] == 4:
                        print('nodeinfo')
                        nodeinfo(pkt)
                    else:
                        try:
                            print('unknown app')
                            info = pypb.protobuf(pkt.payload[2]).to_map()
                            print(info)
                        except:
                            pass
                except:
                    pass
            else:
                print('undecrypted')
            if pkt.hopcount > 0:
                pkt.hopcount -=1
                mesht.send(pkt)
            print('')
        time.sleep(.1)
