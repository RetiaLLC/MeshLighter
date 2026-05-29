#!/bin/bash

# MeshLighter Basic Visualizer Startup Script

# Determine project root based on script location
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$DIR/.." && pwd )"

cd "$PROJECT_ROOT"

PORT="/dev/ttyACM0"
if [ ! -z "$1" ]; then
    PORT="$1"
fi

echo "[*] Starting MeshLighter Visualizer on $PORT..."

if [ ! -f "toolkit/venv/bin/python3" ]; then
    echo "[!] Python virtual environment not found at toolkit/venv!"
    echo "[!] Please run the setup instructions in the README first."
    exit 1
fi

# 1. Start the WebSocket Backend
export PYTHONPATH=toolkit/client:.
./toolkit/venv/bin/python3 visualizer/visual_server.py "$PORT" &
BACKEND_PID=$!

# 2. Start a simple HTTP server for the Frontend
cd visualizer
python3 -m http.server 8001 &
FRONTEND_PID=$!

echo "[*] Visualizer UI: http://localhost:8001"
echo "[*] Press Ctrl+C to stop."

# Wait for exit
trap "kill $BACKEND_PID $FRONTEND_PID; exit" INT
wait
