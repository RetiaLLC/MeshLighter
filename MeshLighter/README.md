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
1. Connect your **Waveshare ESP32-S3 Zero** (Nibble) with an **SX1262** LoRa module.
2. Flash the factory binary:
   ```bash
   esptool.py --chip esp32s3 write_flash 0x0 binaries/nibble_zero_factory.bin
   ```

### 2. Toolkit Environment
```bash
cd toolkit
python3 -m venv venv
source venv/bin/activate
pip install pycryptodome pyserial cryptography websockets
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

## 🛰 Visualization Aesthetic
The **Advanced Visualizer** is designed to reveal the "social" structure of the mesh:
- **Chirp Nexuses:** Rotating icons inspired by LoRa spread spectrum modulation.
- **Neural Bonds:** Persistent glowing lines connect nodes that talk to each other.
- **Source Tethers:** Every packet in flight is anchored to its origin station.
- **Tactical Bubbles:** Decoded text messages appear in high-contrast, multi-line speech bubbles.

---

## 📜 Credits & Acknowledgments
MeshLighter is directly based on the original **lora-lite** repository, which serves as both the source of the foundational code and the primary inspiration for this project. We extend our deepest gratitude to the creators of lora-lite for pioneering the minimalist Meshtastic bridging concept, enabling this "Art and Science" visualization and research toolkit to exist.

---

## ⚠️ Research Notice
This tool is for **internal security and protocol research only**. It allows for the injection of raw, unfiltered traffic. Use this power to strengthen the mesh, analyze boundaries, and create beautiful representations of our invisible networks.
