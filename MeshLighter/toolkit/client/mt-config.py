import sys
import select
import serial
import time
import datetime
import traceback
import random
import struct

import mt_radio_serial
from mt_packet import mt_packet

import pypb
from mt_lite import mt_lite
from sql_wrapper import sqlwrapper


if __name__ == '__main__':
    users = sqlwrapper()
    radio = mt_radio_serial.mt_radio_serial(sys.argv[1],diag=True)
    mesht = mt_lite(radio)
    if sys.argv[2] == 'get':
        cfg = mesht.get_config('freq')
        freq = struct.unpack('<f',cfg)[0]
        print('freq {}'.format(freq))
        cfg = mesht.get_config('bw')
        bw = struct.unpack('<f',cfg)[0]
        print('bw {}'.format(bw))
        cfg = mesht.get_config('sf')
        sf = int.from_bytes(cfg)
        print('sf {}'.format(sf))
        cfg = mesht.get_config('cr')
        cr = int.from_bytes(cfg)
        print('cr {}'.format(cr))
        cfg = mesht.get_config('syncword')
        syncword = int.from_bytes(cfg)
        print('sync {:02X}'.format(syncword))
        cfg = mesht.get_config('power')
        power = int.from_bytes(cfg)
        print('power {}'.format(power))
    if sys.argv[2] == 'set':
        i = 3
        while i < len(sys.argv):
            key = sys.argv[i]
            i += 1
            value = sys.argv[i]
            i += 1
            if key == 'freq' or key == 'bw':
                value = float(value)
                value = struct.pack('<f',value)
            else:
                value = int(value).to_bytes(1)
            mesht.set_config(key,value)

    if sys.argv[2] == 'save':
        mesht.save_config()

    if sys.argv[2] == 'restart':
        mesht.restart()

    time.sleep(1)
    mesht.update()
    time.sleep(1)
    mesht.update()
