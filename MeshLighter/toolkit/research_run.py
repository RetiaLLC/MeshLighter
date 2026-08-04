#!/usr/bin/env python3
"""research_run.py — gated launcher for the transmit-capable research templates.

    python3 research_run.py <template.py> [args...]

Requires an authorization affirmation (authgate) before it will run any injecting /
spoofing / stress template. The passive tools (radio_ctl scan/monitor, the browser
visualizer, mt_selftest, multichannel_test) do NOT go through here — they never TX.
"""
import sys, os, runpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from authgate import require_authorization

CAPABILITIES = [
    'Injects arbitrary Meshtastic frames (NodeInfo/Position/Telemetry/text/PortNum).',
    'Spoofs node identities, incl. PKI/"verified" nodes carrying a public key.',
    'Bypasses stock CSMA/CA + duty-cycle limits; can stress / flood a mesh.',
    'Accepted frames are rebroadcast by real nodes into the wider mesh.',
]

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    template = sys.argv[1]
    require_authorization('MeshLighter research toolkit: ' + os.path.basename(template),
                          CAPABILITIES)
    # hand off to the template with its own argv
    sys.argv = sys.argv[1:]
    client_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'client')
    sys.path.insert(0, client_dir)
    path = template if os.path.isabs(template) else os.path.join(client_dir, template)
    runpy.run_path(path, run_name='__main__')
