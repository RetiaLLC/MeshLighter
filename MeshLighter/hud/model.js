/*
 * model.js — the shared mesh model. The read-only source feeds ingest(); both the
 * Neural Mesh and Tactical HUD renderers read from it, so switching views is instant
 * and both see the same picture. Captures the full spread of Meshtastic packet
 * properties: per-node identity/signal/hops/telemetry/position/role/PKI, traffic by
 * type, channel + encryption mix, a rate history, and message + event feeds.
 */
(function (global) {
  const NOW = () => (global.performance ? performance.now() : 0);
  const BROADCAST = "0xffffffff";

  const HW = { 0:"UNSET",1:"TLORA_V2",4:"TBEAM",9:"RAK4631",10:"T_ECHO",12:"NANO_G1",25:"STATION_G1",
    31:"HELTEC_WSL_V3",39:"NANO_G2_ULTRA",43:"HELTEC_V3",255:"PRIVATE_HW",38:"PRIVATE_HW" };
  const ROLE = { 0:"CLIENT",1:"CLIENT_MUTE",2:"ROUTER",3:"ROUTER_CLIENT",4:"REPEATER",5:"TRACKER",
    6:"SENSOR",7:"TAK",8:"CLIENT_HIDDEN",9:"LOST_FOUND",10:"TAK_TRACKER" };

  let seedN = 1;
  function rnd() { seedN = (seedN * 1103515245 + 12345) & 0x7fffffff; return seedN / 0x7fffffff; }

  const M = {
    nodes: new Map(), packets: [], messages: [], events: [], links: [],
    stats: { total: 0, byType: {}, byPort: {}, channels: new Map(), enc: { channel: 0, pkc: 0, other: 0 }, mqtt: 0, pktTimes: [] },
    HW, ROLE, BROADCAST,

    clear() {
      this.nodes.clear(); this.packets.length = 0; this.messages.length = 0; this.events.length = 0; this.links.length = 0;
      this.stats = { total: 0, byType: {}, byPort: {}, channels: new Map(), enc: { channel: 0, pkc: 0, other: 0 }, mqtt: 0, pktTimes: [] };
    },

    node(id) {
      let n = this.nodes.get(id);
      if (!n) {
        n = { id, num: parseInt(id, 16) >>> 0, name: null, sname: id.slice(-4).toUpperCase(), hw: null, role: null,
          snr: null, rssi: null, hops: null, battery: null, voltage: null, chanUtil: null, airUtil: null,
          temp: null, humidity: null, pressure: null, lat: null, lon: null, alt: null, pki: false,
          count: 0, firstHeard: NOW(), lastHeard: NOW(), sx: 0.12 + rnd() * 0.76, sy: 0.12 + rnd() * 0.76,
          pulse: 0, msg: "", msgUntil: 0 };
        this.nodes.set(id, n);
        this.event("NODE", `${n.sname} discovered`, id);
      }
      return n;
    },

    event(kind, text, id) {
      this.events.push({ t: NOW(), kind, text, id: id || null });
      if (this.events.length > 300) this.events.shift();
    },

    ingest(p) {
      const now = NOW();
      const from = p.from, to = p.to;
      if (!from || from === "0x0") return;

      // rate + traffic stats
      const st = this.stats;
      st.total++; st.pktTimes.push(now);
      while (st.pktTimes.length && now - st.pktTimes[0] > 90000) st.pktTimes.shift();
      const ty = p.type || "data";
      st.byType[ty] = (st.byType[ty] || 0) + 1;
      st.byPort[p.portnum || 0] = (st.byPort[p.portnum || 0] || 0) + 1;
      st.channels.set(p.channel || 0, (st.channels.get(p.channel || 0) || 0) + 1);
      if (p.pki) st.enc.pkc++; else if ((p.channel || 0) === 8) st.enc.channel++; else st.enc.other++;
      if (p.mqtt) st.mqtt++;

      // node update (sender)
      const n = this.node(from);
      n.lastHeard = now; n.count++; n.pulse = 1;
      if (p.rssi) n.rssi = p.rssi;
      if (p.snr != null) n.snr = p.snr;
      if (p.hops != null) n.hops = n.hops == null ? p.hops : Math.min(n.hops, p.hops);
      if (p.name) n.name = p.name;
      if (p.sname) n.sname = p.sname;
      if (p.hw != null) n.hw = p.hw;
      if (p.role != null) n.role = p.role;
      if (p.hasKey || p.pki) n.pki = true;
      if (p.battery != null) n.battery = p.battery;
      if (p.voltage != null) n.voltage = p.voltage;
      if (p.chanUtil != null) n.chanUtil = p.chanUtil;
      if (p.airUtil != null) n.airUtil = p.airUtil;
      if (p.temp != null) n.temp = p.temp;
      if (p.humidity != null) n.humidity = p.humidity;
      if (p.pressure != null) n.pressure = p.pressure;
      if (p.lat != null) { n.lat = p.lat; n.lon = p.lon; n.alt = p.alt; }

      // links (directed traffic + traceroute/neighbor topology)
      if (to && to !== BROADCAST && to !== "0x0") { this.node(to); this.refreshLink(from, to, p.pki ? "dm" : "dir"); }
      if (Array.isArray(p.route)) for (let i = 0; i < p.route.length - 1; i++) this.refreshLink(p.route[i], p.route[i + 1], "route");
      if (Array.isArray(p.neighbors)) for (const nb of p.neighbors) this.refreshLink(from, nb, "neighbor");

      // feeds
      if (ty === "text" && p.payload) {
        n.msg = String(p.payload).slice(0, 120); n.msgUntil = now + 14000;
        this.messages.push({ t: now, from, sname: n.sname, to, text: n.msg, pki: !!p.pki });
        if (this.messages.length > 120) this.messages.shift();
        this.event("TEXT", `${n.sname}${to && to !== BROADCAST ? "→" + this.node(to).sname : ""}: ${n.msg}`, from);
      } else if (ty === "position" && p.lat != null) {
        this.event("POS", `${n.sname} @ ${p.lat.toFixed(4)},${p.lon.toFixed(4)}${p.alt != null ? " " + p.alt + "m" : ""}`, from);
      } else if (ty === "telemetry") {
        const bits = [];
        if (p.battery != null) bits.push(p.battery + "%");
        if (p.chanUtil != null) bits.push("ch " + p.chanUtil + "%");
        if (p.temp != null) bits.push(p.temp + "°C");
        this.event("TELEM", `${n.sname} ${bits.join(" ")}`, from);
      } else if (ty === "routing") {
        this.event("ROUTE", `${n.sname} ${p.ack ? "ACK" : "routing"}`, from);
      } else if (ty === "traceroute") {
        this.event("TRACE", `${n.sname} traceroute (${(p.route || []).length} hops)`, from);
      } else if (ty === "neighbor") {
        this.event("NEIGH", `${n.sname} neighbors: ${(p.neighbors || []).length}`, from);
      } else if (p.pki) {
        this.event("PKC", `encrypted DM ${n.sname}→${to && to !== BROADCAST ? this.node(to).sname : "?"}`, from);
      }

      // packet particle record (for scope / neural view)
      this.packets.push({ t: now, from, to, type: ty, portnum: p.portnum || 0, rssi: p.rssi || -100, snr: p.snr, hops: p.hops, pki: !!p.pki, lerp: 0 });
      if (this.packets.length > 600) this.packets.shift();
    },

    refreshLink(a, b, kind) {
      const now = NOW();
      for (const l of this.links) if ((l.a === a && l.b === b) || (l.a === b && l.b === a)) { l.until = now + 45000; l.kind = kind; return; }
      this.links.push({ a, b, kind, until: now + 45000 });
      if (this.links.length > 200) this.links.shift();
    },

    // derived
    perMin() { const now = NOW(); return this.stats.pktTimes.filter((t) => now - t < 60000).length; },
    rateBuckets(n, span) {                       // n buckets over `span` ms → counts
      const now = NOW(), out = new Array(n).fill(0);
      for (const t of this.stats.pktTimes) { const age = now - t; if (age < span) out[Math.min(n - 1, (age / span * n) | 0)]++; }
      return out.reverse();
    },
    activeNodes(ms) { const now = NOW(); let c = 0; for (const n of this.nodes.values()) if (now - n.lastHeard < (ms || 120000)) c++; return c; },
    nodesByRecent() { return [...this.nodes.values()].sort((a, b) => b.lastHeard - a.lastHeard); },
    prune() { const now = NOW(); this.links = this.links.filter((l) => l.until > now); }
  };

  global.MeshModel = M;
})(typeof window !== "undefined" ? window : globalThis);
