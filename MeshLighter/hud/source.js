/*
 * source.js — read-only data source. Web Serial (passive, never transmits) decodes
 * live radio-pipe traffic via mesh-decode.js into MeshModel; Demo Mode synthesizes a
 * believable public mesh covering the full range of Meshtastic packet types so every
 * HUD panel comes alive with no hardware. Exposes window.VizSource.
 */
(function () {
  const M = () => window.MeshModel, D = () => window.MeshDecode;
  let port = null, reader = null, reading = false, deframe = null, demoTimer = null;
  let mode = "idle", status = { text: "IDLE", color: "#6f97a8" };
  const setStatus = (text, color) => { status = { text, color }; };

  // ---------------- Web Serial (read only) ----------------
  async function connect() {
    if (!("serial" in navigator)) { setStatus("NO WEB SERIAL", "#ff5a6a"); return; }
    stopDemo();
    try {
      port = await navigator.serial.requestPort(); await port.open({ baudRate: 115200 });
      try { await port.setSignals({ dataTerminalReady: true, requestToSend: false }); } catch {}
      mode = "serial"; reading = true; deframe = D().makeDeframer(); setStatus("LIVE · READ-ONLY", "#35ff9e");
      readLoop();
    } catch (e) { setStatus("CONNECT FAILED", "#ff5a6a"); }
  }
  async function disconnect() {
    reading = false; try { if (reader) await reader.cancel(); } catch {} try { if (port) await port.close(); } catch {}
    port = null; reader = null; if (mode === "serial") { mode = "idle"; setStatus("IDLE", "#6f97a8"); }
  }
  async function readLoop() {
    while (port && port.readable && reading) {
      reader = port.readable.getReader();
      try { for (;;) { const { value, done } = await reader.read(); if (done) break; if (value) deframe(value, onFrame); } }
      catch {} finally { try { reader.releaseLock(); } catch {} reader = null; }
    }
  }
  async function onFrame(frame) {
    const rx = D().wrapperToRx(frame); if (!rx) return;
    const pkt = await D().decodePacket(rx.raw, { rssi: rx.rssi, snr: rx.snr }); if (pkt) M().ingest(pkt);
  }

  // ---------------- Demo Mode ----------------
  const NODES = [
    { num: 0x4d0c1234, name: "Base Camp", sname: "BASE", hw: 4, role: 2, key: true, lat: 37.7749, lon: -122.4194 },
    { num: 0xa1b2c3d4, name: "Ridge Relay", sname: "RIDG", hw: 43, role: 4, key: true, lat: 37.7812, lon: -122.4102 },
    { num: 0x77aa0001, name: "Trailhead", sname: "TRL", hw: 9, role: 0, key: false, lat: 37.7690, lon: -122.4260 },
    { num: 0x0badf00d, name: "River Node", sname: "RIVR", hw: 1, role: 6, key: false, lat: 37.7655, lon: -122.4330 },
    { num: 0xc0ffee01, name: "K6MESH", sname: "K6M", hw: 255, role: 3, key: true, lat: 37.7900, lon: -122.4010 },
    { num: 0x1a2b3c4d, name: "Summit", sname: "SMT", hw: 43, role: 5, key: false, lat: 37.7950, lon: -122.3980 },
    { num: 0x2e55100a, name: "Overlook", sname: "OVLK", hw: 31, role: 0, key: true, lat: 37.7860, lon: -122.4150 },
    { num: 0x3f11a2b0, name: "Meadow", sname: "MDW", hw: 9, role: 6, key: false, lat: 37.7720, lon: -122.4190 },
  ];
  const CHATTER = ["on my way", "anyone on ch2?", "clear skies at the ridge", "battery getting low",
    "QSL 73", "trail closed past mile 4", "wx: -3C, wind NW", "meshing from the summit ✨", "who's monitoring?"];
  const hexid = (n) => "0x" + (n >>> 0).toString(16);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rr = (a, b) => a + Math.random() * (b - a);
  const bat = new Map();
  const meta = () => ({ channel: 8, rssi: Math.round(rr(-112, -58)), snr: +rr(-16, 11).toFixed(1),
    hops: Math.random() < 0.5 ? 0 : (Math.random() * 3 + 1) | 0, mqtt: Math.random() < 0.12 });

  function nodeinfo(n) { M().ingest({ from: hexid(n.num), to: M().BROADCAST, ...meta(), portnum: 4, type: "nodeinfo",
    name: n.name, sname: n.sname, hw: n.hw, role: n.role, hasKey: n.key }); }
  function tick() {
    const n = pick(NODES), from = hexid(n.num), roll = Math.random();
    if (roll < 0.14) nodeinfo(n);
    else if (roll < 0.34) { // position
      M().ingest({ from, to: M().BROADCAST, ...meta(), portnum: 3, type: "position",
        lat: +(n.lat + rr(-0.002, 0.002)).toFixed(5), lon: +(n.lon + rr(-0.002, 0.002)).toFixed(5), alt: (rr(20, 400) | 0) });
    } else if (roll < 0.6) { // telemetry (device, + env for sensors)
      let b = bat.get(n.num) ?? (rr(35, 100) | 0); b = Math.max(6, b - (Math.random() < 0.25 ? 1 : 0)); bat.set(n.num, b);
      const p = { from, to: M().BROADCAST, ...meta(), portnum: 67, type: "telemetry",
        battery: b, voltage: +rr(3.5, 4.2).toFixed(2), chanUtil: +rr(2, 34).toFixed(1), airUtil: +rr(1, 9).toFixed(1) };
      if (n.role === 6) { p.temp = +rr(-4, 28).toFixed(1); p.humidity = rr(30, 92) | 0; p.pressure = rr(990, 1025) | 0; }
      M().ingest(p);
    } else if (roll < 0.76) { // text (broadcast or DM)
      const dm = Math.random() < 0.4, dst = pick(NODES.filter((x) => x.num !== n.num));
      M().ingest({ from, to: dm ? hexid(dst.num) : M().BROADCAST, ...meta(), portnum: 1, type: "text", payload: pick(CHATTER) });
    } else if (roll < 0.85) { // routing ack
      M().ingest({ from, to: hexid(pick(NODES.filter((x) => x.num !== n.num)).num), ...meta(), portnum: 5, type: "routing", ack: true });
    } else if (roll < 0.92) { // traceroute with a route path
      const path = [n, pick(NODES), pick(NODES)].map((x) => hexid(x.num));
      M().ingest({ from, to: path[path.length - 1], ...meta(), portnum: 70, type: "traceroute", route: path });
    } else if (roll < 0.97) { // neighborinfo
      const nb = NODES.filter((x) => x.num !== n.num).slice(0, 3).map((x) => hexid(x.num));
      M().ingest({ from, to: M().BROADCAST, ...meta(), portnum: 71, type: "neighbor", neighbors: nb });
    } else { // PKC DM (encrypted, metadata only)
      const dst = pick(NODES.filter((x) => x.num !== n.num && x.key));
      M().ingest({ from, to: hexid(dst.num), channel: 0, rssi: Math.round(rr(-108, -60)), snr: +rr(-14, 9).toFixed(1),
        hops: (Math.random() * 2) | 0, pki: true, portnum: 0, type: "data" });
    }
  }
  function startDemo() {
    disconnect(); stopDemo(); mode = "demo"; setStatus("DEMO · SYNTHETIC MESH", "#f5b642");
    NODES.forEach((n, i) => setTimeout(() => { nodeinfo(n); }, 120 + i * 180));
    setTimeout(() => NODES.forEach((n) => tick()), 1400);
    demoTimer = setInterval(tick, 820);
  }
  function stopDemo() { if (demoTimer) clearInterval(demoTimer); demoTimer = null; if (mode === "demo") { mode = "idle"; setStatus("IDLE", "#6f97a8"); } }

  // ---------------- config: channel decode + RX frequency ----------------
  const te = new TextEncoder();
  const vi = (n) => { const o = []; while (n > 0x7f) { o.push(0x80 | (n & 0x7f)); n >>>= 7; } o.push(n); return o; };
  const pv = (i, n) => [i << 3 | 0, ...vi(n)];
  const ps = (i, b) => { b = Array.from(b); return [i << 3 | 2, ...vi(b.length), ...b]; };
  const frameBytes = (pl) => { pl = Array.from(pl); return Uint8Array.from([0x94, 0xc3, (pl.length >> 8) & 0xff, pl.length & 0xff, ...pl]); };
  async function writePort(bytes) {
    if (!port || !port.writable) return; const w = port.writable.getWriter();
    try { await w.write(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)); } finally { w.releaseLock(); }
  }
  function setChannel(name, psk) { const r = D().setChannel(name || "LongFast", psk || "default"); return r; }
  async function setFrequency(mhz) {
    if (mode !== "serial") return { ok: false, msg: "connect a radio-pipe to tune its receiver" };
    const v = new Uint8Array(4); new DataView(v.buffer).setFloat32(0, +mhz, true);
    await writePort(frameBytes([...pv(1, 2), ...pv(2, 1), ...ps(3, te.encode("freq")), ...ps(4, v)]));
    await new Promise((r) => setTimeout(r, 120));
    await writePort(frameBytes([...pv(1, 2), ...pv(2, 4)]));   // apply-live (receive-only tuning)
    return { ok: true, msg: `receiver tuned to ${(+mhz).toFixed(3)} MHz` };
  }

  // ---------------- traceroute (TRANSMITS a query; gated in app.js) ----------------
  const PIPE_NUM = 0x5eef1e5e;
  async function injectTraceroute(targetHex) {
    const target = parseInt(targetHex, 16) >>> 0, id = Math.floor(Math.random() * 0xffffffff) >>> 0;
    const data = Uint8Array.from([...pv(1, 70), ...pv(3, 1)]);      // Data: portnum TRACEROUTE, want_response
    const active = D().activeChannel(); if (!active) return;
    const encd = await D().encryptChannel(active.name, id, PIPE_NUM, data); if (!encd) return;
    const hdr = new Uint8Array(16), dv = new DataView(hdr.buffer);
    dv.setUint32(0, target, true); dv.setUint32(4, PIPE_NUM, true); dv.setUint32(8, id, true);
    hdr[12] = 0x03 | (3 << 5); hdr[13] = active.hash;              // hop_limit 3, hop_start 3
    const raw = new Uint8Array(16 + encd.length); raw.set(hdr, 0); raw.set(encd, 16);
    await writePort(frameBytes([...pv(1, 1), ...ps(2, raw)]));      // radio-pipe TX inject
  }
  function demoTraceroute() {
    if (NODES.length < 3) return;
    const from = pick(NODES), via = pick(NODES.filter((x) => x !== from)), to = pick(NODES.filter((x) => x !== from && x !== via));
    M().ingest({ from: hexid(from.num), to: hexid(to.num), ...meta(), portnum: 70, type: "traceroute", route: [hexid(from.num), hexid(via.num), hexid(to.num)] });
  }
  async function traceroute() {
    if (mode === "demo") { demoTraceroute(); setTimeout(demoTraceroute, 600); setTimeout(demoTraceroute, 1200); return { ok: true, msg: "traceroute simulated across the mesh" }; }
    if (mode === "serial") {
      const recent = M().nodesByRecent().slice(0, 6);
      if (!recent.length) return { ok: false, msg: "no nodes seen yet to query" };
      for (const n of recent) { await injectTraceroute(n.id); await new Promise((r) => setTimeout(r, 700)); }
      return { ok: true, msg: `traceroute query sent to ${recent.length} node(s)` };
    }
    return { ok: false, msg: "start Demo Mode or connect a radio-pipe" };
  }

  window.VizSource = {
    connect, disconnect, startDemo, stopDemo, setChannel, setFrequency, traceroute,
    toggleDemo() { mode === "demo" ? stopDemo() : startDemo(); },
    status() { return status; }, mode() { return mode; }, channelName() { return D().channelName(); },
    autoStart() { const q = new URLSearchParams(location.search); if (q.has("demo") || !("serial" in navigator)) startDemo(); },
  };
})();
