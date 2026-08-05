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

  const S = { rosterScroll: 0, feedScroll: 0, msgScroll: 0, sweep: 0, fx: new Map() }; // fx = graph positions
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

  // ---- mesh link graph (force-directed) --------------------------------------
  function graph(x, y, w, h) {
    const m = F(); const r = panel(x, y, w, h, "Mesh Link Graph", m.links.length);
    const now = performance.now();
    const live = [...m.nodes.values()].filter((n) => now - n.lastHeard < 120000).slice(0, 44);
    const ids = new Set(live.map((n) => n.id));
    for (const n of live) if (!S.fx.has(n.id)) S.fx.set(n.id, { x: r.x + n.sx * r.w, y: r.y + n.sy * r.h, vx: 0, vy: 0 });
    // forces
    for (const a of live) {
      const pa = S.fx.get(a.id); let fxv = 0, fyv = 0;
      for (const b of live) { if (a === b) continue; const pb = S.fx.get(b.id); let dx = pa.x - pb.x, dy = pa.y - pb.y; let d2 = dx * dx + dy * dy + 0.01; const f = 380 / d2; fxv += dx * f; fyv += dy * f; }
      fxv += (r.x + r.w / 2 - pa.x) * 0.006; fyv += (r.y + r.h / 2 - pa.y) * 0.006; // gravity
      pa.vx = (pa.vx + fxv) * 0.82; pa.vy = (pa.vy + fyv) * 0.82;
    }
    for (const l of m.links) {
      if (l.until < now || !ids.has(l.a) || !ids.has(l.b)) continue;
      const pa = S.fx.get(l.a), pb = S.fx.get(l.b); if (!pa || !pb) continue;
      const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy) || 1, k = (d - 78) * 0.012;
      pa.vx += dx / d * k; pa.vy += dy / d * k; pb.vx -= dx / d * k; pb.vy -= dy / d * k;
    }
    push(); drawingContext.save(); drawingContext.beginPath(); drawingContext.rect(r.x, r.y, r.w, r.h); drawingContext.clip();
    const LK = { dm: C.green, route: "#ff9e42", neighbor: "#5b8bff", dir: C.line2 };
    for (const l of m.links) {
      if (l.until < now || !ids.has(l.a) || !ids.has(l.b)) continue;
      const pa = S.fx.get(l.a), pb = S.fx.get(l.b); if (!pa || !pb) continue;
      stroke(LK[l.kind] || C.line2); strokeWeight(l.kind === "dm" ? 1.6 : 1); line(pa.x, pa.y, pb.x, pb.y);
    }
    for (const n of live) {
      const p = S.fx.get(n.id); p.x = constrain(p.x + p.vx, r.x + 6, r.x + r.w - 6); p.y = constrain(p.y + p.vy, r.y + 6, r.y + r.h - 6);
      const rolen = m.ROLE[n.role] || ""; const hub = rolen.includes("ROUTER") || rolen === "REPEATER";
      noStroke(); fill(ROLECOL[rolen] || C.cyan); const s = hub ? 9 : 6 + Math.min(4, n.count / 8);
      if (now - n.lastHeard < 1200) { fill(C.ink); ellipse(p.x, p.y, s + 5, s + 5); }
      fill(roleColor(n)); ellipse(p.x, p.y, s, s);
      t(n.sname, p.x + s / 2 + 3, p.y - 5, C.muted, 8.5);
    }
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

  // ---- decoded channel messages ----------------------------------------------
  function messages(x, y, w, h) {
    const m = F(); const r = panel(x, y, w, h, "Channel Messages", m.messages.length);
    const rows = m.messages.slice().reverse(), lh = 30, vis = Math.floor(r.h / lh);
    S.msgScroll = constrain(S.msgScroll, 0, Math.max(0, rows.length - vis));
    push(); drawingContext.save(); drawingContext.beginPath(); drawingContext.rect(r.x, r.y, r.w, r.h); drawingContext.clip();
    const now = performance.now();
    if (!rows.length) t("no text messages decoded yet", r.x, r.y + 4, C.dim, 10);
    for (let i = 0; i < vis + 1; i++) {
      const e = rows[i + Math.floor(S.msgScroll)]; if (!e) break; const ry = r.y + i * lh;
      const dst = e.to && e.to !== m.BROADCAST ? ((m.nodes.get(e.to) || {}).sname || "?") : "all";
      const dt = new Date(Date.now() - (now - e.t));
      t(("0" + dt.getHours()).slice(-2) + ":" + ("0" + dt.getMinutes()).slice(-2), r.x, ry + 1, C.dim, 9);
      t((e.sname || "?") + " → " + dst, r.x + 38, ry, e.pki ? C.green : C.cyan, 10.5);
      if (e.pki) t("🔒", r.x + r.w - 12, ry, C.green, 9, RIGHT);
      t(trunc(e.text, Math.floor((r.w - 12) / 6.6)), r.x + 6, ry + 14, C.ink, 11.5);
      stroke(C.grid); strokeWeight(1); line(r.x, ry + lh - 3, r.x + r.w, ry + lh - 3);
    }
    drawingContext.restore(); pop();
    scrollbar(r.x + r.w + 3, r.y, r.h, S.msgScroll, rows.length, vis); S.msgRect = r;
  }

  function draw(status) {
    background(C.bg);
    F().prune();
    const W = width, H = height, p = 12;
    const headH = 46, footH = Math.max(120, H * 0.2);
    const bodyY = p + headH + p, bodyH = H - bodyY - footH - p * 2;
    const leftW = Math.min(430, W * 0.29), rightW = Math.min(320, W * 0.24);
    const centerX = p + leftW + p, centerW = W - leftW - rightW - p * 4;
    header(p, p, W - p * 2, headH, status);
    roster(p, bodyY, leftW, bodyH);
    scope(centerX, bodyY, centerW, bodyH * 0.56 - p / 2);
    graph(centerX, bodyY + bodyH * 0.56 + p / 2, centerW, bodyH * 0.44 - p / 2);
    const rx = W - p - rightW, th = (bodyH - p * 2) / 3;
    traffic(rx, bodyY, rightW, th);
    channels(rx, bodyY + th + p, rightW, th);
    telemetry(rx, bodyY + (th + p) * 2, rightW, th);
    const availW = W - p * 3, feedW = availW * 0.58;
    feed(p, H - footH - p, feedW, footH);
    messages(p + feedW + p, H - footH - p, availW - feedW, footH);
  }

  function onWheel(dy, mx, my) {
    const inR = (r) => r && mx > r.x - 6 && mx < r.x + r.w + 8 && my > r.y && my < r.y + r.h;
    if (inR(S.rosterRect)) S.rosterScroll += dy > 0 ? 1 : -1;
    else if (inR(S.feedRect)) S.feedScroll += dy > 0 ? 1 : -1;
    else if (inR(S.msgRect)) S.msgScroll += dy > 0 ? 1 : -1;
  }
  return { draw, onWheel };
})();
