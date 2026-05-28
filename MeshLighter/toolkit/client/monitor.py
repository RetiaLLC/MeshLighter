import serial
import sys
import time

def monitor(port):
    print(f"Monitoring {port}...")
    ser = serial.Serial(port, 115200, timeout=1)
    while True:
        if ser.in_waiting > 0:
            data = ser.read(ser.in_waiting)
            try:
                print(data.decode('utf-8', 'ignore'), end='', flush=True)
            except:
                print(data.hex(), end='', flush=True)
        time.sleep(0.1)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 monitor.py [port]")
        sys.exit(1)
    monitor(sys.argv[1])
