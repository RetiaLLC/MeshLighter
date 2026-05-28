import sys
import time
import struct
import serial

from mt_radio_serial import mt_radio_serial
from mt_lite import mt_lite

def test_config_rw(mesht):
    print("Testing Config Read/Write...")
    # Read original frequency
    orig_cfg = mesht.get_config('freq')
    orig_freq = struct.unpack('<f', orig_cfg)[0]
    print(f"Original Freq: {orig_freq}")

    # Set new frequency
    test_freq = 915.000
    print(f"Setting Test Freq: {test_freq}")
    mesht.set_config('freq', struct.pack('<f', test_freq))
    
    # Read back to verify
    time.sleep(0.5)
    new_cfg = mesht.get_config('freq')
    new_freq = struct.unpack('<f', new_cfg)[0]
    print(f"Read Back Freq: {new_freq}")

    if abs(new_freq - test_freq) < 0.001:
        print("PASS: Config R/W verified.")
        return True
    else:
        print("FAIL: Config R/W mismatch.")
        return False

def test_persistence(mesht, port):
    print("Testing NVDATA Persistence...")
    test_freq = 916.123
    print(f"Setting Persistence Test Freq: {test_freq}")
    mesht.set_config('freq', struct.pack('<f', test_freq))
    mesht.save_config()
    time.sleep(1)

    print("Restarting Node...")
    mesht.restart()
    time.sleep(5) # Wait for reboot and port reappearance

    # Reconnect
    try:
        radio = mt_radio_serial(port)
        mesht = mt_lite(radio)
        new_cfg = mesht.get_config('freq')
        new_freq = struct.unpack('<f', new_cfg)[0]
        print(f"After Reboot Freq: {new_freq}")

        if abs(new_freq - test_freq) < 0.001:
            print("PASS: Persistence verified.")
            return True
        else:
            print("FAIL: Persistence failed.")
            return False
    except Exception as e:
        print(f"FAIL: Error during persistence test: {e}")
        return False

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 master_test.py [serial_port]")
        sys.exit(1)

    port = sys.argv[1]
    print(f"Connecting to {port}...")
    
    try:
        radio = mt_radio_serial(port, diag=True)
        mesht = mt_lite(radio)
        
        # Test 1
        if not test_config_rw(mesht):
            sys.exit(1)

        # Test 2
        if not test_persistence(mesht, port):
            sys.exit(1)

        print("\nALL SERIAL TESTS PASSED!")
        
    except Exception as e:
        print(f"CRITICAL ERROR: {e}")
        sys.exit(1)
