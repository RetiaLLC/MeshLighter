/*
 * neural.js — Neural Mesh renderer. The cinematic counterpart to the Tactical HUD:
 * glowing nodes drift in a gentle force field, bonds light up between nodes that talk,
 * packets stream between them coloured by type, and text messages surface as bubbles.
 * Reads the same window.MeshModel, so the two views are the same data, different lens.
 */
window.Neural = (function () {
  const TYPE = { nodeinfo: "#bf5bff", text: "#f5b642", position: "#33e1ff", telemetry: "#35ff9e",
    routing: "#8fa6b4", traceroute: "#ff9e42", neighbor: "#5b8bff", admin: "#ff5a6a", pkc: "#ff5bd0", data: "#8899aa" };
  const ROLECOL = { ROUTER: "#f5b642", ROUTER_CLIENT: "#f5b642", REPEATER: "#bf5bff", SENSOR: "#35ff9e", TRACKER: "#ff9e42" };
  const HUD = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const NS = { pos: new Map() };
  const F = () => window.MeshModel;

  function pos(n) {
    let p = NS.pos.get(n.id);
    if (!p) { const s = Math.min(width, height) * 0.34;   // seed near centre, not full-screen
      p = { x: width / 2 + (n.sx - 0.5) * s, y: height / 2 + (n.sy - 0.5) * s, vx: 0, vy: 0 }; NS.pos.set(n.id, p); }
    return p;
  }

  function draw(status) {
    background(2, 6, 10);
    const m = F(); m.prune(); const now = performance.now();
    const live = [...m.nodes.values()].filter((n) => now - n.lastHeard < 150000);
    const ids = new Set(live.map((n) => n.id));
    // forces
    for (const a of live) {
      const pa = pos(a); let fx = 0, fy = 0;
      for (const b of live) { if (a === b) continue; const pb = pos(b); let dx = pa.x - pb.x, dy = pa.y - pb.y, d2 = dx * dx + dy * dy + 0.01;
        const f = Math.min(0.9, 4200 / d2); fx += dx * f; fy += dy * f; }   // capped repulsion (keep spacing without launching to the edge)
      fx += (width / 2 - pa.x) * 0.02; fy += (height / 2 - pa.y) * 0.02;      // firm gravity keeps the cluster centred
      pa.vx = (pa.vx + fx) * 0.84; pa.vy = (pa.vy + fy) * 0.84;
    }
    for (const l of m.links) {
      if (!ids.has(l.a) || !ids.has(l.b)) continue; const pa = pos(m.nodes.get(l.a)), pb = pos(m.nodes.get(l.b));
      const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy) || 1, k = (d - 170) * 0.004;
      pa.vx += dx / d * k; pa.vy += dy / d * k; pb.vx -= dx / d * k; pb.vy -= dy / d * k;
    }
    // bonds
    drawingContext.save();
    for (const l of m.links) {
      if (!ids.has(l.a) || !ids.has(l.b)) continue; const pa = pos(m.nodes.get(l.a)), pb = pos(m.nodes.get(l.b));
      const c = l.kind === "dm" ? "#35ff9e" : l.kind === "route" ? "#ff9e42" : l.kind === "neighbor" ? "#5b8bff" : "#1b4a5e";
      stroke(c); strokeWeight(l.kind === "dm" ? 1.5 : 0.8); drawingContext.shadowBlur = 8; drawingContext.shadowColor = c;
      line(pa.x, pa.y, pb.x, pb.y);
    }
    drawingContext.shadowBlur = 0; drawingContext.restore();
    // packets streaming source→dest
    for (const pk of m.packets) {
      const age = now - pk.t; if (age > 1400) continue; const s = m.nodes.get(pk.from); if (!s) continue;
      const ps = pos(s); const d = pk.to && m.nodes.get(pk.to) ? pos(m.nodes.get(pk.to)) : { x: ps.x, y: ps.y };
      const tt = age / 1400; const px = lerp(ps.x, d.x, tt), py = lerp(ps.y, d.y, tt);
      const c = pk.pki ? TYPE.pkc : (TYPE[pk.type] || TYPE.data); noStroke(); fill(red(color(c)), green(color(c)), blue(color(c)), 255 * (1 - tt));
      circle(px, py, 4);
    }
    // nodes
    for (const n of live) {
      const p = pos(n); p.x = constrain(p.x + p.vx, 40, width - 40); p.y = constrain(p.y + p.vy, 60, height - 40);
      const rolen = m.ROLE[n.role] || ""; const c = ROLECOL[rolen] || "#33e1ff";
      const fresh = now - n.lastHeard; if (fresh < 900) { noFill(); stroke(c); strokeWeight(1); circle(p.x, p.y, 20 + fresh / 30); }
      const sz = 9 + Math.min(9, n.count / 4);
      drawingContext.save(); drawingContext.shadowBlur = 16; drawingContext.shadowColor = c;
      noStroke(); fill(c); circle(p.x, p.y, sz); drawingContext.restore();
      if (n.pki) { noFill(); stroke("#35ff9e"); strokeWeight(1.2); circle(p.x, p.y, sz + 6); }
      noStroke(); fill(220, 235, 245); textFont(HUD); textSize(11); textAlign(CENTER, TOP);
      text(n.name || n.sname, p.x, p.y + sz / 2 + 4);
      if (n.msgUntil > now) {
        const w = textWidth(n.msg) + 16; fill(10, 18, 24, 235); stroke("#f5b642"); strokeWeight(1);
        rect(p.x - w / 2, p.y - sz / 2 - 26, w, 20, 5); noStroke(); fill("#f7d9a0"); textSize(11);
        text(n.msg, p.x, p.y - sz / 2 - 22);
      }
    }
    // legend
    textAlign(LEFT, TOP); textFont(HUD);
    fill("#33e1ff"); textSize(14); text("MESHLIGHTER", 16, 14); fill("#4b7183"); textSize(10); text("// neural mesh", 132, 18);
    let ly = 40; for (const [k, c] of Object.entries(TYPE)) { if (!m.stats.byType[k] && k !== "pkc") continue; noStroke(); fill(c); circle(22, ly + 5, 8); fill("#93a2a8"); textSize(10); text(k.toUpperCase(), 32, ly); ly += 15; }
    fill("#6f97a8"); textSize(10); text(`${m.activeNodes()} nodes · ${m.perMin()} pkt/min · ${m.stats.total} total`, 16, height - 22);
  }
  return { draw, onWheel() {} };
})();
