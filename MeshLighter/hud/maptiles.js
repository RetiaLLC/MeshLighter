/*
 * maptiles.js — a tiny slippy-map tile layer for the HUD map views. Web Mercator,
 * dark basemap tiles (CARTO dark_all) drawn straight onto the p5 canvas via drawingContext,
 * with an async image cache that folds naturally into the p5 draw loop. Read-only: it only
 * fetches map imagery. Degrades to a bare graticule when tiles can't load (offline demo).
 *
 * MapTiles.draw(ctx, bbox, rect) fills the rect with tiles and returns a Web-Mercator
 * proj(lat,lon)->{x,y} so node markers land exactly on the basemap. Callers draw markers,
 * scale, and attribution on top.
 */
window.MapTiles = (function () {
  const TILE = 256, MIN_Z = 2, MAX_Z = 18;
  const cache = new Map();                 // "z/x/y" -> { img, ok, bad }
  // dark tiles that match the HUD; a/b/c/d subdomains spread the load. Attribution below.
  const SUBS = ["a", "b", "c", "d"];
  const url = (z, x, y) => `https://${SUBS[(x + y) & 3]}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}${window.devicePixelRatio > 1.3 ? "@2x" : ""}.png`;
  const ATTRIB = "© OpenStreetMap · © CARTO";

  const lonToWX = (lon, z) => (lon + 180) / 360 * TILE * Math.pow(2, z);
  const latToWY = (lat, z) => {
    const s = Math.max(-0.9999, Math.min(0.9999, Math.sin(lat * Math.PI / 180)));
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * Math.pow(2, z);
  };

  function pickZoom(b, w, h) {
    for (let z = MAX_Z; z >= MIN_Z; z--) {
      const dx = lonToWX(b.maxLon, z) - lonToWX(b.minLon, z);
      const dy = latToWY(b.minLat, z) - latToWY(b.maxLat, z);   // lat grows downward in Mercator
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

  // Draw the basemap into [rect.x,rect.y,rect.w,rect.h] (caller has already clipped).
  // Returns { proj, z, loaded } — loaded = number of tiles actually painted this frame.
  function draw(ctx, b, rect) {
    const midLon = (b.minLon + b.maxLon) / 2, midLat = (b.minLat + b.maxLat) / 2;
    const z = pickZoom(b, rect.w, rect.h);
    const cwx = lonToWX(midLon, z), cwy = latToWY(midLat, z);
    const ox = rect.x + rect.w / 2 - cwx, oy = rect.y + rect.h / 2 - cwy;   // world-px (0,0) in screen space
    const proj = (la, lo) => ({ x: ox + lonToWX(lo, z), y: oy + latToWY(la, z) });
    const n = Math.pow(2, z);
    const x0 = Math.floor((cwx - rect.w / 2) / TILE), x1 = Math.floor((cwx + rect.w / 2) / TILE);
    const y0 = Math.floor((cwy - rect.h / 2) / TILE), y1 = Math.floor((cwy + rect.h / 2) / TILE);
    let loaded = 0;
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        if (ty < 0 || ty >= n) continue;
        const wx = ((tx % n) + n) % n;                 // wrap longitude at the date line
        const e = tile(z, wx, ty);
        if (!e.ok) continue;
        try { ctx.drawImage(e.img, ox + tx * TILE, oy + ty * TILE, TILE, TILE); loaded++; } catch {}
      }
    }
    return { proj, z, loaded };
  }

  // Equirectangular fallback proj (used only when nothing has loaded), matching Mercator near the center.
  function flatProj(b, rect) {
    const midLon = (b.minLon + b.maxLon) / 2, midLat = (b.minLat + b.maxLat) / 2;
    const lonS = Math.cos(midLat * Math.PI / 180);
    const sLat = Math.max(1e-6, b.maxLat - b.minLat), sLon = Math.max(1e-6, (b.maxLon - b.minLon) * lonS);
    const scale = Math.min(rect.w / sLon, rect.h / sLat);
    return { proj: (la, lo) => ({ x: rect.x + rect.w / 2 + (lo - midLon) * lonS * scale, y: rect.y + rect.h / 2 - (la - midLat) * scale }), scale };
  }

  return { draw, pickZoom, flatProj, ATTRIB, mPerPx: (lat, z) => 156543.03 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z) };
})();
