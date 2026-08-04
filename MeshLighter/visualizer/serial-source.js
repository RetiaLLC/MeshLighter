/*
 * serial-source.js — read-only data source for the visualizer.
 *
 * Replaces the Python WebSocket bridge: connects to the radio-pipe over Web Serial,
 * decodes packets in-browser (mesh-decode.js), and feeds the sketch's
 * handleIncomingData(). NEVER transmits — this is the passive public surface, so it
 * needs no authorization gate. Demo Mode synthesizes a believable public mesh so the
 * HUD is alive with no hardware (and for hosting/presenting).
 */
(function () {
  const M = window.MeshDecode;
  const el = (id) => document.getElementById(id);
  let port = null, reader = null, reading = false, deframe = null;
  let demoTimer = null, mode = "idle";

  const status = (t) => { const s = el("viz-status"); if (s) s.textContent = t; };
  const feed = (pkt) => { if (pkt && typeof window.handleIncomingData === "function" && typeof width !== "undefined" && width > 0) window.handleIncomingData(pkt); };

  // ---------------------------------------------------------------- Web Serial
  async function connectSerial() {
    if (!("serial" in navigator)) { status("Web Serial unavailable — use Demo Mode"); return; }
    stopDemo();
    try {
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      // Native-USB ESP32-S3: hold DTR, drop RTS so we don't trip ROM download mode.
      try { await port.setSignals({ dataTerminalReady: true, requestToSend: false }); } catch { /* unsupported */ }
      mode = "serial"; reading = true; deframe = M.makeDeframer();
      status("connected · read-only"); el("viz-connect").textContent = "Disconnect";
      readLoop();
    } catch (e) { status("connect failed: " + (e.message || e)); }
  }
  async function disconnectSerial() {
    reading = false;
    try { if (reader) await reader.cancel(); } catch { /* */ }
    try { if (port) await port.close(); } catch { /* */ }
    port = null; reader = null;
    if (mode === "serial") mode = "idle";
    el("viz-connect").textContent = "Connect radio-pipe"; status("disconnected");
  }
  async function readLoop() {
    while (port && port.readable && reading) {
      reader = port.readable.getReader();
      try {
        for (;;) { const { value, done } = await reader.read(); if (done) break; if (value) deframe(value, onFrame); }
      } catch { /* transient — re-acquire */ }
      finally { try { reader.releaseLock(); } catch { /* */ } reader = null; }
    }
  }
  async function onFrame(frame) {
    const rx = M.wrapperToRx(frame);
    if (!rx) return;
    feed(await M.decodePacket(rx.raw, rx.rssi));
  }

  // ---------------------------------------------------------------- Demo Mode
  const DEMO_NODES = [
    { src: 0x4d0c1234, name: "Base Camp", sname: "BASE", hw: 4 },
    { src: 0xa1b2c3d4, name: "Ridge Relay", sname: "RIDG", hw: 43 },
    { src: 0x77aa0001, name: "Trailhead", sname: "TRL", hw: 9 },
    { src: 0x0badf00d, name: "River Node", sname: "RIVR", hw: 1 },
    { src: 0xc0ffee01, name: "K6MESH", sname: "K6M", hw: 255 },
    { src: 0x1a2b3c4d, name: "Summit", sname: "SMT", hw: 43 },
  ];
  const CHATTER = ["on my way", "anyone on ch2?", "temp -3C at ridge", "battery 61%", "clear skies", "meshing ✨", "QSL 73", "trail closed past mile 4"];
  const hexid = (n) => "0x" + (n >>> 0).toString(16);
  const rrssi = () => -(58 + Math.floor(Math.random() * 44));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  function startDemo() {
    disconnectSerial(); stopDemo();
    mode = "demo"; status("Demo Mode · synthetic public mesh"); el("viz-demo").textContent = "Stop demo";
    // Announce every node once so they populate with names.
    DEMO_NODES.forEach((n, i) => setTimeout(() => feed({
      from: hexid(n.src), to: "0xffffffff", rssi: rrssi(), type: "nodeinfo", portnum: 4,
      name: n.name, sname: n.sname, hw: n.hw, payload: "",
    }), 250 + i * 350));
    demoTimer = setInterval(tick, 1100);
  }
  function stopDemo() { if (demoTimer) clearInterval(demoTimer); demoTimer = null; if (mode === "demo") { mode = "idle"; const b = el("viz-demo"); if (b) b.textContent = "Demo Mode"; } }
  function tick() {
    const n = pick(DEMO_NODES);
    const roll = Math.random();
    if (roll < 0.18) {
      feed({ from: hexid(n.src), to: "0xffffffff", rssi: rrssi(), type: "nodeinfo", portnum: 4, name: n.name, sname: n.sname, hw: n.hw, payload: "" });
    } else if (roll < 0.4) {
      const dst = pick(DEMO_NODES.filter((x) => x.src !== n.src));
      feed({ from: hexid(n.src), to: hexid(dst.src), rssi: rrssi(), type: "text", portnum: 1, payload: pick(CHATTER) });
    } else if (roll < 0.62) {
      feed({ from: hexid(n.src), to: "0xffffffff", rssi: rrssi(), type: "telemetry", portnum: 67, battery: 40 + Math.floor(Math.random() * 60), payload: "" });
    } else if (roll < 0.82) {
      feed({ from: hexid(n.src), to: "0xffffffff", rssi: rrssi(), type: "position", portnum: 3, payload: "" });
    } else {
      feed({ from: hexid(n.src), to: "0xffffffff", rssi: rrssi(), type: "data", portnum: 0, payload: "" });
    }
  }

  // ---------------------------------------------------------------- wiring
  function wire() {
    const c = el("viz-connect"), d = el("viz-demo");
    if (c) c.onclick = () => (mode === "serial" ? disconnectSerial() : connectSerial());
    if (d) d.onclick = () => (mode === "demo" ? stopDemo() : startDemo());
    if (!("serial" in navigator) && c) { c.disabled = true; c.title = "Web Serial needs Chrome/Edge/Opera over HTTPS or localhost"; }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire); else wire();

  // Called from the sketch's setup() (guarantees p5 is ready). Auto-demo on ?demo or no serial.
  window.VizSource = {
    connectSerial, disconnectSerial, startDemo, stopDemo,
    autoStart() {
      const p = new URLSearchParams(location.search);
      if (p.has("demo") || !("serial" in navigator)) startDemo();
      else status("idle · Connect a radio-pipe or start Demo Mode");
    },
  };
})();
