# SVG shape — INJECTION (tick "I am authorized to transmit" first).
# Draw a shape on the mesh map: sample points along an SVG outline, place them around a
# center location, and inject a positioned node at each point. Leave PREVIEW = True to see
# an ASCII preview (and the point count) without transmitting. Set it False to paint for real.
#
# Watch it land in the visualizer's Map view (meshlighter.site -> Map).
from device import dev
import mesh, math, re

# ---- edit these ----------------------------------------------------------------
CENTER  = (34.0522, -118.2437)   # (lat, lon) the shape centers on — downtown LA here
SCALE_M = 800                    # width of the shape on the ground, in meters
POINTS  = 28                     # nodes placed along the outline
PREVIEW = True                   # True = ASCII preview only; False = inject the nodes
LABEL   = False                  # also send a NodeInfo name per point (doubles airtime)

# Any simple SVG. Supports <polygon>/<polyline points=...>, <path d=...> (M L H V C S Q T Z),
# <line>, <rect>, <circle>, <ellipse>. Replace with your own.
SVG = """
<svg viewBox="0 0 100 100">
  <polygon points="50,3 61,38 98,38 68,59 79,95 50,72 21,95 32,59 2,38 39,38"/>
</svg>
"""
# --------------------------------------------------------------------------------

# ---- tiny SVG reader: returns a list of polylines (each a list of (x,y)) --------
def _nums(s): return [float(x) for x in re.findall(r'-?\d*\.?\d+(?:e-?\d+)?', s)]

def _bezier(p, steps=14):
    # p = [(x0,y0),(c1),(c2),(x1,y1)] cubic, or [(x0),(c),(x1)] quadratic
    out = []
    for i in range(1, steps + 1):
        t = i / steps; u = 1 - t
        if len(p) == 4:
            x = u*u*u*p[0][0] + 3*u*u*t*p[1][0] + 3*u*t*t*p[2][0] + t*t*t*p[3][0]
            y = u*u*u*p[0][1] + 3*u*u*t*p[1][1] + 3*u*t*t*p[2][1] + t*t*t*p[3][1]
        else:
            x = u*u*p[0][0] + 2*u*t*p[1][0] + t*t*p[2][0]
            y = u*u*p[0][1] + 2*u*t*p[1][1] + t*t*p[2][1]
        out.append((x, y))
    return out

def _path(d):
    toks = re.findall(r'[MmLlHhVvCcSsQqTtZzAa]|-?\d*\.?\d+(?:e-?\d+)?', d)
    polys, cur, i = [], [], 0
    x = y = sx = sy = 0.0; cmd = None; pc1 = pc2 = None
    def take(n):
        nonlocal i
        v = [float(t) for t in toks[i:i+n]]; i += n; return v
    while i < len(toks):
        t = toks[i]
        if re.match(r'[A-Za-z]', t): cmd = t; i += 1
        rel = cmd.islower(); C = cmd.upper()
        if C == 'M':
            vx, vy = take(2)
            x, y = (x+vx, y+vy) if rel else (vx, vy)
            if cur: polys.append(cur)
            cur = [(x, y)]; sx, sy = x, y; cmd = 'l' if rel else 'L'
        elif C == 'L':
            vx, vy = take(2); x, y = (x+vx, y+vy) if rel else (vx, vy); cur.append((x, y))
        elif C == 'H':
            vx = take(1)[0]; x = x+vx if rel else vx; cur.append((x, y))
        elif C == 'V':
            vy = take(1)[0]; y = y+vy if rel else vy; cur.append((x, y))
        elif C == 'C':
            v = take(6); c1 = (x+v[0], y+v[1]) if rel else (v[0], v[1]); c2 = (x+v[2], y+v[3]) if rel else (v[2], v[3])
            ex, ey = (x+v[4], y+v[5]) if rel else (v[4], v[5])
            cur += _bezier([(x, y), c1, c2, (ex, ey)]); pc2 = c2; x, y = ex, ey
        elif C == 'S':
            v = take(4); c1 = (2*x - pc2[0], 2*y - pc2[1]) if pc2 else (x, y); c2 = (x+v[0], y+v[1]) if rel else (v[0], v[1])
            ex, ey = (x+v[2], y+v[3]) if rel else (v[2], v[3])
            cur += _bezier([(x, y), c1, c2, (ex, ey)]); pc2 = c2; x, y = ex, ey
        elif C == 'Q':
            v = take(4); c = (x+v[0], y+v[1]) if rel else (v[0], v[1]); ex, ey = (x+v[2], y+v[3]) if rel else (v[2], v[3])
            cur += _bezier([(x, y), c, (ex, ey)]); pc1 = c; x, y = ex, ey
        elif C == 'T':
            v = take(2); c = (2*x - pc1[0], 2*y - pc1[1]) if pc1 else (x, y); ex, ey = (x+v[0], y+v[1]) if rel else (v[0], v[1])
            cur += _bezier([(x, y), c, (ex, ey)]); pc1 = c; x, y = ex, ey
        elif C == 'A':
            v = take(7); ex, ey = (x+v[5], y+v[6]) if rel else (v[5], v[6]); cur.append((ex, ey)); x, y = ex, ey  # arc -> chord
        elif C == 'Z':
            cur.append((sx, sy)); polys.append(cur); cur = []
        else:
            i += 1
        if C not in ('C', 'S', 'Q', 'T'): pc1 = pc2 = None
    if cur: polys.append(cur)
    return polys

