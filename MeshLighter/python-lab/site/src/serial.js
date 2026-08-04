// Binary Web Serial transport for the radio-pipe (0x94 0xC3 framed protocol).
// Emits raw bytes as "data" (Uint8Array); the app.js bridge does the framing.
// MockRadioPipe speaks the same protocol so the whole lab runs with ?demo=1.

const DEFAULTS = Object.freeze({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none", bufferSize: 8192 });

export class WebSerialConnection extends EventTarget {
  constructor() {
    super();
    this.port = null; this.reader = null; this.reading = false; this.closing = false;
    this.readLoopPromise = null; this.writeChain = Promise.resolve();
    this.onPhysicalDisconnect = this.onPhysicalDisconnect.bind(this);
    if (this.isSupported()) navigator.serial.addEventListener("disconnect", this.onPhysicalDisconnect);
  }
  isSupported() { return "serial" in navigator; }
  get connected() { return Boolean(this.port?.readable && this.port?.writable && !this.closing); }

  async connect(options = {}) {
    if (!this.isSupported()) throw new Error("Web Serial is not supported by this browser (use Chrome/Edge/Opera).");
    if (this.port || this.reading) throw new Error("A serial connection is already active.");
    this.status("requesting", "Select the radio-pipe serial port.");
    const port = await navigator.serial.requestPort();
    await port.open({ ...DEFAULTS, ...options });
    // Native-USB ESP32-S3: hold DTR asserted, RTS deasserted so we don't trip
    // ROM download mode or wedge the CDC endpoint.
    try { await port.setSignals({ dataTerminalReady: true, requestToSend: false }); } catch { /* not all ports support it */ }
    this.port = port; this.closing = false;
    this.status("connected", describePort(port));
    this.startReadLoop();
    return port;
  }

  async disconnect(reason = "Disconnected") {
    const port = this.port; this.closing = true;
    if (this.reader) { try { await this.reader.cancel(); } catch (e) { this.fail(e); } }
    if (this.readLoopPromise) await this.readLoopPromise.catch((e) => this.fail(e));
    await this.writeChain.catch(() => {});
    if (port) { try { await port.close(); } catch (e) {
      if (!/already closed|not open|lost|disconnected/i.test(String(e?.message || e))) this.fail(e);
    } }
    this.port = null; this.reader = null; this.reading = false; this.readLoopPromise = null; this.closing = false;
    this.status("disconnected", reason);
  }

  async write(data) {
    if (!this.port?.writable) return;
    const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data);
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      if (!this.port?.writable || this.closing) return;
      const writer = this.port.writable.getWriter();
      try { await writer.write(bytes); } finally { writer.releaseLock(); }
    });
    await this.writeChain;
  }

  startReadLoop() {
    if (this.reading || !this.port?.readable) return;
    this.reading = true; this.readLoopPromise = this.readLoop();
  }
  async readLoop() {
    try {
      while (this.port?.readable && !this.closing) {
        this.reader = this.port.readable.getReader();
        try {
          while (!this.closing) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value && value.length) this.dispatchEvent(new CustomEvent("data", { detail: value }));
          }
        } catch (e) { if (!this.closing) this.fail(e); }
        finally { try { this.reader.releaseLock(); } catch { /* unplugged */ } this.reader = null; }
      }
    } finally {
      this.reading = false;
      if (this.port && !this.closing) await this.disconnect("Serial device disconnected.");
    }
  }
  async onPhysicalDisconnect(event) { if (event.target === this.port) await this.disconnect("USB serial device disconnected."); }
  status(state, message) { this.dispatchEvent(new CustomEvent("status", { detail: { state, message } })); }
  fail(error) { this.dispatchEvent(new CustomEvent("error", { detail: { message: error?.message || String(error), error } })); }
}

function describePort(port) {
  const info = port.getInfo();
  const hex = (v) => (v ?? 0).toString(16).padStart(4, "0").toUpperCase();
  return info.usbVendorId ? `Connected: VID ${hex(info.usbVendorId)} / PID ${hex(info.usbProductId)}` : "Connected";
}

// ---------------------------------------------------------------------------
// Mock radio-pipe. Understands the 0x94C3 protocol enough to demo every tool
// with no hardware: TX -> ACK + echoes the packet back as RX; config reads,
// spectrum scan, sniff; and periodic ambient RX so the monitor has traffic.
// ---------------------------------------------------------------------------
const SAMPLE_RX = [
  "08011233ffffffff34120c4d01200000e7080000dae6c05651a7f943edbe58d4aff781223a8e9f2c95deb1d3590701662c5f572750ee691db8ffffff25180000003540e20100",
  "08011225ffffffff34120c4d02200000e7080000efea511e693eba4ef0a2871e7617740afc589fb7f71db0ffffff25120000003540e20100",
  "0801121effffffff0100aa7703200000e70800007a9b1870db6211a0c44eaa0515e41dbfffffff251c0000003540e20100"
];
const hexToBytes = (h) => Uint8Array.from(h.match(/../g).map((b) => parseInt(b, 16)));

