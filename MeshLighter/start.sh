#!/bin/bash

# MeshLighter Launch Script

PORT="/dev/ttyACM0"
if [ ! -z "$1" ]; then
    PORT="$1"
fi

./Advanced_Visualizer/start_advanced.sh "$PORT"
