/*
 * mesh-decode.js — browser-native Meshtastic decode for the visualizer.
 *
 * Read-only. Turns the radio-pipe's 0x94C3-framed serial stream into the packet
 * objects the sketch renders — no Python server. Decrypts the public LongFast
 * channel (default PSK) with WebCrypto AES-128-CTR so node names / message types
 * show up. Works in a browser (window.crypto) and in Node (globalThis.crypto) for
 * the self-test. Exposes window.MeshDecode.
 */
(function (global) {
  const subtle = (global.crypto || {}).subtle;

  // Meshtastic default PSK (well-known "AQ==" key, PSK index 1) → LongFast, hash 0x08.
  const LONGFAST_KEY = new Uint8Array([
    0xd4, 0xf1, 0xbb, 0x3a, 0x20, 0x29, 0x07, 0x59,
    0xf0, 0xbc, 0xff, 0xab, 0xcf, 0x4e, 0x69, 0x01]);
  const LONGFAST_HASH = 0x08;
  const BROADCAST = 0xffffffff;

  let keyPromise = null;
  function longfastKey() {
    if (!keyPromise) keyPromise = subtle.importKey("raw", LONGFAST_KEY, { name: "AES-CTR" }, false, ["decrypt"]);
    return keyPromise;
  }

  // nonce = packetId(4 LE) | 0(4) | fromNode(4 LE) | 0(4)  — the counter block.
  function nonce(id, src) {
    const n = new Uint8Array(16);
    new DataView(n.buffer).setUint32(0, id >>> 0, true);
    new DataView(n.buffer).setUint32(8, src >>> 0, true);
    return n;
  }
  async function decryptLongFast(id, src, ct) {
    const key = await longfastKey();
    const pt = await subtle.decrypt({ name: "AES-CTR", counter: nonce(id, src), length: 128 }, key, ct);
    return new Uint8Array(pt);
  }

  // --- protobuf: parse into { fieldNum: value } (bytes | number) ---
  function readVarint(b, o) { let n = 0, s = 0; for (;;) { n |= (b[o] & 0x7f) << s; s += 7; if (b[o++] < 0x80) return [n >>> 0, o]; } }
  function readPb(bytes) {
    const b = bytes; let o = 0; const m = {};
    while (o < b.length) {
      let tag; [tag, o] = readVarint(b, o);
      const idx = tag >>> 3, typ = tag & 7;
      if (typ === 0) { let v; [v, o] = readVarint(b, o); m[idx] = v; }
      else if (typ === 2) { let ln; [ln, o] = readVarint(b, o); m[idx] = b.slice(o, o + ln); o += ln; }
      else if (typ === 5) { m[idx] = b.slice(o, o + 4); o += 4; }
      else if (typ === 1) { m[idx] = b.slice(o, o + 8); o += 8; }
      else break;
    }
    return m;
  }

  const hex = (n) => "0x" + (n >>> 0).toString(16);
  const dec = (bytes) => { try { return new TextDecoder("utf-8").decode(bytes); } catch { return ""; } };

  // --- over-air packet header (16 bytes) + encrypted payload ---
  function parseHeader(raw) {
    if (raw.length < 16) return null;
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.length);
    const flags = raw[12];
    return {
      dest: dv.getUint32(0, true), src: dv.getUint32(4, true), id: dv.getUint32(8, true),
      flags, hash: raw[13], hopLimit: flags & 7, hopStart: (flags >> 5) & 7,
      payload: raw.slice(16),
    };
  }

  // Decode a Data protobuf into the sketch's packet object (adds name/type/etc).
  function fromData(base, dataMap) {
    const portnum = typeof dataMap[1] === "number" ? dataMap[1] : 0;
    const p = { ...base, portnum, type: "data", payload: "" };
    const body = dataMap[2] instanceof Uint8Array ? dataMap[2] : null;
    if (portnum === 4 && body) {                 // NODEINFO_APP
      p.type = "nodeinfo";
      const u = readPb(body);
      if (u[2] instanceof Uint8Array) p.name = dec(u[2]);
      if (u[3] instanceof Uint8Array) p.sname = dec(u[3]);
      if (typeof u[5] === "number") p.hw = u[5];
    } else if (portnum === 1 && body) {          // TEXT_MESSAGE_APP
      p.type = "text"; p.payload = dec(body);
    } else if (portnum === 67 && body) {         // TELEMETRY_APP
      p.type = "telemetry";
      const t = readPb(body);
      if (t[2] instanceof Uint8Array) { const mt = readPb(t[2]); if (typeof mt[1] === "number") p.battery = mt[1]; }
    } else if (portnum === 3) {                   // POSITION_APP
      p.type = "position";
    }
    return p;
  }

  // Full path: a raw over-air packet + rssi -> a packet object (async: decrypt).
  async function decodePacket(raw, rssi) {
    const h = parseHeader(raw);
    if (!h) return null;
    const base = { from: hex(h.src), to: hex(h.dest), rssi: rssi | 0, hopLimit: h.hopLimit, hopStart: h.hopStart, type: "data", portnum: 0, payload: "" };
    if (h.hash !== LONGFAST_HASH || !subtle || h.payload.length === 0) return base;  // can't/needn't decrypt
    try {
      const pt = await decryptLongFast(h.id, h.src, h.payload);
      const dataMap = readPb(pt);
      if (dataMap[1] === undefined) return base;  // not our channel / bad psk
      return fromData(base, dataMap);
    } catch { return base; }
  }

  // --- 0x94C3 deframer over a rolling buffer, and the dev->host wrapper ---
  function makeDeframer() {
    let buf = [];
    return function push(chunk, onFrame) {
      for (const b of chunk) buf.push(b);
      for (;;) {
        while (buf.length >= 2 && !(buf[0] === 0x94 && buf[1] === 0xc3)) buf.shift();
        if (buf.length < 4) break;
        const len = (buf[2] << 8) | buf[3];
        if (buf.length < 4 + len) break;
        onFrame(Uint8Array.from(buf.slice(4, 4 + len)));
        buf = buf.slice(4 + len);
      }
    };
  }
  // dev->host: field1=1 RX packet { 2: raw meshtastic bytes, 3: rssi, 4: snr*4, 6: ms }.
  function wrapperToRx(payload) {
    const m = readPb(payload);
    if (m[1] !== 1 || !(m[2] instanceof Uint8Array)) return null;
    let rssi = m[3] instanceof Uint8Array ? new DataView(m[3].buffer, m[3].byteOffset, 4).getInt32(0, true) : -100;
    return { raw: m[2], rssi };
  }

  global.MeshDecode = { decodePacket, makeDeframer, wrapperToRx, readPb, parseHeader, LONGFAST_HASH, BROADCAST };
})(typeof window !== "undefined" ? window : globalThis);
