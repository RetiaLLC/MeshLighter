# MeshLighter: Meshtastic Protocol Research & Cinematic Visualization

MeshLighter is a high-performance, unrestricted implementation of the Meshtastic protocol designed for security researchers, network analysts, and digital artists. It transforms the **Waveshare ESP32-S3 Zero (Nibble)** into a raw "Radio Pipe," bypassing the official firmware's limitations to allow for direct RF-to-Python bridging.

---

## 📡 The "Radio Pipe" Concept

Standard Meshtastic firmware is designed for reliability and fairness, enforcing CSMA/CA (Carrier Sense Multiple Access with Collision Avoidance) and strict duty cycles. 

**MeshLighter breaks these rules.**

By running a minimalist firmware core, the Nibble acts as a raw modem that simply passes every valid LoRa packet it sees over Serial to your computer. This "Pipe" allows you to:
- **Inject Custom Packets:** Send messages, positions, and telemetry without waiting for mesh clearance.
- **Identity Research:** Spoof dozens of "Verified" nodes with Ed25519 signatures in seconds.
- **Deep Analysis:** Capture and log raw mesh traffic for offline study.
- **Artistic Visualization:** Use Python-decoded data to drive high-fidelity cinematic dashboards.

---

## 📂 Repository Contents

- `/firmware`: Minimalist ESP32-S3 source code (PlatformIO) designed for the Nibble Zero.
- `/binaries`: Pre-compiled "Factory" binaries for one-click deployment.
- `/toolkit`: A suite of Python research tools for node injection, spoofing, and stress-testing.
- `/Advanced_Visualizer`: The "Neural Mesh" V3.9—a P5.js based cinematic tactical HUD for real-time traffic monitoring.

---

## 🚀 Quickstart Guide

### 1. Hardware Preparation
#### Option A: Quick Flash (Nibble Zero Only)
If you have a Waveshare ESP32-S3 Zero (Nibble), use the pre-compiled factory binary for immediate deployment:
```bash
# Using esptool (from the binaries/ folder)
esptool.py --chip esp32s3 write_flash 0x0 binaries/nibble_zero_factory.bin
```

#### Option B: Compile from Source (Any Supported Board)
If you want to modify the firmware or compile for a different board (like the Heltec V3 or T-Beam):
1. Install [PlatformIO](https://platformio.org/) via VSCode or the CLI.
2. Open the `firmware/` directory.
3. Build and upload using the CLI:
   ```bash
   cd firmware
   pio run -e nibble_zero -t upload
   ```
*(Available environments in `platformio.ini`: `nibble_zero`, `heltec_v3`, `heltec_v4`, `nugget_connect`)*

### 2. Setup the Toolkit
Requires Python 3.10+
```bash
cd toolkit
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3. Spoofing & Injecting Nodes
Use `ClownCar2.py` to populate the mesh with virtual, verified identities:
```bash
export PYTHONPATH=toolkit/client:.
# Inject 10 verified nodes with unique Ed25519 keys
python3 toolkit/client/ClownCar2.py /dev/ttyACM0 --name "ResearchNode" --count 10
```

### 4. Sending Custom Messages
```bash
# Send a direct text message from a spoofed ID
python3 toolkit/client/tx_real.py /dev/ttyACM0 "Hello from the Neural Mesh"
```

### 5. Monitoring & Visualization
Launch the **Neural Mesh V3.9** dashboard to see traffic flowing around you:
```bash
./start.sh /dev/ttyACM0
```
- **URL:** [http://localhost:8002](http://localhost:8002)
- **Features:** Chirp Nexus icons, Source Tethers, Neural Bonding, and 1-hour persistence.

---

## 🛰 Visualizer Mechanics
The Advanced Visualizer translates raw RF traffic into a real-time map based on packet metadata:
- **Nodes:** Represented by rotating arcs. A force-directed physics engine spaces them apart to prevent UI overlap. When a node announces itself (`NodeInfo`), it moves to the center of the screen for 20 seconds.
- **Packets:** Particle size is directly scaled by RSSI (signal strength). Colors indicate packet type: Purple (`NodeInfo`), Orange (`Text`), Cyan (`Position`), Green (`Telemetry`), and Red (`System Sync`).
- **Routing Topology:** Moving packets draw a line back to their origin node. Directed messages between two nodes create a persistent link connecting them to map active communication paths.
- **Text Messages:** Decoded text payloads are displayed in anchored, multi-line boxes above the transmitting node for 15 seconds.

---

## 📜 Credits & Acknowledgments
MeshLighter is directly based on the original **lora-lite** repository, which serves as both the source of the foundational code and the primary inspiration for this project. We extend our deepest gratitude to the creators of lora-lite for pioneering the minimalist Meshtastic bridging concept, enabling this "Art and Science" visualization and research toolkit to exist.

---

## ⚠️ Research Notice
This tool is for **internal security and protocol research only**. It allows for the injection of raw, unfiltered traffic. Use this power to strengthen the mesh, analyze boundaries, and create beautiful representations of our invisible networks.
