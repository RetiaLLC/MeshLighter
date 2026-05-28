channel_list = {}

def add_channel(name,key):
    ch = channel(name,key)
    channel_list[ch.getHash()] = ch
    
def get_channel_by_hash(h):
    return channel_list[h]

class channel:
    def __init__(self,name,key):
        self.name=name
        self.key=key
        if key == 1:
            self.key = [0xd4, 0xf1, 0xbb, 0x3a, 0x20, 0x29, 0x07, 0x59, 0xf0, 0xbc, 0xff, 0xab, 0xcf, 0x4e, 0x69, 0x01]
    
    def getHash(self):
        h = 0
        for c in self.name:
            h ^= ord(c)
        for c in self.key:
            h ^= c
        return h
