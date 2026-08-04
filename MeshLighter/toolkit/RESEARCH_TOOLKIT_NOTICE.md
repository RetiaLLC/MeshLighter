# Research toolkit — capability & authorization notice

This `toolkit/` is **transmit-capable**. It drives the radio-pipe firmware to inject
arbitrary Meshtastic frames and to spoof node identities (including PKI/"verified"
nodes with a public key). It bypasses the stock CSMA/CA and duty-cycle limits and can
stress or flood a mesh. **Accepted injections are rebroadcast by real nodes into the
wider mesh** and linger in third-party node databases until they age out.

## Passive-public + gated-offensive
- **Gate-free (passive, never transmits):** the browser visualizer, read-only decode,
  `radio_ctl.py scan` (RSSI sweep) and `radio_ctl.py monitor`, `mt_selftest.py`,
  `multichannel_test.py`.
- **Behind the authorization gate (transmit-capable):** every injecting/spoofing/stress
  template in `client/`. Run them via `research_run.py`, which requires an
  "I am authorized" affirmation (`authgate.py`; set `MESHLIGHTER_AUTHORIZED=1` for CI).
- **Not published until disclosure:** keep this offensive toolkit in a private repo,
  un-browserified, and not bundled into any public site. Release after the talk's
  ethical disclosure.

## Honest labeling
The firmware is a **raw radio pipe**: it ships inert (does nothing on its own, bundles
no attack tooling) and transmits arbitrary frames only when a host program drives it.
Label it for what it *can* do, not the mode you hope people use. Transmitting against
networks you do not own may be illegal.

## For a live demo
Working injects propagate into real meshes. Use a shielded enclosure or a **private
channel/frequency** off the public LongFast slot (`radio_ctl.py <port> private <mhz>`,
then set your demo nodes to match), keep counts small, and use obvious test names.
