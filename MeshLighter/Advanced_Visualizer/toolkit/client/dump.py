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
        
if __name__ == '__main__':
    log = open('test.log','w')
    
    users = sqlwrapper()
    radio = mt_radio_serial.mt_radio_serial(sys.argv[1],diag=True)
    mesht = mt_lite(radio)
    while True:
        mesht.update()
        pkt = mesht.get_raw()
        if pkt != None:
            for b in pkt:
                sys.stdout.write('{:02X} '.format(b))
            print('')
        time.sleep(.1)
