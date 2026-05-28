import serial
import sys
from collections import deque

from mt_radio import mt_radio

class mt_radio_serial(mt_radio):
    def __init__(self,port,diag=False):
        self.ser = serial.Serial(port,115200)
        self.queue = deque()
        self.inbuff = []
        self.state = 0
        self.inlen = 0
        self.diag = diag
        
    def update(self):
        while self.ser.in_waiting > 0:
            rxlen = len(self.inbuff)
            b = ord(self.ser.read())

            if self.state == 0:
                if b == 0x94:
                    self.state = 1
                elif self.diag:
                    sys.stderr.write(chr(b))
            
            elif self.state == 1:
                if b == 0xC3:
                    self.state = 2
                else:
                    self.state = 0

            elif self.state == 2:
                self.inlen = b * 256
                self.state = 3
            
            elif self.state == 3:
                self.inlen += b
                self.state = 4

            else:
                if self.inlen > 0:
                    self.inbuff.append(b)
                    self.inlen -= 1
                    if self.inlen == 0:
                        self.queue.append(self.inbuff)
                        self.inbuff = []
                else:
                    self.state = 0
    
    def read(self):
        try:
            return self.queue.popleft()
        except:
            return None
    
    def write(self,msg):
        self.ser.write(b'\x94\xC3')
        self.ser.write(int.to_bytes(len(msg),2,'big'))
        self.ser.write(msg)
