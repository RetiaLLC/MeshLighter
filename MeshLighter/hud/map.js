/*
 * map.js — the full-screen Map view. Plots every node that has shared a Position (portnum 3)
 * on a dark web-map basemap (MapTiles), with role colours, labels, altitude, and observed
 * links. Falls back to a bare graticule when tiles can't load (offline demo). Read-only.
 * Reads window.MeshModel. Nodes without a position are counted as "no fix".
 */
window.MapView = (function () {
  const ROLECOL = { CLIENT: "#33e1ff", CLIENT_MUTE: "#7f95a6", ROUTER: "#f5b642", ROUTER_CLIENT: "#ffcf6b",
    REPEATER: "#bf5bff", TRACKER: "#ff9e42", SENSOR: "#35ff9e", TAK: "#ff5a6a", TAK_TRACKER: "#ff8090",
    CLIENT_HIDDEN: "#5b8bff", LOST_FOUND: "#ff5bd0" };
  const HUD = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const F = () => window.MeshModel;
  const roleName = (n) => F().ROLE[n.role] || "CLIENT";
  const roleColor = (n) => ROLECOL[roleName(n)] || "#33e1ff";
  const tx = (s, x, y, c, sz, al) => { noStroke(); fill(c); textFont(HUD); textSize(sz || 11); textAlign(al || LEFT, TOP); text(s, x, y); };
  const niceKm = (v) => { const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7 ? 5 : 10) * p; };

  function draw() {
    background(4, 7, 11);
    const m = F(); m.prune();
    tx("MESHLIGHTER", 16, 14, "#33e1ff", 14); tx("// map", 132, 18, "#4b7183", 11);
    const nodes = [...m.nodes.values()].filter((n) => n.lat != null && n.lon != null);
    const noFix = [...m.nodes.values()].filter((n) => n.lat == null);
    const mx = 60, my = 64, mw = width - 120, mh = height - 150;
    const box = { x: mx, y: my, w: mw, h: mh };

    push(); drawingContext.save(); drawingContext.beginPath(); drawingContext.rect(mx, my, mw, mh); drawingContext.clip();
    noStroke(); fill(6, 12, 18); rect(mx, my, mw, mh);
    if (!nodes.length) {
      drawingContext.restore(); pop();
      stroke("#123244"); strokeWeight(1); noFill(); rect(mx, my, mw, mh);
      tx("No positioned nodes yet.", width / 2, height / 2 - 20, "#8fa9b6", 15, CENTER);
      tx("Waiting for Position packets (portnum 3). In Demo Mode the mesh carries GPS.", width / 2, height / 2 + 6, "#4b7183", 12, CENTER);
      return;
    }
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const n of nodes) { minLat = Math.min(minLat, n.lat); maxLat = Math.max(maxLat, n.lat); minLon = Math.min(minLon, n.lon); maxLon = Math.max(maxLon, n.lon); }
    const padLat = (maxLat - minLat) * 0.3 + 0.0016, padLon = (maxLon - minLon) * 0.3 + 0.0016;
    const bbox = { minLat: minLat - padLat, maxLat: maxLat + padLat, minLon: minLon - padLon, maxLon: maxLon + padLon };
    const tiles = window.MapTiles.draw(drawingContext, bbox, box);
    const proj = tiles.loaded ? tiles.proj : window.MapTiles.flatProj(bbox, box).proj;
    if (!tiles.loaded) { stroke("#0e2530"); strokeWeight(1); for (let i = 1; i < 8; i++) { const gx = mx + mw * i / 8, gy = my + mh * i / 8; line(gx, my, gx, my + mh); line(mx, gy, mx + mw, gy); } }

    const LK = { dm: "#35ff9e", route: "#ff9e42", neighbor: "#5b8bff", dir: "#1d4a5e" };
    for (const l of m.links) { const a = m.nodes.get(l.a), b = m.nodes.get(l.b); if (!a || !b || a.lat == null || b.lat == null) continue;
      const pa = proj(a.lat, a.lon), pb = proj(b.lat, b.lon); stroke(LK[l.kind] || "#1d4a5e"); strokeWeight(l.kind === "dm" ? 1.6 : 1.1); line(pa.x, pa.y, pb.x, pb.y); }
    const now = performance.now();
    const seen = new Map();
    for (const n of nodes) {
      const key = n.lat.toFixed(5) + "," + n.lon.toFixed(5); const k = seen.get(key) || 0; seen.set(key, k + 1);
      const p = proj(n.lat, n.lon); if (k) { p.x += Math.cos(k) * 9; p.y += Math.sin(k) * 9; }
      const c = roleColor(n); const fresh = now - n.lastHeard < 1500;
      if (fresh) { noFill(); stroke(c); strokeWeight(1); ellipse(p.x, p.y, 22, 22); }
      drawingContext.save(); drawingContext.shadowBlur = 12; drawingContext.shadowColor = c; noStroke(); fill(c); ellipse(p.x, p.y, 11, 11); drawingContext.restore();
      tx(n.name || n.sname, p.x + 9, p.y - 7, "#eaf6fb", 11);
      if (n.alt != null) tx(n.alt + "m", p.x + 9, p.y + 6, "#9fc0cd", 9);
    }
    drawingContext.restore(); pop();

    stroke("#123244"); strokeWeight(1); noFill(); rect(mx, my, mw, mh);   // frame on top of tiles
    const mpp = window.MapTiles.mPerPx(nodes[0].lat, tiles.z);            // meters per logical px
    const barKm = niceKm(mpp * 120 / 1000), barPx = barKm * 1000 / mpp;
    stroke("#8fa9b6"); strokeWeight(2); line(mx + 12, my + mh - 14, mx + 12 + barPx, my + mh - 14);
    tx((barKm >= 1 ? barKm + " km" : (barKm * 1000) + " m"), mx + 16 + barPx, my + mh - 20, "#8fa9b6", 9.5);
    tx(window.MapTiles.ATTRIB, mx + 12, my + 6, "#5b8497", 9);
    tx(`${nodes.length} positioned · ${noFix.length} no fix`, width - 16, height - 22, "#6f97a8", 10, RIGHT);
    tx("passive · read-only", 16, height - 22, "#4b93b0", 10);
  }
  return { draw, onWheel() {}, onClick() {} };
})();
