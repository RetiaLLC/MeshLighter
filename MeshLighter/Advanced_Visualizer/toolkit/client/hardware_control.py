import serial
import time
import sys

def reset_normal(port):
    print(f"Resetting {port} to Normal Mode...")
    s = serial.Serial(port)
    s.dtr = False
    s.rts = True # RESET Low
    time.sleep(0.1)
    s.rts = False # RESET High
    s.close()

def reset_bootloader(port):
    print(f"Resetting {port} to Download Mode...")
    s = serial.Serial(port)
    s.dtr = False
    s.rts = True # RESET Low
    time.sleep(0.1)
    s.dtr = True # IO0 Low
    time.sleep(0.1)
    s.rts = False # RESET High
    time.sleep(0.1)
    s.dtr = False # IO0 High
    s.close()

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python3 hardware_control.py [port] [normal|bootloader]")
        sys.exit(1)
    
    port = sys.argv[1]
    mode = sys.argv[2]
    
    if mode == 'normal':
        reset_normal(port)
    elif mode == 'bootloader':
        reset_bootloader(port)
