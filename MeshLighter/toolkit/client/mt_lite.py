import sys
import traceback

import pypb
import mt_packet
import mt_crypto
import mt_channel
from mt_packet import mt_packet

class mt_lite:
    def __init__(self,radio,logfile = None):
        self.radio = radio

        mt_channel.add_channel('LongFast',1)
        
    def update(self):
        self.radio.update()

    def decode(self,buff):
        try:
            pb = pypb.protobuf(buff).to_map()
        except:
            return None
        mtp = None
        if 1 in pb and pb[1] == 1:
            raw = pb[2]
            mtp = None
            try:
                mtp = mt_packet(raw)
            except:
                return None
            mtp.rssi = pb.get(3, 0)
            if mtp.rssi>= 2**31:
                mtp.rssi -= 2**32
            snr_raw = pb.get(4, 0)              # #5 metadata: SNR (x4) + rx timestamp
            if snr_raw >= 2**31: snr_raw -= 2**32
            mtp.snr = snr_raw / 4.0
            mtp.rxtime = pb.get(6, 0)
            try:
                chan = mt_channel.get_channel_by_hash(mtp.hash)
                mt_crypto.encrypt_packet(mtp,chan.key)
                dec = pypb.protobuf(mtp.payload).to_map()
                mtp.decrypted = True
                mtp.payload = dec
            except:
                pass
            
        return mtp

    def get_raw(self):
        return self.radio.read()

    def get(self):
        msg = self.radio.read()
        if msg != None:
            dec = self.decode(msg)
            return dec
        return None
    
    def send(self,msg,wait_ack=True,ack_timeout=2.0):
        if msg.decrypted == True:
            chan = mt_channel.get_channel_by_hash(msg.hash)
            mt_crypto.encrypt_packet(msg,chan.key)
        msg.decrypted = False
        wrapper = pypb.protobuf()
        wrapper.encode(1,pypb.PB_VARINT,1)
        wrapper.encode(2,pypb.PB_STRING,msg.to_buffer())
        self.radio.write(wrapper.get_buffer())
        if wait_ack:
            return self.wait_ack(ack_timeout)   # #2 flow control: block until TX done
        return True

    def wait_ack(self,timeout=2.0):
        # Block until the firmware's TX-done ACK ({1:3}) or timeout. Paces injection
        # to actual LoRa airtime so the device RX buffer never overflows.
        import time
        t=time.time()
        while time.time()-t < timeout:
            self.update()
            raw=self.radio.read()
            if raw is not None:
                try:
                    if pypb.protobuf(bytes(raw)).to_map().get(1)==3:
                        return True
                except Exception:
                    pass
            time.sleep(0.005)
        return False

    def get_config(self,key):
        wrapper = pypb.protobuf()
        wrapper.encode(1,pypb.PB_VARINT,2)
        wrapper.encode(2,pypb.PB_VARINT,0)
        wrapper.encode(3,pypb.PB_STRING,key)
        self.radio.write(wrapper.get_buffer())
        msg = None
        while msg == None:
            self.update()
            msg = self.radio.read()
        pb = pypb.protobuf(msg)
        return pb.to_map()[3]
    
    def set_config(self,key,value):
        wrapper = pypb.protobuf()
        wrapper.encode(1,pypb.PB_VARINT,2)
        wrapper.encode(2,pypb.PB_VARINT,1)
        wrapper.encode(3,pypb.PB_STRING,key)
        wrapper.encode(4,pypb.PB_STRING,value)
        self.radio.write(wrapper.get_buffer())
        
    def save_config(self):
        wrapper = pypb.protobuf()
        wrapper.encode(1,pypb.PB_VARINT,2)
        wrapper.encode(2,pypb.PB_VARINT,2)
        self.radio.write(wrapper.get_buffer())
    
    def restart(self):
        wrapper = pypb.protobuf()
        wrapper.encode(1,pypb.PB_VARINT,2)
        wrapper.encode(2,pypb.PB_VARINT,3)
        self.radio.write(wrapper.get_buffer())

    def _cfg(self, op, extra=None):
        w = pypb.protobuf()
        w.encode(1, pypb.PB_VARINT, 2)   # command = config/control
        w.encode(2, pypb.PB_VARINT, op)  # operation
        if extra:
            for fid, val in extra:
                w.encode(fid, pypb.PB_VARINT, val)
        self.radio.write(w.get_buffer())

    def apply_live(self):
        # #3 apply the current NVDATA PHY params to the radio live (no reboot).
        self._cfg(4)

    def set_sniff(self, sync=0x12, crc=False):
        # #5 promiscuous: set LoRa sync word (0x2B Meshtastic / 0x12 generic) + CRC.
        self._cfg(5, [(3, sync & 0xff), (4, 1 if crc else 0)])

    def scan(self, start_khz=902000, end_khz=928000, step_khz=250, dwell_ms=25, timeout=25.0):
        # #6 spectrum sweep -> list of (freq_khz, rssi_dbm), highest first.
        import time
        self._cfg(6, [(3, start_khz), (4, end_khz), (5, step_khz), (6, dwell_ms)])
        out = []; t = time.time()
        while time.time() - t < timeout:
            self.update()
            raw = self.radio.read()
            if raw is not None:
                try:
                    m = pypb.protobuf(bytes(raw)).to_map()
                    if m.get(1) == 4:
                        f = m.get(2, 0); r = m.get(3, 0)
                        if r >= 2**31: r -= 2**32
                        out.append((f, r))
                    elif m.get(1) == 5:
                        break   # scan complete
                except Exception:
                    pass
            time.sleep(0.002)
        return out
