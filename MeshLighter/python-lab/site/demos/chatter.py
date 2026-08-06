# Mesh chatter — INJECTION (tick "I am authorized to transmit" first).
# Play a scripted conversation between two verified nodes on a channel. Each node announces
# itself with a 32-byte key (the padlock in Meshtastic), then trades messages on a timed
# script. Watch it stream into the visualizer's Channel Messages pane.
from device import dev
import mesh

CHANNEL = "LongFast"              # channel NAME the two nodes talk on
KEY     = 1                       # 1 = default public key; or a list of 16/32 bytes for a private PSK

# Two participants: (node_id, long_name, short_name) — node ids are 32-bit
ALICE = (0x5EC0A11C, "Alice",  "ALIC")
BOB   = (0x5EC0B0B0, "Bob",    "BOB")

# The conversation. Each line is (speaker, text, pause_after_seconds).
SCRIPT = [
    (ALICE, "Bob, you around? Testing the new repeater on the ridge.",     3.0),
    (BOB,   "Copy Alice, loud and clear. Signal looks solid from up here.", 2.5),
    (ALICE, "Nice. What's your battery at?",                                2.0),
    (BOB,   "78% and charging. Solar finally caught up after the storm.",   3.0),
    (ALICE, "Good deal. I'll route the north cluster through you tonight.", 2.5),
    (BOB,   "Sounds good. I'll keep an ear on the channel. 73!",            2.0),
    (ALICE, "73!",                                                          1.5),
]

dev.connect()
ch = mesh.channel(CHANNEL, KEY)
print(f'chatter on "{CHANNEL}" (hash 0x{ch.getHash():02x}) between {ALICE[1]} and {BOB[1]}')

# Announce both as verified (with the lock) so they show as established nodes.
for nid, long, short in (ALICE, BOB):
    dev.send_nodeinfo(nid, long, short, verified=True, channel=ch)
    print(f'  {short} on the air (verified)')
    dev.sleep(0.8)

print('--- conversation ---')
for (nid, long, short), text, pause in SCRIPT:
    ok = dev.send_text(nid, text, channel=ch)
    print(f'  {short}: {text}')
    dev.sleep(pause)
print('conversation complete.')
