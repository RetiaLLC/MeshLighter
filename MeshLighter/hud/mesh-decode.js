/*
 * mesh-decode.js — browser-native Meshtastic decode for the HUD. Read-only.
 *
 * Turns the radio-pipe's 0x94C3 serial stream into rich packet objects: from/to,
 * packet id, channel hash, RSSI, SNR, hop count (hop_start - hop_limit), want_ack,
 * via_mqtt, PKI-DM flag, and the decoded Data (LongFast, WebCrypto AES-128-CTR) with
 * per-portnum fields — NodeInfo (name/short/hw/role/pubkey), Position (lat/lon/alt),
 * Telemetry (battery/voltage/channel-util/air-util/temp/humidity), Text, Routing.
 * Works in a browser (window.crypto) and Node (globalThis.crypto) for the self-test.
 */
(function (global) {
  const subtle = (global.crypto || {}).subtle;
  const LONGFAST_KEY = new Uint8Array([0xd4,0xf1,0xbb,0x3a,0x20,0x29,0x07,0x59,0xf0,0xbc,0xff,0xab,0xcf,0x4e,0x69,0x01]);
  const LONGFAST_HASH = 0x08, BROADCAST = 0xffffffff;

  let keyPromise = null;
  const longfastKey = () => (keyPromise ||= subtle.importKey("raw", LONGFAST_KEY, { name: "AES-CTR" }, false, ["decrypt"]));
  function nonce(id, src) {
    const n = new Uint8Array(16), dv = new DataView(n.buffer);
    dv.setUint32(0, id >>> 0, true); dv.setUint32(8, src >>> 0, true); return n;
  }
  async function decryptLongFast(id, src, ct) {
    const pt = await subtle.decrypt({ name: "AES-CTR", counter: nonce(id, src), length: 128 }, await longfastKey(), ct);
    return new Uint8Array(pt);
  }

  // --- protobuf reader: { field: value }, keeps repeated fields as arrays ---
  const rv = (b, o) => { let n = 0, s = 0; for (;;) { n |= (b[o] & 0x7f) << s; s += 7; if (b[o++] < 0x80) return [n >>> 0, o]; } };
  function readPb(bytes) {
    const b = bytes; let o = 0; const m = {};
    const put = (i, v) => { if (i in m) { (Array.isArray(m[i]) ? m[i] : (m[i] = [m[i]])).push(v); } else m[i] = v; };
    while (o < b.length) {
      let tag; [tag, o] = rv(b, o); const idx = tag >>> 3, typ = tag & 7;
      if (typ === 0) { let v; [v, o] = rv(b, o); put(idx, v); }
      else if (typ === 2) { let ln; [ln, o] = rv(b, o); put(idx, b.slice(o, o + ln)); o += ln; }
      else if (typ === 5) { put(idx, b.slice(o, o + 4)); o += 4; }
      else if (typ === 1) { put(idx, b.slice(o, o + 8)); o += 8; }
      else break;
    }
    return m;
  }
  const i32 = (b) => b && b.length === 4 ? new DataView(b.buffer, b.byteOffset, 4).getInt32(0, true) : 0;
  const f32 = (b) => b && b.length === 4 ? new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true) : 0;
  const hex = (n) => "0x" + (n >>> 0).toString(16);
  const dec = (b) => { try { return new TextDecoder("utf-8").decode(b); } catch { return ""; } };

  function parseHeader(raw) {
    if (raw.length < 16) return null;
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.length), flags = raw[12];
    return {
      dest: dv.getUint32(0, true), src: dv.getUint32(4, true), id: dv.getUint32(8, true),
      flags, hash: raw[13], hopLimit: flags & 7, hopStart: (flags >> 5) & 7,
      wantAck: !!(flags & 8), viaMqtt: !!(flags & 16), payload: raw.slice(16),
    };
  }

  // Decode a Data protobuf into HUD fields per portnum.
  function fromData(base, d) {
    const portnum = typeof d[1] === "number" ? d[1] : 0;
    const p = { ...base, portnum, type: "data" };
    const body = d[2] instanceof Uint8Array ? d[2] : null;
    if (portnum === 4 && body) {                       // NODEINFO_APP → User
      const u = readPb(body); p.type = "nodeinfo";
      if (u[2] instanceof Uint8Array) p.name = dec(u[2]);
      if (u[3] instanceof Uint8Array) p.sname = dec(u[3]);
      if (typeof u[5] === "number") p.hw = u[5];
      if (typeof u[7] === "number") p.role = u[7];
      if (u[8] instanceof Uint8Array && u[8].length === 32) p.hasKey = true;   // PKI-capable node
    } else if (portnum === 3 && body) {                // POSITION_APP
      const q = readPb(body); p.type = "position";
      if (q[1] instanceof Uint8Array) p.lat = i32(q[1]) * 1e-7;
      if (q[2] instanceof Uint8Array) p.lon = i32(q[2]) * 1e-7;
      if (typeof q[3] === "number") p.alt = q[3] | 0;
    } else if (portnum === 67 && body) {               // TELEMETRY_APP
      const t = readPb(body); p.type = "telemetry";
      const dm = t[2] instanceof Uint8Array ? readPb(t[2]) : null;   // device_metrics
      const em = t[3] instanceof Uint8Array ? readPb(t[3]) : null;   // environment_metrics
      if (dm) {
        if (typeof dm[1] === "number") p.battery = dm[1];
        if (dm[2] instanceof Uint8Array) p.voltage = +f32(dm[2]).toFixed(2);
        if (dm[3] instanceof Uint8Array) p.chanUtil = +f32(dm[3]).toFixed(1);
        if (dm[4] instanceof Uint8Array) p.airUtil = +f32(dm[4]).toFixed(1);
      }
      if (em) {
        if (em[1] instanceof Uint8Array) p.temp = +f32(em[1]).toFixed(1);
        if (em[2] instanceof Uint8Array) p.humidity = +f32(em[2]).toFixed(0);
        if (em[3] instanceof Uint8Array) p.pressure = +f32(em[3]).toFixed(0);
      }
    } else if (portnum === 1 && body) {                // TEXT_MESSAGE_APP
      p.type = "text"; p.payload = dec(body);
    } else if (portnum === 5) {                        // ROUTING_APP
      p.type = "routing"; const r = body ? readPb(body) : {};
      if (typeof r[3] === "number") { p.reason = r[3]; p.ack = r[3] === 0; }
    } else if (portnum === 70) { p.type = "traceroute"; }
    else if (portnum === 71) { p.type = "neighbor"; }
    else if (portnum === 6) { p.type = "admin"; }
    return p;
  }

  async function decodePacket(raw, meta) {
    const h = parseHeader(raw); if (!h) return null;
    const isPki = h.hash === 0 && h.dest !== BROADCAST && h.dest !== 0;
    const base = {
      from: hex(h.src), to: hex(h.dest), id: h.id, channel: h.hash,
      rssi: (meta && meta.rssi) | 0, snr: meta && meta.snr != null ? meta.snr : null,
      hops: Math.max(0, h.hopStart - h.hopLimit), hopStart: h.hopStart,
      wantAck: h.wantAck, mqtt: h.viaMqtt, pki: isPki, portnum: 0, type: "data",
    };
    if (h.hash !== LONGFAST_HASH || !subtle || h.payload.length === 0) return base;   // DM/other channel: metadata only
    try {
      const pt = await decryptLongFast(h.id, h.src, h.payload);
      const d = readPb(pt);
      if (d[1] === undefined) return base;             // not LongFast / bad psk
      return fromData(base, d);
    } catch { return base; }
  }

  function makeDeframer() {
    let buf = [];
    return function push(chunk, onFrame) {
      for (const b of chunk) buf.push(b);
      for (;;) {
        while (buf.length >= 2 && !(buf[0] === 0x94 && buf[1] === 0xc3)) buf.shift();
        if (buf.length < 4) break;
        const len = (buf[2] << 8) | buf[3];
        if (buf.length < 4 + len) break;
        onFrame(Uint8Array.from(buf.slice(4, 4 + len))); buf = buf.slice(4 + len);
      }
    };
  }
  // dev->host wrapper: field1=1 RX { 2: raw, 3: rssi(i32), 4: snr*4(i32), 6: ms }
  function wrapperToRx(payload) {
    const m = readPb(payload);
    if (m[1] !== 1 || !(m[2] instanceof Uint8Array)) return null;
    return { raw: m[2], rssi: m[3] instanceof Uint8Array ? i32(m[3]) : -100,
             snr: m[4] instanceof Uint8Array ? i32(m[4]) / 4 : null };
  }

  global.MeshDecode = { decodePacket, makeDeframer, wrapperToRx, readPb, parseHeader, LONGFAST_HASH, BROADCAST };
})(typeof window !== "undefined" ? window : globalThis);
