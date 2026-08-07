/*
 * tactical.js — Tactical HUD renderer (passive SIGINT board) for the mesh model.
 *
 *  HEADER : source/link status, channel, node count, packets/min, encryption mix, clock.
 *  LEFT   : NODE ROSTER — every heard node with role, hardware, SNR bar, hop distance,
 *           battery, PKI-lock. Fresh traffic pulses the row.
 *  CENTER : SIGNAL SCOPE (radar; nodes placed by SNR = range, node-id = bearing; live
 *           packet blips) over a force-directed MESH LINK GRAPH (DM / route / neighbor edges).
 *  RIGHT  : TRAFFIC by packet type, CHANNEL + ENCRYPTION mix with a rate sparkline,
 *           and aggregate TELEMETRY gauges (battery, channel util, air-tx, temperature).
 *  BOTTOM : INTEL FEED — the live decoded event log, colour-coded by type.
 *  Read-only. Reads window.MeshModel; drawn with global-mode p5.
 */
window.Tactical = (function () {
  const C = {
    bg: "#04070b", panel: "#080f15", panelHi: "#0c1620", line: "#123244", line2: "#1d4a5e",
    ink: "#d3ecf6", muted: "#6f97a8", dim: "#456c7d", cyan: "#33e1ff", green: "#35ff9e",
    amber: "#f5b642", red: "#ff5a6a", grid: "#0e2530",
  };
  const TYPE = {
    nodeinfo: "#bf5bff", text: "#f5b642", position: "#33e1ff", telemetry: "#35ff9e",
    routing: "#8fa6b4", traceroute: "#ff9e42", neighbor: "#5b8bff", admin: "#ff5a6a",
    pkc: "#ff5bd0", data: "#7f95a6",
  };
  // node "flavor" = Meshtastic role, each a distinct colour (see the FLAVOR key in the graph)
  const ROLECOL = { CLIENT: "#33e1ff", CLIENT_MUTE: "#7f95a6", ROUTER: "#f5b642", ROUTER_CLIENT: "#ffcf6b",
    REPEATER: "#bf5bff", TRACKER: "#ff9e42", SENSOR: "#35ff9e", TAK: "#ff5a6a", TAK_TRACKER: "#ff8090",
    CLIENT_HIDDEN: "#5b8bff", LOST_FOUND: "#ff5bd0" };
  const roleName = (n) => (window.MeshModel.ROLE[n.role] || "CLIENT");
  const roleColor = (n) => ROLECOL[roleName(n)] || C.cyan;
  const HUD = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

  // resizable layout fractions (persisted): left/right column widths, footer height, map/graph split
  const LAYOUT_KEY = "meshlighter.layout";
  const DEFAULT_LAYOUT = { left: 0.29, right: 0.24, foot: 0.2, map: 0.56 };
  function loadLayout() { try { return { ...DEFAULT_LAYOUT, ...(JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}")) }; } catch (e) { return { ...DEFAULT_LAYOUT }; } }
  function saveLayout() { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(S.layout)); } catch (e) {} }

  const S = { rosterScroll: 0, feedScroll: 0, msgScroll: 0, sweep: 0, fx: new Map(),
    selected: null, hits: [], rosterHits: [], detailRect: null,   // hits = clickable node targets
    mapView: null, mapRect: null, mapBbox: null, mapFitBtn: null,  // pan/zoom state for the map panel
    layout: loadLayout(), geom: null, dividers: [], dragDivider: null, hoverDivider: null, press: null };
  const F = () => window.MeshModel;

  // ---- primitives -------------------------------------------------------------
  function panel(x, y, w, h, label, count, alert) {
    noStroke(); fill(alert ? "#160a0e" : C.panel); rect(x, y, w, h, 3);
    stroke(alert ? C.red : C.line2); strokeWeight(1); noFill(); rect(x, y, w, h, 3);
    // corner brackets
    const b = 9; stroke(alert ? C.red : C.cyan); strokeWeight(1.4);
    for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      line(cx, cy, cx + dx * b, cy); line(cx, cy, cx, cy + dy * b);
    }
    if (label) {
      noStroke(); textFont(HUD); textSize(10.5); textAlign(LEFT, TOP);
      fill(alert ? C.red : C.cyan); text(label.toUpperCase(), x + 10, y + 7);
      if (count != null) { fill(C.dim); textAlign(RIGHT, TOP); text(count, x + w - 10, y + 7); }
      stroke(C.line); strokeWeight(1); line(x + 8, y + 22, x + w - 8, y + 22);
    }
    return { x: x + 10, y: y + (label ? 28 : 10), w: w - 20, h: h - (label ? 36 : 20) };
  }
  function sigColor(snr) { return snr == null ? C.dim : snr > 4 ? C.green : snr > -8 ? C.amber : C.red; }
  function sigBar(x, y, w, snr) {
    const t = snr == null ? 0 : constrain((snr + 18) / 32, 0, 1);
    noStroke(); fill(C.grid); rect(x, y, w, 5, 2);
    fill(sigColor(snr)); rect(x, y, w * t, 5, 2);
  }
  const t = (s, x, y, col, sz, al) => { noStroke(); fill(col); textSize(sz || 11); textAlign(al || LEFT, TOP); textFont(HUD); text(s, x, y); };
  const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

  // ---- header -----------------------------------------------------------------
  function header(x, y, w, h, status) {
    const m = F(); panel(x, y, w, h, null);
    t("MESHLIGHTER", x + 12, y + h / 2 - 12, C.cyan, 15);
    t("// TACTICAL", x + 128, y + h / 2 - 9, C.dim, 11);
    const enc = m.stats.enc, tot = Math.max(1, enc.channel + enc.pkc + enc.other);
    const cells = [
      ["SOURCE", status.text, status.color],
      ["CHANNEL", "LongFast", C.ink],
      ["NODES", m.activeNodes() + "/" + m.nodes.size, C.ink],
      ["PKT/MIN", "" + m.perMin(), C.green],
      ["ENC", `${((enc.channel / tot) * 100) | 0}% ch · ${((enc.pkc / tot) * 100) | 0}% pkc`, C.amber],
      ["TOTAL", "" + m.stats.total, C.muted],
    ];
    let cx = x + 250;
    for (const [k, v, col] of cells) {
      t(k, cx, y + 9, C.dim, 9); t(v, cx, y + 22, col, 12); cx += Math.max(96, textWidth(v) + 34);
    }
    const d = new Date(Date.now());
    t(("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + ":" + ("0" + d.getSeconds()).slice(-2),
      x + w - 250, y + h / 2 - 8, C.cyan, 14, RIGHT);   // clear of the top-right style buttons
  }

  // ---- node roster ------------------------------------------------------------
  function roster(x, y, w, h) {
    const m = F(); const r = panel(x, y, w, h, "Node Roster", m.nodes.size);
    const rows = m.nodesByRecent(), rh = 30, vis = Math.floor(r.h / rh);
    S.rosterScroll = constrain(S.rosterScroll, 0, Math.max(0, rows.length - vis));
    const now = performance.now();
    push(); const cl = r; drawingContext.save();
    drawingContext.beginPath(); drawingContext.rect(cl.x, cl.y, cl.w, cl.h); drawingContext.clip();
    for (let i = 0; i < vis + 1; i++) {
      const n = rows[i + Math.floor(S.rosterScroll)]; if (!n) break;
      const ry = r.y + i * rh; const fresh = now - n.lastHeard < 1500;
      if (fresh) { noStroke(); fill("#0c2027"); rect(r.x - 4, ry, r.w + 8, rh - 2); }
      // role ("flavor") dot + short name
      noStroke(); fill(roleColor(n)); ellipse(r.x + 5, ry + 9, 6, 6);
      t(n.sname, r.x + 14, ry + 3, C.ink, 12);
      if (n.pki) t("🔒", r.x + 14 + textWidth(n.sname) + 4, ry + 3, C.green, 10);
      t(trunc(n.name || m.HW[n.hw] || "—", 22), r.x + 14, ry + 17, C.muted, 9.5);
      // right cluster: SNR bar, hops, batt
      const rx = r.x + r.w;
      t(n.hops == null ? "—" : "H" + n.hops, rx - 118, ry + 4, C.dim, 10, RIGHT);
      sigBar(rx - 108, ry + 6, 44, n.snr);
      t(n.snr == null ? "" : (n.snr > 0 ? "+" : "") + n.snr.toFixed(0), rx - 108, ry + 15, sigColor(n.snr), 9);
      if (n.battery != null) {
        const bc = n.battery > 40 ? C.green : n.battery > 15 ? C.amber : C.red;
        t(n.battery + "%", rx - 40, ry + 4, bc, 11, RIGHT);
      }
      const age = (now - n.lastHeard) / 1000;
      t(age < 1 ? "now" : age < 90 ? (age | 0) + "s" : ((age / 60) | 0) + "m", rx, ry + 4, C.dim, 9.5, RIGHT);
      t((m.HW[n.hw] || "").slice(0, 9), rx, ry + 17, C.dim, 8.5, RIGHT);
      stroke(C.grid); strokeWeight(1); line(r.x - 4, ry + rh - 2, r.x + r.w + 4, ry + rh - 2);
      S.rosterHits.push({ id: n.id, x: r.x - 6, y: ry, w: r.w + 10, h: rh });
    }
    drawingContext.restore(); pop();
    scrollbar(r.x + r.w + 3, r.y, r.h, S.rosterScroll, rows.length, vis);
    S.rosterRect = r;
  }
  function scrollbar(x, y, h, scroll, total, vis) {
    if (total <= vis) return; noStroke(); fill(C.grid); rect(x, y, 3, h, 2);
    const th = Math.max(16, h * vis / total), ty = y + (h - th) * (scroll / Math.max(1, total - vis));
    fill(C.line2); rect(x, ty, 3, th, 2);
  }

  // ---- signal scope -----------------------------------------------------------
  function scope(x, y, w, h) {
    const m = F(); const r = panel(x, y, w, h, "Signal Scope · SNR range", null);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, R = Math.min(r.w, r.h) / 2 - 8;
    stroke(C.grid); strokeWeight(1); noFill();
    for (let i = 1; i <= 3; i++) ellipse(cx, cy, (R * 2 * i) / 3, (R * 2 * i) / 3);
    line(cx - R, cy, cx + R, cy); line(cx, cy - R, cx, cy + R);
    // sweep
    S.sweep += 0.02; const sa = S.sweep % TWO_PI;
    for (let i = 0; i < 28; i++) { const a = sa - i * 0.03; stroke(51, 225, 255, 60 - i * 2); line(cx, cy, cx + cos(a) * R, cy + sin(a) * R); }
    // range labels
    t("+12", cx + 4, cy - 12, C.dim, 8); t("-6", cx + 4, cy - R / 3 - 10, C.dim, 8); t("-18dB", cx + 4, cy - R - 2, C.dim, 8);
    const now = performance.now();
    for (const n of m.nodes.values()) {
      if (now - n.lastHeard > 120000) continue;
      const a = (n.num % 3600) / 3600 * TWO_PI;
      const q = n.snr == null ? 0.5 : constrain((n.snr + 18) / 32, 0, 1);
      const rr = R * (1 - q * 0.92); const px = cx + cos(a) * rr, py = cy + sin(a) * rr;
      const near = ((sa - a + TWO_PI) % TWO_PI) < 0.5; // brighten as sweep passes
      noStroke(); if (near) { fill(C.ink); ellipse(px, py, 10, 10); }   // range = SNR, colour = flavor
      fill(roleColor(n)); ellipse(px, py, 5.5, 5.5);
      t(n.sname, px + 6, py - 5, near ? C.ink : C.muted, 8.5);
      S.hits.push({ id: n.id, x: px, y: py, r: 9 });
    }
    noStroke(); fill(C.cyan); ellipse(cx, cy, 7, 7); stroke(C.cyan); noFill(); ellipse(cx, cy, 13, 13);
    t("RX", cx + 8, cy + 4, C.cyan, 8);
    // live packet blips flying inbound
    for (const pk of m.packets) {
      const age = now - pk.t; if (age > 1200) continue; const src = m.nodes.get(pk.from); if (!src) continue;
      const a = (src.num % 3600) / 3600 * TWO_PI, q = pk.snr == null ? 0.5 : constrain((pk.snr + 18) / 32, 0, 1);
      const rr = R * (1 - q * 0.92) * (age / 1200); const px = cx + cos(a) * rr, py = cy + sin(a) * rr;
      noStroke(); fill(pk.pki ? TYPE.pkc : (TYPE[pk.type] || TYPE.data)); ellipse(px, py, 3, 3);
    }
  }

  // ---- mesh link graph (force-directed, rooted at the receiver) ---------------
  // Passive capture rarely yields directed edges (most traffic is broadcast), so instead
  // of leaving nodes floating we anchor an RX hub and hang each heard node off it by hop
  // distance: 0-hop = direct RF neighbour (solid spoke, close in), multi-hop = relayed
  // (dashed spoke, further out). Observed traceroute/neighbour/DM links draw on top.
  function graph(x, y, w, h) {
    const m = F(); const now = performance.now();
    const live = [...m.nodes.values()].filter((n) => now - n.lastHeard < 180000).slice(0, 44);
    const r = panel(x, y, w, h, "Mesh Link Graph", live.length);
    const cx0 = r.x + r.w / 2, cy0 = r.y + r.h / 2, R = Math.min(r.w, r.h);
    const ids = new Set(live.map((n) => n.id));
    if (!S.fx.has("__RX__")) S.fx.set("__RX__", { x: cx0, y: cy0, vx: 0, vy: 0 });
    const rxp = S.fx.get("__RX__"); rxp.x = cx0; rxp.y = cy0; rxp.vx = rxp.vy = 0;   // RX pinned at centre
    for (const n of live) if (!S.fx.has(n.id)) S.fx.set(n.id, { x: r.x + n.sx * r.w, y: r.y + n.sy * r.h, vx: 0, vy: 0 });
    // repulsion between nodes + faint gravity
    for (const a of live) {
      const pa = S.fx.get(a.id); let fxv = 0, fyv = 0;
      for (const b of live) { if (a === b) continue; const pb = S.fx.get(b.id); const dx = pa.x - pb.x, dy = pa.y - pb.y, d2 = dx * dx + dy * dy + 0.01, f = 900 / d2; fxv += dx * f; fyv += dy * f; }
      fxv += (cx0 - pa.x) * 0.002; fyv += (cy0 - pa.y) * 0.002;
      pa.vx = (pa.vx + fxv) * 0.82; pa.vy = (pa.vy + fyv) * 0.82;
    }
    // RX spoke: every node springs to RX at a rest radius set by its hop distance
    const restFor = (hops) => (0.14 + Math.min(hops == null ? 3 : hops, 6) * 0.05) * R;
    for (const a of live) {
      const pa = S.fx.get(a.id), dx = pa.x - rxp.x, dy = pa.y - rxp.y, d = Math.hypot(dx, dy) || 1, k = (d - restFor(a.hops)) * 0.02;
      pa.vx -= dx / d * k; pa.vy -= dy / d * k;
    }
    // observed links pull their endpoints together (real topology)
    for (const l of m.links) {
      if (l.until < now || !ids.has(l.a) || !ids.has(l.b)) continue;
      const pa = S.fx.get(l.a), pb = S.fx.get(l.b); if (!pa || !pb) continue;
      const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy) || 1, k = (d - 70) * 0.012;
      pa.vx += dx / d * k; pa.vy += dy / d * k; pb.vx -= dx / d * k; pb.vy -= dy / d * k;
    }
    for (const n of live) { const p = S.fx.get(n.id); p.x = constrain(p.x + p.vx, r.x + 8, r.x + r.w - 8); p.y = constrain(p.y + p.vy, r.y + 8, r.y + r.h - 8); }

    push(); drawingContext.save(); drawingContext.beginPath(); drawingContext.rect(r.x, r.y, r.w, r.h); drawingContext.clip();
    // RX spokes underneath: solid green = heard direct, dashed amber = heard via relay
    for (const n of live) {
      const p = S.fx.get(n.id), direct = (n.hops || 0) === 0;
      if (direct) { stroke(53, 255, 158, 120); strokeWeight(1.4); }
      else { stroke(245, 182, 66, 85); strokeWeight(1); drawingContext.setLineDash([3, 4]); }
      line(rxp.x, rxp.y, p.x, p.y); drawingContext.setLineDash([]);
    }
    // observed topology links on top
    const LK = { dm: C.green, route: "#ff9e42", neighbor: "#5b8bff", dir: C.line2 };
    for (const l of m.links) {
      if (l.until < now || !ids.has(l.a) || !ids.has(l.b)) continue;
      const pa = S.fx.get(l.a), pb = S.fx.get(l.b); if (!pa || !pb) continue;
      stroke(LK[l.kind] || C.line2); strokeWeight(l.kind === "dm" ? 1.8 : 1.4); line(pa.x, pa.y, pb.x, pb.y);
    }
    // nodes
    for (const n of live) {
      const p = S.fx.get(n.id), direct = (n.hops || 0) === 0;
      const rolen = m.ROLE[n.role] || "", hub = rolen.includes("ROUTER") || rolen === "REPEATER", s = hub ? 9 : 6 + Math.min(4, n.count / 8);
      noStroke(); if (now - n.lastHeard < 1200) { fill(C.ink); ellipse(p.x, p.y, s + 5, s + 5); }
      fill(roleColor(n)); ellipse(p.x, p.y, s, s);
      t(n.sname, p.x + s / 2 + 3, p.y - 5, C.ink, 8.5);
      if (n.hops != null) t(direct ? "direct" : n.hops + "h", p.x + s / 2 + 3, p.y + 4, direct ? C.green : C.dim, 7.5);
      S.hits.push({ id: n.id, x: p.x, y: p.y, r: s + 5 });
    }
    // RX hub marker
    noStroke(); fill(C.cyan); ellipse(rxp.x, rxp.y, 9, 9); stroke(C.cyan); strokeWeight(1); noFill(); ellipse(rxp.x, rxp.y, 16, 16);
    noStroke(); t("RX", rxp.x + 11, rxp.y - 4, C.cyan, 9);
    drawingContext.restore(); pop();
    // FLAVOR colour key — roles currently present
    const present = [...new Set(live.map(roleName))].slice(0, 8);
    if (present.length) {
      noStroke(); fill(4, 8, 12, 214); rect(r.x + r.w - 104, r.y + 2, 102, (present.length + 1) * 13 + 6, 3);
      t("FLAVOR", r.x + r.w - 96, r.y + 6, C.dim, 8);
      let ky = r.y + 19;
      for (const rn of present) { noStroke(); fill(ROLECOL[rn] || C.cyan); ellipse(r.x + r.w - 92, ky + 4, 7, 7); t(rn.replace(/_/g, " "), r.x + r.w - 82, ky, C.muted, 8.5); ky += 13; }
    }
  }

  // ---- traffic by type --------------------------------------------------------
  function traffic(x, y, w, h) {
    const m = F(); const r = panel(x, y, w, h, "Traffic · type", m.stats.total);
    const order = ["nodeinfo", "position", "telemetry", "text", "routing", "traceroute", "neighbor", "admin", "data"];
    const entries = order.map((k) => [k, m.stats.byType[k] || 0]).filter((e) => e[1] > 0);
    const max = Math.max(1, ...entries.map((e) => e[1])); let ry = r.y + 2;
    for (const [k, v] of entries) {
      t(k, r.x, ry, C.muted, 10); const bx = r.x + 78, bw = r.w - 78 - 30;
      noStroke(); fill(C.grid); rect(bx, ry + 1, bw, 9, 2); fill(TYPE[k] || C.data); rect(bx, ry + 1, bw * (v / max), 9, 2);
      t("" + v, r.x + r.w, ry, C.ink, 10, RIGHT); ry += 16;
      if (ry > r.y + r.h - 12) break;
    }
  }

  // ---- channel + encryption + rate sparkline ---------------------------------
  function channels(x, y, w, h) {
    const m = F(); const r = panel(x, y, w, h, "Channel · encryption", null);
    const enc = m.stats.enc, tot = Math.max(1, enc.channel + enc.pkc + enc.other);
    // enc stacked bar
    let bx = r.x; const bw = r.w; const segs = [["LongFast", enc.channel, C.cyan], ["PKC DM", enc.pkc, TYPE.pkc], ["other", enc.other, C.dim]];
    for (const [, v, c] of segs) { noStroke(); fill(c); rect(bx, r.y, bw * (v / tot), 10, 1); bx += bw * (v / tot); }
    let ly = r.y + 16;
    for (const [k, v, c] of segs) { noStroke(); fill(c); rect(r.x, ly + 2, 8, 8); t(k, r.x + 13, ly, C.muted, 10); t("" + v, r.x + r.w, ly, C.ink, 10, RIGHT); ly += 15; }
    if (m.stats.mqtt) t("via MQTT: " + m.stats.mqtt, r.x, ly, C.amber, 9.5), ly += 14;
    // rate sparkline (last 60s)
    t("PKT RATE · 60s", r.x, ly + 2, C.dim, 9); ly += 15;
    const buckets = m.rateBuckets(48, 60000), bmax = Math.max(1, ...buckets), gh = r.y + r.h - ly - 2;
    const gw = r.w / buckets.length;
    for (let i = 0; i < buckets.length; i++) { noStroke(); fill(C.green); const bh = gh * (buckets[i] / bmax); rect(r.x + i * gw, ly + gh - bh, gw - 1, bh); }
    stroke(C.grid); line(r.x, ly + gh, r.x + r.w, ly + gh);
  }

  // ---- telemetry gauges -------------------------------------------------------
  function telemetry(x, y, w, h) {
    const m = F(); const r = panel(x, y, w, h, "Telemetry · mesh", null);
    let bat = [], cu = [], au = [], tp = [];
    for (const n of m.nodes.values()) {
      if (n.battery != null) bat.push(n.battery); if (n.chanUtil != null) cu.push(n.chanUtil);
      if (n.airUtil != null) au.push(n.airUtil); if (n.temp != null) tp.push(n.temp);
    }
    const avg = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
    const gauges = [["BATTERY", avg(bat), "%", 100, C.green], ["CHAN UTIL", avg(cu), "%", 100, C.amber],
      ["AIR TX", avg(au), "%", 25, C.cyan], ["TEMP", avg(tp), "°C", 40, "#ff9e42"]];
    const gw = r.w / 2 - 6, gh = (r.h - 8) / 2 - 6; let i = 0;
    for (const [lab, val, unit, mx, col] of gauges) {
      const gx = r.x + (i % 2) * (gw + 12), gy = r.y + Math.floor(i / 2) * (gh + 10);
      t(lab, gx, gy, C.dim, 9);
      t(val == null ? "—" : val.toFixed(unit === "%" ? 0 : 1) + unit, gx, gy + 12, val == null ? C.dim : col, 17);
      noStroke(); fill(C.grid); rect(gx, gy + gh - 4, gw, 4, 2);
      if (val != null) { fill(col); rect(gx, gy + gh - 4, gw * constrain(val / mx, 0, 1), 4, 2); }
      i++;
    }
  }

  // ---- intel feed -------------------------------------------------------------
  const KINDCOL = { NODE: C.cyan, TEXT: C.amber, POS: C.cyan, TELEM: C.green, ROUTE: C.muted, TRACE: "#ff9e42", NEIGH: "#5b8bff", PKC: TYPE.pkc };
  function feed(x, y, w, h) {
    const m = F(); const r = panel(x, y, w, h, "Intel Feed", m.events.length);
    const rows = m.events.slice().reverse(), lh = 15, vis = Math.floor(r.h / lh);
    S.feedScroll = constrain(S.feedScroll, 0, Math.max(0, rows.length - vis));   // clamp: never scroll into the void
    push(); drawingContext.save(); drawingContext.beginPath(); drawingContext.rect(r.x, r.y, r.w, r.h); drawingContext.clip();
    const now = performance.now();
    for (let i = 0; i < vis + 1; i++) {
      const e = rows[i + Math.floor(S.feedScroll)]; if (!e) break; const ry = r.y + i * lh;
      const age = (now - e.t) / 1000; const fade = age < 1 ? 255 : 190;
      const dt = new Date(Date.now() - (now - e.t));
      t(("0" + dt.getMinutes()).slice(-2) + ":" + ("0" + dt.getSeconds()).slice(-2), r.x, ry, C.dim, 9.5);
      noStroke(); fill(KINDCOL[e.kind] || C.muted); rect(r.x + 34, ry + 1, 3, 10);
      const col = KINDCOL[e.kind] || C.muted;
      t("[" + e.kind + "]", r.x + 42, ry, col, 9.5);
      t(trunc(e.text, Math.floor((r.w - 120) / 6.2)), r.x + 42 + textWidth("[" + e.kind + "]") + 6, ry, C.ink, 9.5);
    }
    drawingContext.restore(); pop();
    scrollbar(r.x + r.w + 3, r.y, r.h, S.feedScroll, rows.length, vis); S.feedRect = r;
  }

  // ---- decoded channel messages (chat-style: newest at the bottom) -----------
  function messages(x, y, w, h) {
    const m = F(); const r = panel(x, y, w, h, "Channel Messages", m.messages.length);
    const rows = m.messages, lh = 30, vis = Math.max(1, Math.floor(r.h / lh));
    const maxScroll = Math.max(0, rows.length - vis);
    S.msgScroll = constrain(S.msgScroll, 0, maxScroll);         // 0 = pinned to newest
    const start = Math.max(0, rows.length - vis - S.msgScroll);
    push(); drawingContext.save(); drawingContext.beginPath(); drawingContext.rect(r.x, r.y, r.w, r.h); drawingContext.clip();
    const now = performance.now();
    if (!rows.length) t("no text messages decoded yet", r.x, r.y + 4, C.dim, 10);
    for (let i = 0; i < vis; i++) {
      const e = rows[start + i]; if (!e) continue; const ry = r.y + i * lh;
      const dst = e.to && e.to !== m.BROADCAST ? ((m.nodes.get(e.to) || {}).sname || "?") : "all";
      const dt = new Date(Date.now() - (now - e.t));
      t(("0" + dt.getHours()).slice(-2) + ":" + ("0" + dt.getMinutes()).slice(-2), r.x, ry + 1, C.dim, 9);
      t((e.sname || "?") + " → " + dst, r.x + 38, ry, e.pki ? C.green : C.cyan, 10.5);
      if (e.pki) t("🔒", r.x + r.w - 12, ry, C.green, 9, RIGHT);
      t(trunc(e.text, Math.floor((r.w - 12) / 6.6)), r.x + 6, ry + 14, C.ink, 11.5);
      stroke(C.grid); strokeWeight(1); line(r.x, ry + lh - 3, r.x + r.w, ry + lh - 3);
    }
    drawingContext.restore(); pop();
    scrollbar(r.x + r.w + 3, r.y, r.h, start, rows.length, vis); S.msgRect = r;
    if (S.msgScroll > 0) t("↓ jump to newest (scroll down)", r.x + r.w, r.y + r.h - 11, C.amber, 8.5, RIGHT);
  }

  // ---- map panel (replaces the signal scope) ---------------------------------
  const niceKm = (v) => { const p = Math.pow(10, Math.floor(Math.log10(v))), mm = v / p; return (mm < 1.5 ? 1 : mm < 3.5 ? 2 : mm < 7 ? 5 : 10) * p; };
  function mapPanel(x, y, w, h) {
    const m = F(); const r = panel(x, y, w, h, "Map · GPS positions", null);
    const now = performance.now();
    const nodes = [...m.nodes.values()].filter((n) => n.lat != null && n.lon != null && now - n.lastHeard < 300000);
    const box = { x: r.x, y: r.y, w: r.w, h: r.h };
    S.mapRect = box;
    push(); drawingContext.save(); drawingContext.beginPath(); drawingContext.rect(r.x, r.y, r.w, r.h); drawingContext.clip();
    noStroke(); fill(6, 12, 18); rect(r.x, r.y, r.w, r.h);
    if (!nodes.length) {
      drawingContext.restore(); pop();
      S.mapBbox = null; S.mapFitBtn = null;
      t("no GPS fixes yet", r.x + r.w / 2, r.y + r.h / 2 - 12, C.muted, 12, CENTER);
      t("nodes appear here once they broadcast a Position (portnum 3)", r.x + r.w / 2, r.y + r.h / 2 + 6, C.dim, 9.5, CENTER);
      return;
    }
    let a0 = Infinity, a1 = -Infinity, o0 = Infinity, o1 = -Infinity;
    for (const n of nodes) { a0 = Math.min(a0, n.lat); a1 = Math.max(a1, n.lat); o0 = Math.min(o0, n.lon); o1 = Math.max(o1, n.lon); }
    const pa = (a1 - a0) * 0.35 + 0.0016, po = (o1 - o0) * 0.35 + 0.0016;
    const bbox = { minLat: a0 - pa, maxLat: a1 + pa, minLon: o0 - po, maxLon: o1 + po };
    S.mapBbox = bbox;
    const tiles = window.MapTiles.draw(drawingContext, bbox, box, S.mapView);   // S.mapView overrides auto-fit once the user zooms/pans
    const proj = tiles.proj;
    if (!tiles.loaded) {   // basemap still loading (or offline) — a faint graticule so it is never blank
      stroke(C.grid); strokeWeight(1);
      for (let i = 1; i < 6; i++) { const gx = r.x + r.w * i / 6, gy = r.y + r.h * i / 6; line(gx, r.y, gx, r.y + r.h); line(r.x, gy, r.x + r.w, gy); }
    }
    const LK = { dm: C.green, route: "#ff9e42", neighbor: "#5b8bff", dir: C.line2 };
    for (const l of m.links) { const A = m.nodes.get(l.a), B = m.nodes.get(l.b); if (!A || !B || A.lat == null || B.lat == null) continue;
      const P = proj(A.lat, A.lon), Q = proj(B.lat, B.lon); stroke(LK[l.kind] || C.line2); strokeWeight(l.kind === "dm" ? 1.6 : 1.1); line(P.x, P.y, Q.x, Q.y); }
    const seen = new Map();
    for (const n of nodes) { const key = n.lat.toFixed(5) + "," + n.lon.toFixed(5); const k = seen.get(key) || 0; seen.set(key, k + 1);
      const p = proj(n.lat, n.lon); if (k) { p.x += Math.cos(k) * 8; p.y += Math.sin(k) * 8; }
      const c = roleColor(n);
      drawingContext.save(); drawingContext.shadowBlur = 10; drawingContext.shadowColor = c;
      noStroke(); if (now - n.lastHeard < 1500) { fill(C.ink); ellipse(p.x, p.y, 12, 12); }
      fill(c); ellipse(p.x, p.y, 7, 7); drawingContext.restore();
      t(n.sname, p.x + 6, p.y - 5, C.ink, 8.5);
      if (p.x > r.x - 2 && p.x < r.x + r.w + 2 && p.y > r.y - 2 && p.y < r.y + r.h + 2) S.hits.push({ id: n.id, x: p.x, y: p.y, r: 9 });   // only click on-screen markers
    }
    drawingContext.restore(); pop();
    const mpp = window.MapTiles.mPerPx(tiles.lat, tiles.z);   // meters per (logical) pixel at this zoom
    const barKm = niceKm(mpp * 90 / 1000), barPx = barKm * 1000 / mpp;
    stroke(C.muted); strokeWeight(2); line(r.x + 8, r.y + r.h - 10, r.x + 8 + barPx, r.y + r.h - 10);
    t((barKm >= 1 ? barKm + " km" : (barKm * 1000) + " m") + "  ·  z" + tiles.z, r.x + 12 + barPx, r.y + r.h - 16, C.muted, 8.5);
    t(window.MapTiles.ATTRIB, r.x + 8, r.y + 3, C.dim, 8);
    t(nodes.length + " positioned · " + (m.nodes.size - nodes.length) + " no fix", r.x + r.w, r.y + r.h - 14, C.dim, 8.5, RIGHT);
    if (S.mapView) {   // manual view: offer a reset-to-fit button
      const bw = 42, bh = 15, bx = r.x + r.w - bw - 6, by = r.y + 3;
      noStroke(); fill(6, 14, 20, 235); rect(bx, by, bw, bh, 3); stroke(C.line2); strokeWeight(1); noFill(); rect(bx, by, bw, bh, 3);
      noStroke(); t("⟲ fit", bx + 7, by + 3, C.cyan, 9); S.mapFitBtn = { x: bx, y: by, w: bw, h: bh };
    } else S.mapFitBtn = null;
  }

  // ---- RSSI ranking (relative signal strength, strongest first) ---------------
  const rssiColor = (v) => v == null ? C.dim : v > -80 ? C.green : v > -105 ? C.amber : C.red;
  function rssiRank(x, y, w, h) {
    const m = F(); const r = panel(x, y, w, h, "Signal · RSSI rank", null);
    const now = performance.now();
    const nodes = [...m.nodes.values()].filter((n) => n.rssi != null && now - n.lastHeard < 180000).sort((A, B) => B.rssi - A.rssi);
    if (!nodes.length) { t("no signal data yet", r.x, r.y + 4, C.dim, 10); return; }
    const lh = 18, vis = Math.floor(r.h / lh); let ry = r.y;
    for (const n of nodes.slice(0, vis)) {
      const tt = constrain((n.rssi + 130) / 100, 0, 1);   // -130 weak … -30 strong
      noStroke(); fill(roleColor(n)); ellipse(r.x + 4, ry + 6, 6, 6);
      t(n.sname, r.x + 13, ry + 1, C.ink, 10);
      const bx = r.x + 66, bw = r.w - 66 - 48;
      fill(C.grid); rect(bx, ry + 3, bw, 7, 2); fill(rssiColor(n.rssi)); rect(bx, ry + 3, bw * tt, 7, 2);
      t(n.rssi + " dBm", r.x + r.w, ry + 1, rssiColor(n.rssi), 9.5, RIGHT);
      ry += lh;
    }
    if (nodes.length > vis) t("+" + (nodes.length - vis) + " more", r.x + r.w, r.y + r.h - 11, C.dim, 8.5, RIGHT);
  }

  function draw(status) {
    background(C.bg);
    F().prune();
    S.hits = []; S.rosterHits = [];
    const W = width, H = height, p = 12, L = S.layout;
    const headH = 46, footH = constrain(H * L.foot, 120, H * 0.5);
    const bodyY = p + headH + p, bodyH = H - bodyY - footH - p * 2;
    const leftW = constrain(W * L.left, 180, W * 0.5), rightW = constrain(W * L.right, 170, W * 0.44);
    const centerX = p + leftW + p, centerW = W - leftW - rightW - p * 4;
    const mapH = bodyH * L.map - p / 2, graphY = bodyY + bodyH * L.map + p / 2, graphH = bodyH * (1 - L.map) - p / 2;
    S.geom = { W, H, p, bodyY, bodyH, centerX, centerW };
    header(p, p, W - p * 2, headH, status);
    roster(p, bodyY, leftW, bodyH);
    mapPanel(centerX, bodyY, centerW, mapH);
    graph(centerX, graphY, centerW, graphH);
    const rx = W - p - rightW, th = (bodyH - p * 2) / 3;
    traffic(rx, bodyY, rightW, th);
    rssiRank(rx, bodyY + th + p, rightW, th);
    telemetry(rx, bodyY + (th + p) * 2, rightW, th);
    const availW = W - p * 3, feedW = availW * 0.58;
    feed(p, H - footH - p, feedW, footH);
    messages(p + feedW + p, H - footH - p, availW - feedW, footH);
    // draggable dividers (sit in the gaps between panels)
    S.dividers = [
      { key: "left", axis: "v", x: p + leftW + p / 2, y0: bodyY, y1: bodyY + bodyH },
      { key: "right", axis: "v", x: W - p - rightW - p / 2, y0: bodyY, y1: bodyY + bodyH },
      { key: "map", axis: "h", y: bodyY + bodyH * L.map, x0: centerX, x1: centerX + centerW },
      { key: "foot", axis: "h", y: H - footH - p - p / 2 + 1, x0: p, x1: W - p },
    ];
    dividers();
    detail();
  }
  function dividers() {
    for (const d of S.dividers) {
      const hot = (S.hoverDivider === d.key) || (S.dragDivider && S.dragDivider.key === d.key);
      stroke(hot ? C.cyan : C.line); strokeWeight(hot ? 2 : 1);
      if (d.axis === "v") { line(d.x, d.y0 + 6, d.x, d.y1 - 6); const cy = (d.y0 + d.y1) / 2; noStroke(); fill(hot ? C.cyan : C.line2); for (let i = -1; i <= 1; i++) ellipse(d.x, cy + i * 5, 2.6, 2.6); }
      else { line(d.x0 + 6, d.y, d.x1 - 6, d.y); const cx = (d.x0 + d.x1) / 2; noStroke(); fill(hot ? C.cyan : C.line2); for (let i = -1; i <= 1; i++) ellipse(cx + i * 5, d.y, 2.6, 2.6); }
    }
  }
  function hitDivider(mx, my) {
    for (const d of S.dividers) {
      if (d.axis === "v" && Math.abs(mx - d.x) < 6 && my > d.y0 && my < d.y1) return d;
      if (d.axis === "h" && Math.abs(my - d.y) < 6 && mx > d.x0 && mx < d.x1) return d;
    }
    return null;
  }
  const inMap = (mx, my) => S.mapRect && mx > S.mapRect.x && mx < S.mapRect.x + S.mapRect.w && my > S.mapRect.y && my < S.mapRect.y + S.mapRect.h;

  // ---- click-to-inspect a node ------------------------------------------------
  const ago = (t0) => { const s = (performance.now() - t0) / 1000; return s < 90 ? (s | 0) + "s" : s < 5400 ? (s / 60 | 0) + "m" : (s / 3600 | 0) + "h"; };
  function detail() {
    if (!S.selected) { S.detailRect = null; return; }
    const m = F(), n = m.nodes.get(S.selected); if (!n) { S.selected = null; return; }
    const rows = [["Node ID", n.id], ["Role", roleName(n)], ["Hardware", m.HW[n.hw] || "unknown"],
      ["Signal", (n.snr != null ? n.snr + " dB SNR" : "—") + "   " + (n.rssi != null ? n.rssi + " dBm" : "")],
      ["Hops away", n.hops != null ? String(n.hops) : "—"],
      ["Battery", n.battery != null ? n.battery + "%" + (n.voltage ? "  " + n.voltage + " V" : "") : "—"]];
    if (n.chanUtil != null || n.airUtil != null) rows.push(["Airtime", (n.chanUtil != null ? "ch " + n.chanUtil + "%" : "") + (n.airUtil != null ? "   tx " + n.airUtil + "%" : "")]);
    if (n.temp != null || n.humidity != null) rows.push(["Environment", (n.temp != null ? n.temp + " °C" : "") + (n.humidity != null ? "   " + n.humidity + "% rh" : "")]);
    if (n.lat != null && n.lon != null) rows.push(["Position", n.lat.toFixed(5) + ", " + n.lon.toFixed(5) + (n.alt != null ? "  " + n.alt + " m" : "")]);
    rows.push(["Security", n.pki ? "PKI key on file" : "no key seen"]);
    rows.push(["Traffic", n.count + " pkts   first heard " + ago(n.firstHeard) + " ago"]);
    const w = 356, h = 34 + rows.length * 17 + 6, x = width / 2 - w / 2, y = 58;
    noStroke(); fill(6, 14, 20, 244); rect(x, y, w, h, 6); stroke(roleColor(n)); strokeWeight(1.4); noFill(); rect(x, y, w, h, 6);
    noStroke(); fill(roleColor(n)); ellipse(x + 16, y + 15, 9, 9);
    t(n.name || n.sname, x + 26, y + 9, C.ink, 13); t(n.sname, x + 26 + textWidth(n.name || n.sname) + 8, y + 11, C.dim, 10);
    t("✕", x + w - 17, y + 9, C.muted, 14); stroke(C.line); strokeWeight(1); line(x + 8, y + 30, x + w - 8, y + 30);
    let ly = y + 36; for (const [k, v] of rows) { t(k, x + 12, ly, C.dim, 9.5); t(String(v), x + 116, ly, C.ink, 10.5); ly += 17; }
    S.detailRect = { x, y, w, h, cx: x + w - 15, cy: y + 12 };
  }
  function onClick(mx, my) {
    if (S.mapFitBtn) { const b = S.mapFitBtn; if (mx > b.x && mx < b.x + b.w && my > b.y && my < b.y + b.h) { S.mapView = null; return; } }
    if (S.detailRect) { const d = S.detailRect;
      if (Math.hypot(mx - d.cx, my - d.cy) < 13) { S.selected = null; S.detailRect = null; return; }
      if (mx > d.x && mx < d.x + d.w && my > d.y && my < d.y + d.h) return;   // click inside panel: keep open
    }
    for (const h of S.rosterHits) if (mx > h.x && mx < h.x + h.w && my > h.y && my < h.y + h.h) { S.selected = h.id; return; }
    let best = null, bd = 1e9;
    for (const h of S.hits) { const d = Math.hypot(mx - h.x, my - h.y); if (d < h.r + 5 && d < bd) { bd = d; best = h.id; } }
    S.selected = best;   // null when clicking empty space collapses the panel
  }

  function onWheel(dy, mx, my) {
    if (inMap(mx, my)) {   // scroll over the map = zoom about the cursor
      if (!S.mapView && S.mapBbox) S.mapView = window.MapTiles.fitView(S.mapBbox, S.mapRect);
      if (S.mapView) S.mapView = window.MapTiles.zoomAt(S.mapView, mx, my, S.mapRect, dy < 0 ? 1 : -1);
      return;
    }
    const inR = (r) => r && mx > r.x - 6 && mx < r.x + r.w + 8 && my > r.y && my < r.y + r.h;
    if (inR(S.rosterRect)) S.rosterScroll += dy > 0 ? 1 : -1;
    else if (inR(S.feedRect)) S.feedScroll += dy > 0 ? 1 : -1;
    else if (inR(S.msgRect)) S.msgScroll += dy > 0 ? -1 : 1;   // chat-style: down = newer, up = older
  }

  // ---- pointer: dividers resize panels, dragging the map pans it, a plain click selects ----
  function onPress(mx, my) {
    const d = hitDivider(mx, my);
    if (d) { S.dragDivider = d; S.press = { mx, my, mode: "divider", moved: false }; return; }
    S.press = { mx, my, mode: inMap(mx, my) ? "map" : "click", moved: false };
  }
  function onDrag(mx, my, dx, dy) {
    if (!S.press) return;
    if (Math.abs(mx - S.press.mx) + Math.abs(my - S.press.my) > 3) S.press.moved = true;
    const g = S.geom; if (!g) return;
    if (S.press.mode === "divider" && S.dragDivider) {
      const d = S.dragDivider;
      if (d.key === "left") S.layout.left = constrain(mx / g.W, 0.15, 0.45);
      else if (d.key === "right") S.layout.right = constrain((g.W - mx) / g.W, 0.15, 0.42);
      else if (d.key === "foot") S.layout.foot = constrain((g.H - my) / g.H, 0.12, 0.5);
      else if (d.key === "map") S.layout.map = constrain((my - g.bodyY) / g.bodyH, 0.28, 0.8);
    } else if (S.press.mode === "map" && S.press.moved) {
      if (!S.mapView && S.mapBbox) S.mapView = window.MapTiles.fitView(S.mapBbox, S.mapRect);
      if (S.mapView) S.mapView = window.MapTiles.panBy(S.mapView, dx, dy, S.mapRect);
    }
  }
  function onRelease() {
    if (S.press) {
      if (!S.press.moved && (S.press.mode === "click" || S.press.mode === "map")) onClick(S.press.mx, S.press.my);
      if (S.dragDivider && S.press.moved) saveLayout();
    }
    S.press = null; S.dragDivider = null;
  }
  function onMove(mx, my) {
    const d = hitDivider(mx, my); S.hoverDivider = d ? d.key : null;
    if (d) return d.axis === "v" ? "ew-resize" : "ns-resize";
    if (inMap(mx, my)) return "grab";
    return "default";
  }
  return { draw, onWheel, onClick, onPress, onDrag, onRelease, onMove, select: (id) => { S.selected = id; } };
})();
