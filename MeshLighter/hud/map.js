/*
 * map.js — a basic map view. Plots every node that has shared a Position (portnum 3)
 * on an auto-fitted, aspect-corrected plane, with role colours, labels, observed links,
 * a graticule, and a scale bar. No map tiles, just relative geography from the mesh.
 * Reads window.MeshModel. Nodes without a position are listed as "no fix".
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

  function draw() {
    background(4, 7, 11);
    const m = F(); m.prune();
    tx("MESHLIGHTER", 16, 14, "#33e1ff", 14); tx("// map", 132, 18, "#4b7183", 11);
    const nodes = [...m.nodes.values()].filter((n) => n.lat != null && n.lon != null);
    const noFix = [...m.nodes.values()].filter((n) => n.lat == null);
    if (!nodes.length) {
      tx("No positioned nodes yet.", width / 2, height / 2 - 20, "#8fa9b6", 15, CENTER);
      tx("Waiting for Position packets (portnum 3). In Demo Mode the mesh carries GPS.", width / 2, height / 2 + 6, "#4b7183", 12, CENTER);
      return;
    }
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const n of nodes) { minLat = Math.min(minLat, n.lat); maxLat = Math.max(maxLat, n.lat); minLon = Math.min(minLon, n.lon); maxLon = Math.max(maxLon, n.lon); }
    const padLat = (maxLat - minLat) * 0.18 + 0.0006, padLon = (maxLon - minLon) * 0.18 + 0.0006;
    minLat -= padLat; maxLat += padLat; minLon -= padLon; maxLon += padLon;
    const mx = 60, my = 64, mw = width - 120, mh = height - 150;
    const midLat = (minLat + maxLat) / 2, midLon = (minLon + maxLon) / 2, lonScale = Math.cos(midLat * Math.PI / 180);
    const spanLat = Math.max(1e-6, maxLat - minLat), spanLon = Math.max(1e-6, (maxLon - minLon) * lonScale);
    const scale = Math.min(mw / spanLon, mh / spanLat);       // px per degree-equivalent
    const cx = mx + mw / 2, cy = my + mh / 2;
    const proj = (lat, lon) => ({ x: cx + (lon - midLon) * lonScale * scale, y: cy - (lat - midLat) * scale });

    // frame + graticule
    stroke("#123244"); strokeWeight(1); noFill(); rect(mx, my, mw, mh);
    const step = niceStep(spanLat);
    stroke("#0e2530");
    for (let lat = Math.ceil(minLat / step) * step; lat < maxLat; lat += step) { const p = proj(lat, midLon); if (p.y > my && p.y < my + mh) { line(mx, p.y, mx + mw, p.y); tx(lat.toFixed(3), mx + 2, p.y - 11, "#456c7d", 8.5); } }
    for (let lon = Math.ceil(minLon / step) * step; lon < maxLon; lon += step) { const p = proj(midLat, lon); if (p.x > mx && p.x < mx + mw) { line(p.x, my, p.x, my + mh); tx(lon.toFixed(3), p.x + 2, my + 2, "#456c7d", 8.5); } }

    // links between positioned nodes
    push(); drawingContext.save(); drawingContext.beginPath(); drawingContext.rect(mx, my, mw, mh); drawingContext.clip();
    const now = performance.now();
    const LK = { dm: "#35ff9e", route: "#ff9e42", neighbor: "#5b8bff", dir: "#1d4a5e" };
    for (const l of m.links) { const a = m.nodes.get(l.a), b = m.nodes.get(l.b); if (!a || !b || a.lat == null || b.lat == null) continue;
      const pa = proj(a.lat, a.lon), pb = proj(b.lat, b.lon); stroke(LK[l.kind] || "#1d4a5e"); strokeWeight(l.kind === "dm" ? 1.5 : 1); line(pa.x, pa.y, pb.x, pb.y); }
    // nodes (jitter exact-coincident ones so both are visible)
    const seen = new Map();
    for (const n of nodes) {
      const key = n.lat.toFixed(5) + "," + n.lon.toFixed(5); const k = seen.get(key) || 0; seen.set(key, k + 1);
      const p = proj(n.lat, n.lon); if (k) { p.x += Math.cos(k) * 9; p.y += Math.sin(k) * 9; }
      const c = roleColor(n); const fresh = now - n.lastHeard < 1500;
      if (fresh) { noFill(); stroke(c); strokeWeight(1); ellipse(p.x, p.y, 22, 22); }
      drawingContext.save(); drawingContext.shadowBlur = 12; drawingContext.shadowColor = c; noStroke(); fill(c); ellipse(p.x, p.y, 10, 10); drawingContext.restore();
      tx(n.name || n.sname, p.x + 8, p.y - 6, "#d3ecf6", 10.5);
      if (n.alt != null) tx(n.alt + "m", p.x + 8, p.y + 6, "#6f97a8", 8.5);
    }
    drawingContext.restore(); pop();

    // scale bar (km)
    const kmPerPx = 111.32 / scale;   // 1 deg lat ~ 111.32 km
    let barKm = niceKm(kmPerPx * 120), barPx = barKm / kmPerPx;
    stroke("#8fa9b6"); strokeWeight(2); line(mx + 12, my + mh - 14, mx + 12 + barPx, my + mh - 14);
    tx((barKm >= 1 ? barKm + " km" : (barKm * 1000) + " m"), mx + 16 + barPx, my + mh - 20, "#8fa9b6", 9.5);
    tx(`${nodes.length} positioned · ${noFix.length} no fix`, width - 16, height - 22, "#6f97a8", 10, RIGHT);
    tx("passive · read-only", 16, height - 22, "#4b93b0", 10);
  }
  function niceStep(span) { const raw = span / 5, p = Math.pow(10, Math.floor(Math.log10(raw))); const m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7 ? 5 : 10) * p; }
  function niceKm(v) { const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7 ? 5 : 10) * p; }
  return { draw, onWheel() {}, onClick() {} };
})();
