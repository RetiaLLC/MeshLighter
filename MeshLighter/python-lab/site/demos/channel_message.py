# Channel message — INJECTION (tick "I am authorized to transmit" first).
# Send a single text message onto a channel, as if from a node you name. It lands in the
# visualizer's Channel Messages pane and in the inbox of every real node on that channel.
#
# A "channel" in Meshtastic is a name + a PSK. Public traffic uses the name "LongFast" with
# the default key. A different NAME (same default key) is a different, separately-hashed
# channel. For a truly private channel, pass your own 16- or 32-byte PSK as KEY.
from device import dev
import mesh

FROM_ID   = 0x5EC0CA11            # the node id the message appears to come from
FROM_NAME = ("Base Station", "BASE")   # (long name, short name) announced before the message
CHANNEL   = "LongFast"            # channel NAME to send on
KEY       = 1                     # 1 = default public key; or a list of 16/32 bytes for a private PSK
MESSAGE   = "MeshLighter test message. Ignore."

dev.connect()
ch = mesh.channel(CHANNEL, KEY)
print(f'channel "{CHANNEL}"  hash=0x{ch.getHash():02x}')

# Announce the sender so it shows with a name (optional but tidy), then send the text.
dev.send_nodeinfo(FROM_ID, FROM_NAME[0], FROM_NAME[1], channel=ch)
ok = dev.send_text(FROM_ID, MESSAGE, channel=ch)
print(f'sent from {FROM_NAME[1]} ({hex(FROM_ID)}) on "{CHANNEL}"  ack={ok}')
print('"%s"' % MESSAGE)
