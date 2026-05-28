#!/bin/bash

# MeshLighter Launch Script

PORT="/dev/ttyACM0"
if [ ! -z "$1" ]; then
    PORT="$1"
fi

cd Advanced_Visualizer
./start_advanced.sh "$PORT"
