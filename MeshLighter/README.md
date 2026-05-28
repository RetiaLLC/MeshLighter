# MeshLighter: Advanced Meshtastic Protocol Research Toolkit

MeshLighter is a minimalist, unrestricted implementation of the Meshtastic protocol designed for boundary testing, mesh analysis, and security research. It turns the **Waveshare ESP32-S3 Zero (Nibble Zero)** into a raw LoRa modem that bypasses official firmware limitations.

---

## 📊 Project Status & Proofs of Concept

| Proof of Concept (POC) | Status | Description |
| :--- | :--- | :--- |
| **ClownCar (Standard)** | ✅ VALIDATED | 100% success rate in injecting 50+ virtual nodes at high speed. |
| **ClownCar2 (Verified)** | ✅ VALIDATED | Successfully achieves "Green Lock" status via real-time Ed25519 key generation. |
| **Silent Alarm** | ✅ VALIDATED | Verified propagation of custom PortNums (77) across the mesh. |
| **DementedEcho** | ✅ VALIDATED | Successfully cloned node identities 20x to create network chaff. |
| **Neural Symphony** | ✅ VALIDATED | 5-node autonomous conversation demonstrating tactical UI. |
| **UwU Fleet / Bee Movie** | ✅ VALIDATED | High-stress text payload injections proving stable visualizer wrap capabilities. |

---

## 🛠 Hardware Requirements
*   **MCU:** Waveshare ESP32-S3 Zero (Nibble Zero) (or Heltec/T-Beam variants via PlatformIO).
*   **LoRa:** SX1262 module connected via defined pins.
*   **OLED:** SSD1306 (I2C) for local status display.

---

## 🚀 Quickstart Guide

### 1. Flash the Firmware
If you have a Nibble Zero, use the pre-compiled factory binary for immediate deployment:
```bash
# Using esptool (from binaries/ folder)
esptool.py --chip esp32s3 write_flash 0x0 binaries/nibble_zero_factory.bin
```
*Alternatively, compile from source in the `firmware/` directory using PlatformIO.*

### 2. Setup the Toolkit
Requires Python 3.10+
```bash
cd toolkit
python3 -m venv venv
source venv/bin/activate
pip install pycryptodome pyserial cryptography websockets
```

### 3. Start the Advanced Visualizer (Neural Mesh V3.9)
We include start/stop scripts at the root. The visualizer features a high-fidelity "Chirp Nexus" UI with tactical tethering, robust physics, node longevity, and persistent message tracking.
```bash
./start.sh /dev/ttyACM0
```
*   **UI:** `http://localhost:8002`
*   **Logs:** Packet traces are saved to `MeshLighter/Advanced_Visualizer/packet_dump.log`.

### 4. Run a Research Injection Demo
In a new terminal window (using a second attached node):
```bash
export PYTHONPATH=toolkit/client:.
# Run the 5-node Neural Symphony
python3 toolkit/client/neural_symphony.py /dev/ttyACM2
```

To stop the visualizer:
```bash
./stop.sh
```

---

## 🛰 The Advanced Visualizer Features

- **Chirp Nexus Icons:** Nodes render dynamically using LoRa-inspired up/down chirps.
- **Source Tethers & Speech Bubbles:** Text messages are anchored directly to their source with multi-line tactical wrapping.
- **Neural Bonds:** Directed messages between two nodes result in persistent glowing links connecting them.
- **Center-Stage Physics:** Newly announcing nodes fly to the center of your screen for 20 seconds.
- **Persistent Logging:** Full traffic dumps, including decrypted telemetry and text payloads.

---

## ⚠️ Research Notice
This tool is for **internal security and protocol research only**. It allows for the injection of raw, unfiltered traffic that bypasses mesh fairness (CSMA/CA) and identity checks. Use to strengthen, not degrade, the mesh. Developed for the Meshtastic community by internal researchers.
