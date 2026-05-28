import sys
import os
import time
import struct
import asyncio
import websockets
import json
import threading

# Add parent and toolkit paths
sys.path.append(os.path.join(os.getcwd(), 'toolkit/client'))
sys.path.append(os.path.join(os.getcwd(), 'client'))

from mt_radio_serial import mt_radio_serial
from mt_lite import mt_lite
import pypb

# Thread-safe queue for packets
packet_queue = asyncio.Queue(maxsize=200)
clients = set()

async def register(websocket):
    print(f"[*] Frontend linked: {websocket.remote_address}")
    clients.add(websocket)
    try:
        await websocket.wait_closed()
    finally:
        clients.remove(websocket)

async def worker():
    """Consumes packets from the queue and broadcasts them."""
    print("[*] Broadcast worker active")
    while True:
        try:
            msg = await packet_queue.get()
            if not clients: 
                packet_queue.task_done()
                continue
            
            # Send to all connected frontends
            await asyncio.gather(*[ws.send(msg) for ws in clients], return_exceptions=True)
            packet_queue.task_done()
        except Exception as e:
            print(f"[!] Worker error: {e}")
            await asyncio.sleep(0.1)

def start_mesh_bridge(port, log_file=None):
    print(f"[*] Starting Mesh Bridge on {port}...")
    radio = None
    mesht = None
    last_loop = time.time()
    
    while True:
        try:
            if radio is None:
                # Add a timeout to prevent serial hangs
                import serial
                s = serial.Serial(port, 115200, timeout=0.1)
                radio = mt_radio_serial(port, diag=False)
                radio.ser = s # Replace with timeout-enabled serial
                mesht = mt_lite(radio)
                print("[*] Mesh Hardware Linked.")
            
            mesht.update()
            pkt = mesht.get()

            # Heartbeat for the bridge thread itself (log every 30s)
            if time.time() - last_loop > 30:
                print(f"[*] Bridge Loop Alive: {time.ctime()}")
                last_loop = time.time()
            
            if pkt:
                # 1. Log to file if requested
                if log_file:
                    with open(log_file, "a") as f:
                        log_entry = {
                            "time": time.time(),
                            "from": hex(pkt.src),
                            "to": hex(pkt.dest),
                            "type": pkt.decrypted,
                            "port": pkt.payload.get(1, 0) if pkt.decrypted else 0,
                            "raw": pkt.payload.get(2).hex() if (pkt.decrypted and pkt.payload.get(2)) else ""
                        }
                        f.write(json.dumps(log_entry) + "\n")

                print(f"[*] Received Packet: from={hex(pkt.src)} to={hex(pkt.dest)} type={pkt.decrypted}")
                # Basic packet info
                data = {
                    "from": hex(pkt.src),
                    "to": hex(pkt.dest),
                    "rssi": getattr(pkt, 'rssi', -100),
                    "hopLimit": getattr(pkt, 'hop_limit', 0),
                    "hopStart": getattr(pkt, 'hop_start', 0),
                    "type": "data",
                    "portnum": 0,
                    "payload": ""
                }
                
                if pkt.decrypted:
                    payload_map = pkt.payload
                    portnum = payload_map.get(1, 0)
                    data["portnum"] = portnum
                    
                    if portnum == 4: # NODEINFO
                        data["type"] = "nodeinfo"
                        user_bytes = payload_map.get(2)
                        if user_bytes:
                            user_map = pypb.protobuf(user_bytes).to_map()
                            data["name"] = user_map.get(2, b"Unknown").decode('utf-8', 'ignore')
                            data["sname"] = user_map.get(3, b"????").decode('utf-8', 'ignore')
                            data["hw"] = user_map.get(5, 0) # Hardware model
                    
                    elif portnum == 1: # TEXT_MESSAGE
                        data["type"] = "text"
                        text_bytes = payload_map.get(2)
                        if text_bytes:
                            data["payload"] = text_bytes.decode('utf-8', 'ignore')
                    
                    elif portnum == 67: # TELEMETRY
                        data["type"] = "telemetry"
                        telem_bytes = payload_map.get(2)
                        if telem_bytes:
                            # Try to extract battery
                            telem_map = pypb.protobuf(telem_bytes).to_map()
                            metrics_bytes = telem_map.get(2)
                            if metrics_bytes:
                                metrics_map = pypb.protobuf(metrics_bytes).to_map()
                                data["battery"] = metrics_map.get(1, 0)
                        
                    elif portnum == 3: # POSITION
                        data["type"] = "position"
                
                msg = json.dumps(data)
                try:
                    loop.call_soon_threadsafe(packet_queue.put_nowait, msg)
                except asyncio.QueueFull:
                    pass
            
            time.sleep(0.01)
        except Exception as e:
            print(f"[!] Bridge Error: {e}")
            radio = None
            time.sleep(5)

async def heartbeat():
    """Sends a dummy packet every 10 seconds to show liveness."""
    while True:
        await asyncio.sleep(10)
        data = {
            "from": "HB",
            "to": "ALL",
            "rssi": -50,
            "type": "heartbeat",
            "portnum": 0,
            "payload": "HEARTBEAT"
        }
        msg = json.dumps(data)
        if clients:
            await asyncio.gather(*[ws.send(msg) for ws in clients], return_exceptions=True)

async def main():
    global loop
    loop = asyncio.get_running_loop()
    
    port = sys.argv[1] if len(sys.argv) > 1 else "/dev/ttyACM0"
    log_file = "packet_dump.log" if "--log" in sys.argv else None
    
    # Start worker, bridge and heartbeat
    asyncio.create_task(worker())
    asyncio.create_task(heartbeat())
    threading.Thread(target=start_mesh_bridge, args=(port, log_file), daemon=True).start()
    
    print("[*] MeshLighter Visual Server Starting on ws://0.0.0.0:8081")
    async with websockets.serve(register, "0.0.0.0", 8081):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
