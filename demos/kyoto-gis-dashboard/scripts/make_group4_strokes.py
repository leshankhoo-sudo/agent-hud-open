# Make the handwriting data for the fog mirror on the back of the closing card: the outline of "Group 4" in
# Great Vibes (SIL Open Font License 1.1, Copyright 2015 The Great Vibes Pro Project Authors) and the pen strokes
# that write it, in writing order, with the stroke's half-width at each point.
#
# The outline is shaped with HarfBuzz (as a browser would) and taken from the font; the strokes are its centre
# lines: the outline is filled at high resolution, thinned to a one-pixel skeleton (Zhang-Suen), turned into a
# graph, short spurs are pruned, and the graph is walked the way a pen goes: from the left, straight on through
# crossings, lifting the pen only when a part is finished. The page draws a soft brush along the strokes and
# clips it to the outline, so the letters come out exactly as the font draws them, stroke by stroke.
#
# usage: python scripts/make_group4_strokes.py GreatVibes-Regular.ttf src/lib/group4.js [preview.png]
# needs: fonttools, uharfbuzz, numpy, scipy, Pillow (only to make the data; the site needs none of them)
import json, math, sys
import numpy as np
from scipy import ndimage
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

TEXT = 'Group 4'
FONT, OUT = sys.argv[1], sys.argv[2]
PREVIEW = sys.argv[3] if len(sys.argv) > 3 else None
SCALE = 0.9                # raster pixels per font unit
# the pen's path is written by hand where the automatic walk would write a letter in an odd order: none so far

# ---- shape and outline ----
font = TTFont(FONT)
gs = font.getGlyphSet()
order = font.getGlyphOrder()
hbfont = hb.Font(hb.Face(hb.Blob.from_file_path(FONT)))
buf = hb.Buffer(); buf.add_str(TEXT); buf.guess_segment_properties(); hb.shape(hbfont, buf, {})
placed = []   # (glyph name, x, y) in font units
x = 0
for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
    placed.append((order[info.codepoint], x + pos.x_offset, pos.y_offset)); x += pos.x_advance

class Flatten(BasePen):
    """Outline to polygons (curves sampled finely), in font units."""
    def __init__(self, glyphset):
        super().__init__(glyphset); self.contours = []; self.cur = None
    def _moveTo(self, p): self.cur = [p]
    def _lineTo(self, p): self.cur.append(p)
    def _curveToOne(self, p1, p2, p3):
        p0 = self.cur[-1]
        for i in range(1, 13):
            t = i / 12; a = (1 - t) ** 3; b = 3 * (1 - t) ** 2 * t; c = 3 * (1 - t) * t * t; d = t ** 3
            self.cur.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    def _qCurveToOne(self, p1, p2):
        p0 = self.cur[-1]
        for i in range(1, 9):
            t = i / 8; a = (1 - t) ** 2; b = 2 * (1 - t) * t; c = t * t
            self.cur.append((a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]))
    def _closePath(self):
        if self.cur and len(self.cur) > 2: self.contours.append(self.cur)
        self.cur = None
    _endPath = _closePath

svg = SVGPathPen(gs, ntos=lambda v: str(int(round(v))))
glyph_polys = []   # per glyph: list of contours (font units, y down)
for name, gx, gy in placed:
    if name == 'space': glyph_polys.append([]); continue
    gs[name].draw(TransformPen(svg, (1, 0, 0, -1, gx, -gy)))   # y flipped: down is positive, as on a canvas
    fl = Flatten(gs); gs[name].draw(fl)
    glyph_polys.append([[(px + gx, -(py + gy)) for px, py in c] for c in fl.contours])
path_d = svg.getCommands()
allpts = np.array([p for g in glyph_polys for c in g for p in c])
x0, y0 = allpts.min(0); x1, y1 = allpts.max(0)
pad = 12
W = int(math.ceil((x1 - x0) * SCALE)) + 2 * pad; H = int(math.ceil((y1 - y0) * SCALE)) + 2 * pad
to_px = lambda p: ((p[0] - x0) * SCALE + pad, (p[1] - y0) * SCALE + pad)
to_fu = lambda c, r: (c / SCALE + x0 - pad / SCALE, r / SCALE + y0 - pad / SCALE)   # col,row -> font units

