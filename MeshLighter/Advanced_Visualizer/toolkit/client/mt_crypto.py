from Crypto.Cipher import AES
from Crypto.Util import Counter

class aesctr:
    def __init__(self,iv,key):
        self.iv=iv
        self.key=key
        

def encrypt_packet(packet,psk):
    nonce = [0] * 16
    nonce[0:4] = packet.seq.to_bytes(4,byteorder='little')
    nonce[8:12] = packet.src.to_bytes(4,byteorder='little')
    crypto = AES.new(bytes(psk), AES.MODE_ECB)
    i = 0
    out = [0] * len(packet.payload)
    while i < len(packet.payload):
        bnonce = bytes(nonce)
        cypher = crypto.encrypt(bnonce)
        for j  in range(16):
            try:
                out[i + j] = cypher[j] ^ packet.payload[i + j]
            except:
                pass
        nonce[15] += 1
        i += 16
    bpayload = bytes(out)
    packet.payload = bpayload
