import base64

channel_list = {}

# Meshtastic default PSK (the well-known "AQ==" key, PSK index 1).
DEFAULT_KEY = [0xd4, 0xf1, 0xbb, 0x3a, 0x20, 0x29, 0x07, 0x59,
               0xf0, 0xbc, 0xff, 0xab, 0xcf, 0x4e, 0x69, 0x01]

def add_channel(name, key):
    ch = channel(name, key)
    channel_list[ch.getHash()] = ch      # keyed by hash -> decode auto-selects [#7]
    return ch

def add_channel_psk(name, psk):
    """Register a channel from a base64 PSK string or raw key bytes (multi-key decode)."""
    return add_channel(name, psk)

def register_defaults():
    add_channel('LongFast', 1)           # the public default channel
    return channel_list

def get_channel_by_hash(h):
    return channel_list[h]

class channel:
    def __init__(self, name, key):
        self.name = name
        if key == 1 or key == b'\x01' or key == 'AQ==':
            self.key = list(DEFAULT_KEY)              # PSK index 1 -> default key
        elif isinstance(key, str):
            self.key = list(base64.b64decode(key))    # base64 PSK (Meshtastic channel URL)
        elif isinstance(key, (bytes, bytearray, list)):
            self.key = list(key)
        else:
            self.key = list(DEFAULT_KEY)

    def getHash(self):
        # Meshtastic channel hash = xor(name bytes) ^ xor(psk bytes).
        h = 0
        for c in self.name:
            h ^= ord(c)
        for c in self.key:
            h ^= c
        return h