# ---- fill (non-zero winding, as a canvas fills a path) ----
def fill(contours):
    acc = np.zeros((H, W + 1), np.int32)
    for c in contours:
        pts = [to_px(p) for p in c]
        for (ax, ay), (bx, by) in zip(pts, pts[1:] + pts[:1]):
            if ay == by: continue
            d = 1 if by > ay else -1
            lo, hi = (ay, by) if ay < by else (by, ay)
            rows = np.arange(math.ceil(lo - 0.5), math.ceil(hi - 0.5))
            if not len(rows): continue
            yc = rows + 0.5
            xc = ax + (yc - ay) * (bx - ax) / (by - ay)
            cols = np.clip(np.ceil(xc - 0.5).astype(int), 0, W)
            np.add.at(acc, (rows, cols), d)
    return np.cumsum(acc, 1)[:, :W] != 0
glyph_masks = [fill(g) if g else np.zeros((H, W), bool) for g in glyph_polys]
mask = np.logical_or.reduce(glyph_masks)

# ---- skeleton (Zhang-Suen) and half-widths ----
def thin(img):
    img = img.astype(np.uint8).copy()
    while True:
        changed = False
        for step in (0, 1):
            P = np.pad(img, 1)
            n = [P[:-2, 1:-1], P[:-2, 2:], P[1:-1, 2:], P[2:, 2:], P[2:, 1:-1], P[2:, :-2], P[1:-1, :-2], P[:-2, :-2]]   # p2..p9
            B = sum(n)
            A = sum(((n[k] == 0) & (n[(k + 1) % 8] == 1)).astype(np.uint8) for k in range(8))
            if step == 0: c = (n[0] * n[2] * n[4] == 0) & (n[2] * n[4] * n[6] == 0)
            else: c = (n[0] * n[2] * n[6] == 0) & (n[0] * n[4] * n[6] == 0)
            m = (img == 1) & (B >= 2) & (B <= 6) & (A == 1) & c
            if m.any(): img[m] = 0; changed = True
        if not changed: return img.astype(bool)
skel = thin(mask)
edt = ndimage.distance_transform_edt(mask)

# ---- graph: pixels -> nodes (ends, junctions) and edges (chains between them) ----
pix = set(zip(*np.nonzero(skel)))
N8 = [(-1, 0), (0, 1), (1, 0), (0, -1), (-1, 1), (1, 1), (1, -1), (-1, -1)]
def nbrs(p):
    r, c = p
    orth = [(r + dr, c + dc) for dr, dc in N8[:4] if (r + dr, c + dc) in pix]
    out = list(orth)
    for dr, dc in N8[4:]:
        q = (r + dr, c + dc)
        if q in pix and (r + dr, c) not in pix and (r, c + dc) not in pix: out.append(q)   # a diagonal step only where no corner pixel joins them
    return out
adj = {p: nbrs(p) for p in pix}
adj = {p: [q for q in v if p in adj.get(q, [])] for p, v in adj.items()}
deg = {p: len(v) for p, v in adj.items()}
nodes_px = {p for p, d in deg.items() if d != 2}
# junction pixels next to each other are one node
cluster = {}
for p in nodes_px:
    if p in cluster or deg[p] < 3: continue
    stack = [p]; cluster[p] = p
    while stack:
        q = stack.pop()
        for s in adj[q]:
            if s in nodes_px and deg[s] >= 3 and s not in cluster: cluster[s] = p; stack.append(s)
for p in nodes_px:
    cluster.setdefault(p, p)
edges = []   # [a, b, [pixels]]
seen = set()
for p in nodes_px:
    for q in adj[p]:
        if cluster.get(q) == cluster[p] and q in nodes_px: continue
        if (p, q) in seen: continue
        chain = [p, q]; prev, cur = p, q
        while cur not in nodes_px:
            nxt = [s for s in adj[cur] if s != prev]
            if not nxt: break
            prev, cur = cur, nxt[0]; chain.append(cur)
        seen.add((p, q)); seen.add((chain[-1], chain[-2]))
        if cur in nodes_px: edges.append([cluster[p], cluster[cur], chain])
