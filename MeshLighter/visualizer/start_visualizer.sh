#!/bin/bash

# MeshLighter Visualizer Startup Script

PORT="/dev/ttyACM0"
if [ ! -z "$1" ]; then
    PORT="$1"
fi

echo "[*] Starting MeshLighter Visualizer on $PORT..."

# 1. Start the WebSocket Backend
# Make sure we use the virtual environment
export PYTHONPATH=toolkit/client:client:.
./venv/bin/python3 MeshLighter/visualizer/visual_server.py "$PORT" &
BACKEND_PID=$!

# 2. Start a simple HTTP server for the Frontend
# Using Python's built-in http.server
cd MeshLighter/visualizer
python3 -m http.server 8001 &
FRONTEND_PID=$!

echo "[*] Visualizer UI: http://localhost:8001"
echo "[*] Press Ctrl+C to stop."

# Wait for exit
trap "kill $BACKEND_PID $FRONTEND_PID; exit" INT
wait
