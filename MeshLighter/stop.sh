#!/bin/bash

# MeshLighter Stop Script

echo "[*] Stopping MeshLighter Visualizer..."
fuser -k 8002/tcp 8081/tcp 2>/dev/null
killall python3 2>/dev/null
echo "[*] Stopped."