# closed loops with no node on them
left = pix - {q for e in edges for q in e[2]} - nodes_px
while left:
    p = min(left); chain = [p]; prev, cur = None, p
    while True:
        nxt = [s for s in adj[cur] if s != prev and s in left and s not in chain]
        if not nxt: break
        prev, cur = cur, nxt[0]; chain.append(cur)
    chain.append(p); left -= set(chain)
    if len(chain) > 8: cluster[p] = p; edges.append([p, p, chain])

def length(ch): return sum(math.dist(a, b) for a, b in zip(ch, ch[1:]))
# prune spurs: short branches that end in the open (skeleton whiskers at stroke ends and corners)
def node_deg():
    d = {}
    for a, b, _ in edges: d[a] = d.get(a, 0) + 1; d[b] = d.get(b, 0) + 1
    return d
for _ in range(4):
    d = node_deg(); keep = []
    for a, b, ch in edges:
        end = (d[a] == 1) != (d[b] == 1)
        hub = b if d[a] == 1 else a
        if end and length(ch) < max(10, 1.6 * edt[hub]): continue
        keep.append([a, b, ch])
    edges[:] = keep
    # join chains through nodes that now have two edges
    while True:
        d = node_deg(); joined = False
        for n, k in d.items():
            if k != 2: continue
            es = [e for e in edges if e[0] == n or e[1] == n]
            if len(es) != 2 or es[0] is es[1]: continue
            e1, e2 = es
            c1 = e1[2] if e1[1] == n else e1[2][::-1]; s1 = e1[0] if e1[1] == n else e1[1]
            c2 = e2[2] if e2[0] == n else e2[2][::-1]; s2 = e2[1] if e2[0] == n else e2[0]
            edges.remove(e1); edges.remove(e2); edges.append([s1, s2, c1 + c2[1:]]); joined = True; break
        if not joined: break

# ---- walk the graph as a pen would ----
def direction(ch, from_start=True, k=10):
    a, b = (ch[0], ch[min(k, len(ch) - 1)]) if from_start else (ch[max(0, len(ch) - 1 - k)], ch[-1])
    v = (b[1] - a[1], b[0] - a[0]); n = math.hypot(*v) or 1
    return (v[0] / n, v[1] / n)   # (dx, dy)
# components by shared nodes
parent = {}
def find(u):
    while parent.setdefault(u, u) != u: u = parent[u]
    return u
for a, b, _ in edges: parent[find(a)] = find(b)
comps = {}
for i, (a, b, ch) in enumerate(edges): comps.setdefault(find(a), []).append(i)
comps = sorted(comps.values(), key=lambda es: min(min(q[1] for q in edges[i][2]) for i in es))
strokes = []
for es in comps:
    todo = set(es)
    while todo:
        d = {}
        for i in todo:
            a, b, _ = edges[i]; d[a] = d.get(a, 0) + 1; d[b] = d.get(b, 0) + 1
        ends = [n for n, k in d.items() if k % 2 == 1] or list(d)
        start = min(ends, key=lambda n: (n[1], n[0]))   # the leftmost free end
        cur, heading, line = start, None, [start]
        while True:
            cands = [i for i in todo if cur in (edges[i][0], edges[i][1])]
            if not cands: break
            def oriented(i):   # the edge's pixels from this node on, and the node at its far end
                a, b, ch = edges[i]
                return (ch, b) if a == cur else (ch[::-1], a)
            if heading is None: best = min(cands, key=lambda i: min(q[1] for q in edges[i][2]))
            else:
                best = max(cands, key=lambda i: (lambda v: v[0] * heading[0] + v[1] * heading[1])(direction(oriented(i)[0])))
            ch, nxt = oriented(best); todo.discard(best)
            line += ch[1:]; heading = direction(ch, False); cur = nxt
        strokes.append(line)

# ---- simplify, convert to font units, keep half-widths ----
def rdp(pts, eps):
    if len(pts) < 3: return pts
    a, b = np.array(pts[0], float), np.array(pts[-1], float); ab = b - a; L = np.hypot(*ab)
    P = np.array(pts, float)
    d = np.abs(ab[0] * (P[:, 1] - a[1]) - ab[1] * (P[:, 0] - a[0])) / L if L else np.hypot(*(P - a).T)
    i = int(np.argmax(d))
    if d[i] > eps: return rdp(pts[:i + 1], eps)[:-1] + rdp(pts[i:], eps)
    return [pts[0], pts[-1]]
