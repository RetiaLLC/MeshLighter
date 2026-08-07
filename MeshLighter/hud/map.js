/*
 * map.js — the full-screen Map view. Plots every node that has shared a Position (portnum 3)
 * on a dark web-map basemap (MapTiles), with role colours, labels, altitude, and observed
 * links. Scroll to zoom, drag to pan; a fit button returns to auto-fit. Falls back to a bare
 * graticule when tiles can't load (offline demo). Read-only. Reads window.MeshModel.
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
  let view = null, mrect = null, mbbox = null, fitBtn = null, press = null;
  const inMap = (mx, my) => mrect && mx > mrect.x && mx < mrect.x + mrect.w && my > mrect.y && my < mrect.y + mrect.h;

  function draw() {
    background(4, 7, 11);
    const m = F(); m.prune();
    tx("MESHLIGHTER", 16, 14, "#33e1ff", 14); tx("// map", 132, 18, "#4b7183", 11);
    const nodes = [...m.nodes.values()].filter((n) => n.lat != null && n.lon != null);
    const noFix = [...m.nodes.values()].filter((n) => n.lat == null);
    const mx = 60, my = 64, mw = width - 120, mh = height - 150;
    const box = { x: mx, y: my, w: mw, h: mh }; mrect = box;

    push(); drawingContext.save(); drawingContext.beginPath(); drawingContext.rect(mx, my, mw, mh); drawingContext.clip();
    noStroke(); fill(6, 12, 18); rect(mx, my, mw, mh);
    if (!nodes.length) {
      drawingContext.restore(); pop(); mbbox = null; fitBtn = null;
      stroke("#123244"); strokeWeight(1); noFill(); rect(mx, my, mw, mh);
      tx("No positioned nodes yet.", width / 2, height / 2 - 20, "#8fa9b6", 15, CENTER);
      tx("Waiting for Position packets (portnum 3). In Demo Mode the mesh carries GPS.", width / 2, height / 2 + 6, "#4b7183", 12, CENTER);
      return;
    }
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const n of nodes) { minLat = Math.min(minLat, n.lat); maxLat = Math.max(maxLat, n.lat); minLon = Math.min(minLon, n.lon); maxLon = Math.max(maxLon, n.lon); }
    const padLat = (maxLat - minLat) * 0.3 + 0.0016, padLon = (maxLon - minLon) * 0.3 + 0.0016;
    const bbox = { minLat: minLat - padLat, maxLat: maxLat + padLat, minLon: minLon - padLon, maxLon: maxLon + padLon };
    mbbox = bbox;
    const tiles = window.MapTiles.draw(drawingContext, bbox, box, view);
    const proj = tiles.proj;
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
    const mpp = window.MapTiles.mPerPx(tiles.lat, tiles.z);               // meters per logical px
    const barKm = niceKm(mpp * 120 / 1000), barPx = barKm * 1000 / mpp;
    stroke("#8fa9b6"); strokeWeight(2); line(mx + 12, my + mh - 14, mx + 12 + barPx, my + mh - 14);
    tx((barKm >= 1 ? barKm + " km" : (barKm * 1000) + " m") + "  ·  z" + tiles.z, mx + 16 + barPx, my + mh - 20, "#8fa9b6", 9.5);
    tx(window.MapTiles.ATTRIB, mx + 12, my + 6, "#5b8497", 9);
    tx(`${nodes.length} positioned · ${noFix.length} no fix`, width - 16, height - 22, "#6f97a8", 10, RIGHT);
    tx("scroll to zoom · drag to pan · passive · read-only", 16, height - 22, "#4b93b0", 10);
    if (view) {   // manual view: fit-reset button top-right of the map
      const bw = 52, bh = 18, bx = mx + mw - bw - 8, by = my + 6;
      noStroke(); fill(6, 14, 20, 235); rect(bx, by, bw, bh, 4); stroke("#37454c"); strokeWeight(1); noFill(); rect(bx, by, bw, bh, 4);
      tx("⟲ fit", bx + 10, by + 4, "#33e1ff", 10); fitBtn = { x: bx, y: by, w: bw, h: bh };
    } else fitBtn = null;
  }

  function onWheel(dy, mx, my) {
    if (!inMap(mx, my)) return;
    if (!view && mbbox) view = window.MapTiles.fitView(mbbox, mrect);
    if (view) view = window.MapTiles.zoomAt(view, mx, my, mrect, dy < 0 ? 1 : -1);
  }
  function onPress(mx, my) { press = { mx, my, moved: false, onMap: inMap(mx, my), onFit: fitBtn && mx > fitBtn.x && mx < fitBtn.x + fitBtn.w && my > fitBtn.y && my < fitBtn.y + fitBtn.h }; }
  function onDrag(mx, my, dx, dy) {
    if (!press) return;
    if (Math.abs(mx - press.mx) + Math.abs(my - press.my) > 3) press.moved = true;
    if (press.onMap && press.moved) {
      if (!view && mbbox) view = window.MapTiles.fitView(mbbox, mrect);
      if (view) view = window.MapTiles.panBy(view, dx, dy, mrect);
    }
  }
  function onRelease() { if (press && press.onFit && !press.moved) view = null; press = null; }
  function onMove(mx, my) { return inMap(mx, my) ? "grab" : "default"; }
  return { draw, onWheel, onPress, onDrag, onRelease, onMove, onClick() {} };
})();
