#!/bin/bash

# MeshLighter Advanced Visualizer Startup Script

PORT="/dev/ttyACM0"
if [ ! -z "$1" ]; then
    PORT="$1"
fi

echo "[*] Starting MeshLighter ADVANCED Visualizer on $PORT..."

# 1. Start the WebSocket Backend
export PYTHONPATH=toolkit/client:client:.
./venv/bin/python3 MeshLighter/Advanced_Visualizer/visual_server.py "$PORT" --log &
BACKEND_PID=$!

# 2. Start a simple HTTP server for the Frontend
cd MeshLighter/Advanced_Visualizer
python3 -m http.server 8002 &
FRONTEND_PID=$!

echo "[*] Advanced Visualizer UI: http://localhost:8002"
echo "[*] Press Ctrl+C to stop."

# Wait for exit
trap "kill $BACKEND_PID $FRONTEND_PID; exit" INT
wait
