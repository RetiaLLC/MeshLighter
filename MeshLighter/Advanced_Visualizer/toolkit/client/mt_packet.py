
class mt_packet:
    
    def from_buffer(self,buffer):
        self.dest = int.from_bytes(buffer[0:4],byteorder='little')
        self.src = int.from_bytes(buffer[4:8],byteorder='little')
        self.seq = int.from_bytes(buffer[8:12],byteorder='little')
        self.flags = int.from_bytes(buffer[12:13])
        self.hash = int.from_bytes(buffer[13:14])
        self.nexthop = int.from_bytes(buffer[14:15])
        self.relay = int.from_bytes(buffer[15:16])
        self.hopcount = self.flags & 7
        self.wantack = (self.flags & 8) >> 3
        self.mqtt = (self.flags & 16) >> 4
        self.maxhop = (self.flags & 224) >> 5
        self.payload = buffer[16:]

    def to_buffer(self):
        self.flags = self.hopcount
        self.flags += self.wantack << 3
        self.flags += self.mqtt << 4
        self.flags += self.maxhop <<5
        buffer = [0] * 16 + [x for x in self.payload]
        buffer[0:4] = int.to_bytes(self.dest,4,byteorder='little')
        buffer[4:8] = int.to_bytes(self.src,4,byteorder='little')
        buffer[8:12] = int.to_bytes(self.seq,4,byteorder='little')
        buffer[12:13] = int.to_bytes(self.flags,1,byteorder='little')
        buffer[13:14] = int.to_bytes(self.hash,1,byteorder='little')
        buffer[14:15] = int.to_bytes(self.nexthop,1,byteorder='little')
        buffer[15:16] = int.to_bytes(self.relay,1,byteorder='little')
        
        outbytes = b''
        for b in buffer:
            outbytes += b.to_bytes(1)
        return outbytes

    def __init__(self,buffer=None):
        if buffer != None:
            self.decrypted = False
            self.buffer=buffer
            self.from_buffer(self.buffer)
        else:
            self.decrypted = True
            self.dest = 0xFFFFFFFF
            self.src = 0x00000000
            self.seq = 0x00000000
            self.flags = 0x00
            self.hash = 0x08
            self.nexthop = 0x00
            self.relay = 0x00
            self.hopcount = 0x07
            self.wantack = 0x00
            self.mqtt = 0x00
            self.maxhop = 0x07
            self.payload = []

    def dump(self):
        print('dest: {}'.format(hex(self.dest)))
        print('src: {}'.format(hex(self.src)))
        print('seq: {}'.format(hex(self.seq)))
        print('flags: {}'.format(hex(self.flags)))
        print('hash {}'.format(hex(self.hash)))
        print('nexthop: {}'.format(self.nexthop))
        print('relay: {}'.format(self.relay))
        print(' hopcount: {}'.format(self.hopcount))
        print(' wantack {}'.format(self.wantack))
        print(' mqtt {}'.format(self.mqtt))
        print(' maxhop: {}'.format(self.maxhop))

        print(self.payload)
        print('')