out_strokes = []
for s in strokes:
    s2 = rdp(s, 1.2)
    pts = [list(to_fu(c, r)) + [float(edt[r, c]) / SCALE] for r, c in s2]
    # the skeleton stops short of a stroke's tip (and its whiskers were pruned): carry each end on a little
    for end in (0, -1):
        a, b = (pts[0], pts[min(1, len(pts) - 1)]) if end == 0 else (pts[-1], pts[max(-2, -len(pts))])
        dx, dy = a[0] - b[0], a[1] - b[1]; n = math.hypot(dx, dy)
        if n:
            tip = [a[0] + dx / n * a[2] * 1.1, a[1] + dy / n * a[2] * 1.1, a[2] * 0.8]
            if end == 0: pts.insert(0, tip)
            else: pts.append(tip)
    out_strokes.append([[int(round(v)) for v in q[:2]] + [round(q[2], 1)] for q in pts])

# drips: from the bottom of G, of u and of 4 (where water would gather), as stroke/point indices along the pen path
drips = []
for gi in (0, 3, 6):
    gm = glyph_masks[gi]
    rows, cols = np.nonzero(gm & skel)
    if not len(rows): continue
    k = int(np.argmax(rows)); tr, tc = rows[k], cols[k]
    best = min(((si, pi) for si, s in enumerate(out_strokes) for pi, _ in enumerate(s)), key=lambda t: math.dist(to_px(out_strokes[t[0]][t[1]][:2])[::-1], (tr, tc)))
    drips.append(list(best))

data = {'text': TEXT, 'box': [round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)], 'path': path_d, 'strokes': out_strokes, 'drips': drips}
with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
    f.write('// "Group 4" for the fog mirror on the back of the closing card. Made by scripts/make_group4_strokes.py from\n')
    f.write('// Great Vibes (Copyright 2015 The Great Vibes Pro Project Authors, https://github.com/googlefonts/great-vibes;\n')
    f.write('// SIL Open Font License 1.1, see public/licenses/GreatVibes-OFL.txt). Font units, y down.\n')
    f.write('// path: the letters\' outline. strokes: the pen strokes in writing order, [x, y, half-width] per point.\n')
    f.write('// drips: [stroke, point] where a drop starts to run once the pen has passed. Do not edit by hand.\n')
    f.write('export default ' + json.dumps(data, separators=(',', ':')) + ';\n')
print('strokes', len(out_strokes), 'points', sum(map(len, out_strokes)), 'edges', len(edges), 'size', W, H)

if PREVIEW:
    from PIL import Image, ImageDraw
    frames = []
    tot = sum(len(s) for s in strokes)
    cols8 = [(230, 80, 80), (80, 160, 230), (90, 190, 110), (230, 170, 60), (170, 100, 220), (60, 200, 200), (220, 110, 170), (140, 140, 140)]
    base = Image.fromarray((mask * 60).astype(np.uint8)).convert('RGB')
    for k in range(1, 9):
        lim = tot * k / 8; im = base.copy(); dr = ImageDraw.Draw(im); n = 0
        for si, s in enumerate(strokes):
            for (r, c) in s:
                if n > lim: break
                rr = edt[r, c] * 1.15; dr.ellipse([c - rr, r - rr, c + rr, r + rr], fill=cols8[si % 8]); n += 1
        a = np.array(im); a[~mask] = (a[~mask] * 0.25).astype(np.uint8)   # clip to the letters
        frames.append(Image.fromarray(a))
    sk = base.copy(); dr = ImageDraw.Draw(sk)
    for si, s in enumerate(strokes):
        dr.line([(c, r) for r, c in s], fill=cols8[si % 8], width=3)
        r, c = s[0]; dr.ellipse([c - 7, r - 7, c + 7, r + 7], outline=(255, 255, 255), width=2); dr.text((c + 8, r - 8), str(si + 1), fill=(255, 255, 255))
    frames.append(sk)
    w, h = frames[0].size
    sheet = Image.new('RGB', (w * 3, h * 3), (0, 0, 0))
    for i, fr in enumerate(frames): sheet.paste(fr, ((i % 3) * w, (i // 3) * h))
    sheet.save(PREVIEW)
