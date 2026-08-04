#!/usr/bin/env python3
"""authgate.py — authorization affirmation for transmit-capable / disruptive modules.

Passive-public + gated-offensive: the read-only surface (visualize, decode, RSSI
scan, monitor) is gate-free. Anything that TRANSMITS or can disrupt a mesh must pass
this gate. Honest labeling is the rule — name the real capability; never relabel a
transmit-capable action as "passive".

Non-interactive/CI: set MESHLIGHTER_AUTHORIZED=1 to affirm authorization up front.
"""
import os, sys

def require_authorization(tool, capabilities):
    if os.environ.get('MESHLIGHTER_AUTHORIZED') == '1':
        return True
    line = '=' * 70
    print(line)
    print('  AUTHORIZATION REQUIRED  —  ' + tool)
    print(line)
    print('  This module is TRANSMIT-CAPABLE and can affect other radios / meshes:')
    for c in capabilities:
        print('    - ' + c)
    print()
    print('  Use ONLY on hardware and RF you own or are EXPLICITLY authorized to test.')
    print('  Transmitting against networks you do not own may be illegal. Working')
    print('  injections propagate into — and can disrupt — real meshes and persist')
    print('  in third-party node databases until they age out.')
    print(line)
    try:
        ans = input('  Type  I am authorized  to proceed: ').strip().lower()
    except EOFError:
        ans = ''
    if ans != 'i am authorized':
        print('  Not authorized — aborting.')
        sys.exit(2)
    return True