def parse_svg(svg):
    polys = []
    for pts in re.findall(r'<(?:polygon|polyline)[^>]*\bpoints\s*=\s*"([^"]+)"', svg):
        n = _nums(pts); poly = list(zip(n[0::2], n[1::2]))
        if '<polygon' in svg and poly: poly = poly + [poly[0]]
        polys.append(poly)
    for d in re.findall(r'<path[^>]*\bd\s*=\s*"([^"]+)"', svg): polys += _path(d)
    for L in re.findall(r'<line\b[^>]*>', svg):
        a = {k: float(v) for k, v in re.findall(r'(x1|y1|x2|y2)\s*=\s*"([^"]+)"', L)}
        if len(a) == 4: polys.append([(a['x1'], a['y1']), (a['x2'], a['y2'])])
    for R in re.findall(r'<rect\b[^>]*>', svg):
        a = {k: float(v) for k, v in re.findall(r'(x|y|width|height)\s*=\s*"([^"]+)"', R)}
        if {'width', 'height'} <= a.keys():
            X, Y, W, H = a.get('x', 0), a.get('y', 0), a['width'], a['height']
            polys.append([(X, Y), (X+W, Y), (X+W, Y+H), (X, Y+H), (X, Y)])
    for C in re.findall(r'<(?:circle|ellipse)\b[^>]*>', svg):
        a = {k: float(v) for k, v in re.findall(r'(cx|cy|\br\b|rx|ry)\s*=\s*"([^"]+)"', C)}
        cx, cy = a.get('cx', 0), a.get('cy', 0); rx = a.get('rx', a.get('r', 0)); ry = a.get('ry', a.get('r', 0))
        if rx and ry: polys.append([(cx + rx*math.cos(k/40*2*math.pi), cy + ry*math.sin(k/40*2*math.pi)) for k in range(41)])
    return [p for p in polys if len(p) >= 2]

# ---- sample POINTS points evenly along the combined outline --------------------
def sample(polys, n):
    segs = []  # (x0,y0,x1,y1,len)
    for poly in polys:
        for (x0, y0), (x1, y1) in zip(poly, poly[1:]):
            L = math.hypot(x1-x0, y1-y0)
            if L > 0: segs.append((x0, y0, x1, y1, L))
    total = sum(s[4] for s in segs)
    if not total: return []
    out, step, dist, si, acc = [], total/n, 0.0, 0, 0.0
    for k in range(n):
        target = k*step
        while si < len(segs)-1 and acc + segs[si][4] < target: acc += segs[si][4]; si += 1
        x0, y0, x1, y1, L = segs[si]; f = (target-acc)/L if L else 0
        out.append((x0 + (x1-x0)*f, y0 + (y1-y0)*f))
    return out

# ---- map SVG coords -> lat/lon around CENTER (SVG y is down, north is up) -------
def to_geo(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    cx, cy = (min(xs)+max(xs))/2, (min(ys)+max(ys))/2
    span = max(max(xs)-min(xs), max(ys)-min(ys)) or 1.0
    lat0, lon0 = CENTER; mlat = math.cos(lat0*math.pi/180)
    geo = []
    for x, y in pts:
        east = (x-cx)/span * SCALE_M; north = -(y-cy)/span * SCALE_M
        geo.append((lat0 + north/111320.0, lon0 + east/(111320.0*mlat)))
    return geo

def preview(pts, w=46, h=23):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    sx = (w-1)/((maxx-minx) or 1); sy = (h-1)/((maxy-miny) or 1); s = min(sx, sy)
    grid = [[' ']*w for _ in range(h)]
    for x, y in pts:
        gx = int((x-minx)*s); gy = int((y-miny)*s)
        if 0 <= gy < h and 0 <= gx < w: grid[gy][gx] = '#'
    grid[h//2][w//2] = '+' if grid[h//2][w//2] == ' ' else grid[h//2][w//2]
    print('  +' + '-'*w + '+')
    for row in grid: print('  |' + ''.join(row) + '|')
    print('  +' + '-'*w + '+   (+ = center location)')

# ---- run -----------------------------------------------------------------------
polys = parse_svg(SVG)
pts = sample(polys, POINTS)
if not pts:
    print('No drawable geometry found in SVG. Use <polygon>/<polyline points=...> or <path d=...>.')
else:
    print(f'{len(polys)} subpath(s), {len(pts)} points, {SCALE_M} m across, centered on {CENTER[0]:.4f},{CENTER[1]:.4f}')
    preview(pts)
    if PREVIEW:
        print('\nPREVIEW only. Set PREVIEW = False to inject these as positioned nodes.')
    else:
        dev.connect()
        geo = to_geo(pts)
        base = 0x5A5E0000                        # "shape" node-id base
        for i, (lat, lon) in enumerate(geo):
            nid = base + i
            if LABEL: dev.send_nodeinfo(nid, 'shape %02d' % i, 'S%02d' % i)
            ok = dev.send_position(nid, lat, lon, 120)
            print('  node %2d/%d  %s  %.5f, %.5f  ack=%s' % (i+1, len(geo), hex(nid), lat, lon, ok))
            dev.sleep(0.35)
        print(f'Shape painted: {len(geo)} nodes. Open the visualizer Map to see it.')
