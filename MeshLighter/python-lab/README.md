# MeshLighter Python Lab (browser)

A static page: write Python in the browser, click Run, and it drives a **connected
radio-pipe Nibble** over Web Serial. Pyodide (CPython in WASM) runs the code; a JS
bridge does the `0x94 0xC3` framing; `mesh.py` (pure-Python AES-128) builds/decrypts
Meshtastic packets — no pyserial, no backend, no install. Modelled on the ESP32
Bit-Pirate Python lab.

## Run it (local, Chromium browser)
```
cd python-lab/site
python3 -m http.server 8000     # then open http://localhost:8000
```
Web Serial needs Chrome/Edge/Opera over HTTPS or localhost. Click **Connect**, pick the
Nibble's port, choose a demo, **Run**. No hardware? open `http://localhost:8000/?demo=1`
for the built-in mock radio-pipe.

## Passive vs gated
- **Passive, always on:** `scan` (RSSI sweep) and `monitor` (decode RX). Never transmit.
- **Injection demos** (`ghost_fleet`, `verified_nodes`, `silent_alarm`, `position_spoof`)
  are **gated**: tick **"I am authorized to transmit"** first, or `dev.require_auth()`
  raises. Working injects propagate into real meshes.

## Do NOT deploy this publicly before disclosure
This browserifies transmit-capable injection tooling. Keep it **local / private** (this
repo's remote is public — see RESEARCH_TOOLKIT_NOTICE.md). For a shielded demo, use
`private_channel.py` to move the pipe off the public LongFast slot.

## Files
- `site/index.html` + `site/src/{app.js,serial.js,styles.css}` — the lab (Pyodide/Monaco/xterm + binary bridge + mock)
- `site/mesh.py` — pure-Python Meshtastic toolkit (AES-CTR, protobuf, packet build/parse). Bench-validated.
- `site/src/device_shim.py` — the `dev` object (scan/monitor/inject/config) demos import
- `site/demos/*.py` — the demos + `demos.json` manifest