export class MockRadioPipe extends EventTarget {
  constructor() { super(); this.open = false; this.rxTimer = null; this.inbuf = []; this.rxi = 0; }
  isSupported() { return true; }
  get connected() { return this.open; }
  async connect() {
    this.open = true; this.status("connected", "Connected: mock radio-pipe");
    this.emitText("System init\nRadio Init\nsuccess!\n[SX1262] Starting to listen ... success!\n");
    this.rxTimer = setInterval(() => this.ambient(), 4000);
    return null;
  }
  async disconnect(reason = "Disconnected") { this.open = false; if (this.rxTimer) clearInterval(this.rxTimer); this.status("disconnected", reason); }
  async setSignals() {}

  async write(data) {
    for (const b of (data instanceof Uint8Array ? data : Uint8Array.from(data))) this.inbuf.push(b);
    let f; while ((f = this.takeFrame()) !== null) this.onFrame(f);
  }
  takeFrame() {
    const b = this.inbuf;
    while (b.length >= 2 && !(b[0] === 0x94 && b[1] === 0xc3)) b.shift();
    if (b.length < 4) return null;
    const len = (b[2] << 8) | b[3];
    if (b.length < 4 + len) return null;
    const payload = b.slice(4, 4 + len); this.inbuf = b.slice(4 + len); return payload;
  }
  onFrame(payload) {
    const m = readPb(payload);
    const cmd = m[1];
    if (cmd === 1) {                       // TX packet
      setTimeout(() => this.frame([mkVarint(1, 3)]), 600);           // TX-done ACK, ~airtime
      const mp = m[2] || [];
      setTimeout(() => this.frame([mkVarint(1, 1), mkString(2, mp), mkI32(3, -60), mkI32(4, 24), mkI32(6, 555)]), 900);
    } else if (cmd === 2) {                // config / control
      const op = m[2];
      if (op === 0) {                      // read config
        const key = bytesToStr(m[3] || []);
        const val = key === "freq" ? [0x00, 0xb8, 0x62, 0x44] : [0x08];   // 906.875f / power 8
        setTimeout(() => this.frame([mkVarint(1, 2), mkString(2, strBytes(key)), mkString(3, val)]), 60);
      } else if (op === 6) {               // spectrum scan
        let f = 902000; const end = 928000, step = 1000;
        const tick = () => {
          if (f > end) { this.frame([mkVarint(1, 5)]); return; }
          const noise = -118 + Math.floor(Math.random() * 6);
          const peak = (f === 906875 || f === 915000) ? -70 - Math.floor(Math.random() * 10) : noise;
          this.frame([mkVarint(1, 4), mkI32(2, f), mkI32(3, peak)]);
          f += step; setTimeout(tick, 6);
        };
        setTimeout(tick, 40);
      } else {                             // apply-live / sniff / save / restart
        setTimeout(() => this.frame([mkVarint(1, 5)]), 40);
      }
    }
  }
  ambient() { if (!this.open) return; const h = SAMPLE_RX[this.rxi++ % SAMPLE_RX.length]; this.emit(frameBytes(hexToBytes(h))); }
  frame(fields) { this.emit(frameBytes(concatBytes(fields))); }
  emit(u8) { this.dispatchEvent(new CustomEvent("data", { detail: u8 })); }
  emitText(t) { this.emit(new TextEncoder().encode(t)); }
  status(state, message) { this.dispatchEvent(new CustomEvent("status", { detail: { state, message } })); }
}

// --- tiny protobuf writer/reader for the mock ---
function mkVarint(id, num) { const o = [id << 3 | 0]; while (num > 127) { o.push(0x80 | (num & 0x7f)); num >>>= 7; } o.push(num); return o; }
function mkI32(id, num) { const b = [id << 3 | 5]; const v = new DataView(new ArrayBuffer(4)); v.setInt32(0, num, true); for (let i = 0; i < 4; i++) b.push(v.getUint8(i)); return b; }
function mkString(id, bytes) { const o = [id << 3 | 2]; let n = bytes.length; while (n > 127) { o.push(0x80 | (n & 0x7f)); n >>>= 7; } o.push(n); return o.concat(Array.from(bytes)); }
function strBytes(s) { return Array.from(new TextEncoder().encode(s)); }
function concatBytes(arrs) { const out = []; for (const a of arrs) for (const b of a) out.push(b); return out; }
function frameBytes(payload) { const p = Array.from(payload); return Uint8Array.from([0x94, 0xc3, (p.length >> 8) & 0xff, p.length & 0xff, ...p]); }
function bytesToStr(b) { return new TextDecoder().decode(Uint8Array.from(b)); }
function readPb(bytes) {
  const b = Array.from(bytes); let o = 0; const m = {};
  while (o < b.length) {
    const key = b[o++]; const idx = key >> 3, typ = key & 7;
    if (typ === 0) { let n = 0, s = 0; while (true) { n |= (b[o] & 0x7f) << s; s += 7; if (b[o++] < 128) break; } m[idx] = n; }
    else if (typ === 2) { let ln = 0, s = 0; while (true) { ln |= (b[o] & 0x7f) << s; s += 7; if (b[o++] < 128) break; } m[idx] = b.slice(o, o + ln); o += ln; }
    else if (typ === 5) { m[idx] = b.slice(o, o + 4); o += 4; }
    else break;
  }
  return m;
}
