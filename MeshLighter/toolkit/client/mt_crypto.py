try:                                            # pycryptodome (Crypto) or pycryptodomex (Cryptodome)
    from Crypto.Cipher import AES
    from Crypto.Util import Counter
except ImportError:
    from Cryptodome.Cipher import AES
    from Cryptodome.Util import Counter

class aesctr:
    def __init__(self,iv,key):
        self.iv=iv
        self.key=key
        

def encrypt_packet(packet,psk):
    nonce = [0] * 16
    nonce[0:4] = packet.seq.to_bytes(4,byteorder='little')   # packet id -> nonce bytes 0..3
    # FIX (2026-08-01): Meshtastic nonce layout is id(4) | 0(4) | fromNode(4) | 0(4).
    # fromNode belongs at bytes 8..11, not 4..7. The old [4:8] produced a wrong keystream,
    # so every injected packet was rejected by real nodes as "bad psk / Invalid protobufs".
    nonce[8:12] = packet.src.to_bytes(4,byteorder='little')  # fromNode -> nonce bytes 8..11
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
