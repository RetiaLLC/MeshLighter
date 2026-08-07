/*
 * maptiles.js — a tiny slippy-map tile layer for the HUD map views. Web Mercator, dark
 * basemap tiles (CARTO dark_all) drawn straight onto the p5 canvas via drawingContext, with
 * an async image cache that folds into the p5 draw loop. Read-only: it only fetches imagery.
 *
 * Renders from a view {lon, lat, z} (integer zoom). draw() auto-fits a bbox when no view is
 * given; once the user scrolls/drags, callers keep a view and use zoomAt()/panBy(). Every
 * render returns proj (lat,lon -> screen) AND unproj (screen -> lat,lon) so markers land on
 * the basemap and the caller can zoom-to-cursor / pan.
 */
window.MapTiles = (function () {
  const TILE = 256, MIN_Z = 2, MAX_Z = 19;
  const cache = new Map();                 // "z/x/y" -> { img, ok, bad }
  const SUBS = ["a", "b", "c", "d"];
  const url = (z, x, y) => `https://${SUBS[(x + y) & 3]}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}${window.devicePixelRatio > 1.3 ? "@2x" : ""}.png`;
  const ATTRIB = "© OpenStreetMap · © CARTO";

  const lonToWX = (lon, z) => (lon + 180) / 360 * TILE * Math.pow(2, z);
  const latToWY = (lat, z) => {
    const s = Math.max(-0.9999, Math.min(0.9999, Math.sin(lat * Math.PI / 180)));
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * Math.pow(2, z);
  };
  const wxToLon = (wx, z) => wx / (TILE * Math.pow(2, z)) * 360 - 180;
  const wyToLat = (wy, z) => { const n = Math.PI - 2 * Math.PI * wy / (TILE * Math.pow(2, z)); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
  const clampZ = (z) => Math.max(MIN_Z, Math.min(MAX_Z, Math.round(z)));

  function pickZoom(b, w, h) {
    for (let z = MAX_Z; z >= MIN_Z; z--) {
      const dx = lonToWX(b.maxLon, z) - lonToWX(b.minLon, z);
      const dy = latToWY(b.minLat, z) - latToWY(b.maxLat, z);
      if (dx <= w && dy <= h) return z;
    }
    return MIN_Z;
  }

  function tile(z, x, y) {
    const key = z + "/" + x + "/" + y;
    let e = cache.get(key);
    if (!e) {
      e = { img: new Image(), ok: false, bad: false };   // no crossOrigin: taint is fine, we never read pixels
      e.img.onload = () => { e.ok = true; };
      e.img.onerror = () => { e.bad = true; };
      e.img.src = url(z, x, y);
      cache.set(key, e);
    }
    return e;
  }

  // Draw the basemap centered on (lon,lat) at integer zoom z into rect. Returns proj/unproj.
  function render(ctx, lon, lat, z, rect) {
    z = clampZ(z);
    const cwx = lonToWX(lon, z), cwy = latToWY(lat, z);
    const ox = rect.x + rect.w / 2 - cwx, oy = rect.y + rect.h / 2 - cwy;
    const proj = (la, lo) => ({ x: ox + lonToWX(lo, z), y: oy + latToWY(la, z) });
    const unproj = (sx, sy) => ({ lon: wxToLon(sx - ox, z), lat: wyToLat(sy - oy, z) });
    const n = Math.pow(2, z);
    const x0 = Math.floor((cwx - rect.w / 2) / TILE), x1 = Math.floor((cwx + rect.w / 2) / TILE);
    const y0 = Math.floor((cwy - rect.h / 2) / TILE), y1 = Math.floor((cwy + rect.h / 2) / TILE);
    let loaded = 0;
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        if (ty < 0 || ty >= n) continue;
        const wx = ((tx % n) + n) % n;
        const e = tile(z, wx, ty);
        if (!e.ok) continue;
        try { ctx.drawImage(e.img, ox + tx * TILE, oy + ty * TILE, TILE, TILE); loaded++; } catch {}
      }
    }
    return { proj, unproj, z, lon, lat, loaded };
  }

  // Render at an explicit view, else auto-fit the bbox.
  function draw(ctx, b, rect, view) {
    if (view && view.z != null) return render(ctx, view.lon, view.lat, view.z, rect);
    return render(ctx, (b.minLon + b.maxLon) / 2, (b.minLat + b.maxLat) / 2, pickZoom(b, rect.w, rect.h), rect);
  }

  function fitView(b, rect) { return { lon: (b.minLon + b.maxLon) / 2, lat: (b.minLat + b.maxLat) / 2, z: pickZoom(b, rect.w, rect.h) }; }

  // Zoom by dz while keeping the geographic point under (mx,my) fixed on screen.
  function zoomAt(view, mx, my, rect, dz) {
    const z = clampZ(view.z);
    const ox = rect.x + rect.w / 2 - lonToWX(view.lon, z), oy = rect.y + rect.h / 2 - latToWY(view.lat, z);
    const lon = wxToLon(mx - ox, z), lat = wyToLat(my - oy, z);
    const nz = clampZ(z + dz);
    const ncwx = lonToWX(lon, nz) + (rect.x + rect.w / 2 - mx);
    const ncwy = latToWY(lat, nz) + (rect.y + rect.h / 2 - my);
    return { lon: wxToLon(ncwx, nz), lat: wyToLat(ncwy, nz), z: nz };
  }

  // Pan the view by a screen delta (drag).
  function panBy(view, dx, dy, rect) {
    const z = clampZ(view.z);
    return { lon: wxToLon(lonToWX(view.lon, z) - dx, z), lat: wyToLat(latToWY(view.lat, z) - dy, z), z };
  }

  return { draw, fitView, zoomAt, panBy, pickZoom, ATTRIB,
    mPerPx: (lat, z) => 156543.03 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z) };
})();
