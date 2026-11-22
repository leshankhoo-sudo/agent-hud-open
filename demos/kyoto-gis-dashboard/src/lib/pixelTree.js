// One small pixel tree for the weather panels: the season decides the tree, the forecast decides how it
// moves (PixelTree.jsx draws it). Everything here is plain data so it can be tested without a browser.
// The idea of a tree of pixel leaves that the wind and the pointer can shake loose comes from FeralUI's
// "Pixel Play" (credited in Data & Sources); the trees, colours and code here are this project's own.
// Japanese touch: the leaves grow in rounded "cloud" pads, as on pruned garden trees (niwaki), and the
// colours are traditional ones (sakura-iro, wakatake, momiji, yamabuki, sumi for the bark).

export const CELL = 2;   // one pixel of the tree, in CSS pixels

export const SEASON_TREE = {
  spring: { name: 'cherry in blossom', leaves: ['#fde9ef', '#f8c9d7', '#f0a6be', '#df7f9f', '#c25c80'], pad: 1.0, density: 0.82 },
  summer: { name: 'green maple', leaves: ['#a9d46a', '#7fbf4a', '#56a23a', '#3b8331', '#286628'], pad: 1.05, density: 0.92 },
  autumn: { name: 'maple in autumn colour', leaves: ['#fbd27a', '#f6ad45', '#ec8a2c', '#d8661f', '#ad4416'], pad: 0.95, density: 0.86 },
  winter: { name: 'bare tree with snow', leaves: ['#ffffff', '#eef3f8', '#dce5ee'], pad: 0, density: 0 },
};
export const BARK = { light: ['#3d2c25', '#58402f'], dark: ['#2b201b', '#4a3628'] };

export function rng(seed) {   // small deterministic generator (mulberry32)
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Meteorological wind direction is where the wind comes from (270 = from the west, blowing east).
// Returns the sideways push on screen: +1 blows to the right, -1 to the left.
export const windSide = (dirDeg) => (dirDeg == null ? 0 : -Math.sin((dirDeg * Math.PI) / 180));
// How hard the tree moves, 0..1.2, from the forecast wind in km/h (no value: 0, the tree stands still).
export const windStrength = (kmh) => (kmh == null ? 0 : Math.max(0, Math.min(1.2, kmh / 36)));

// Build the tree in a box of w x h CSS pixels, in the shape of the reference: a dark trunk that forks
// into limbs, and a full crown made of many small clumps of leaves (2-3 pixels each, one colour per
// clump), lighter on top and to the upper left, darker underneath, with the branches showing through
// in the lower part. Each clump is one "leaf" that moves, falls and grows back. Same season and seed,
// same tree; the crown is laid out inside the box, so nothing is scaled down or cut off.
const CROWN = {   // crown size as a share of the box, and how far it reaches down the trunk
  spring: { rx: 0.43, ry: 0.39, cy: 0.42, fill: 1.0 },
  summer: { rx: 0.45, ry: 0.37, cy: 0.45, fill: 1.15 },
  autumn: { rx: 0.46, ry: 0.38, cy: 0.43, fill: 1.05 },
  winter: { rx: 0.44, ry: 0.4, cy: 0.42, fill: 0 },
};
export function buildTree(season, w, h, seed = 7) {
  const S = SEASON_TREE[season] || SEASON_TREE.autumn, C = CROWN[season] || CROWN.autumn;
  const R = rng(seed + season.length * 131);
  const gauss = () => (R() + R() + R() - 1.5) / 1.5;
  const cols = Math.floor(w / CELL), rows = Math.floor(h / CELL);
  const ground = rows - 4, winter = season === 'winter';
  const cx = cols / 2, cy = rows * C.cy, rx = cols * C.rx, ry = rows * C.ry;
  const inBox = (x, y) => x >= 0 && x < cols && y >= 1 && y < ground;
  const bark = new Map();
  const put = (x, y, tone) => { x = Math.round(x); y = Math.round(y); if (inBox(x, y) || y === ground) bark.set(`${x},${y}`, { x, y, tone }); };
  const line = (x0, y0, x1, y1, t0, t1) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++) {
      const k = i / n, x = x0 + (x1 - x0) * k, y = y0 + (y1 - y0) * k, t = Math.max(1, Math.round(t0 + (t1 - t0) * k));
      for (let d = 0; d < t; d++) put(x - Math.floor(t / 2) + d, y, d === 0 ? 1 : 0);
    }
  };
  // trunk: from the ground to the fork, leaning a little
  const tw = Math.max(3, Math.round(cols / 15));
  const fx = cx + gauss() * cols * 0.03, fy = cy + ry * (winter ? 0.4 : 0.5);
  const bx = (cx + fx) / 2 + gauss() * 1.5, by = (ground + fy) / 2;   // a slight bend in the trunk
  line(cx, ground, bx, by, tw + 1, tw);
  line(bx, by, fx, fy, tw, Math.max(2, tw - 2));
  // limbs fan out upward from the fork to points round the crown; each forks once or twice more
  const anchors = [];
  const nLimbs = 4 + Math.floor(R() * 2);
  for (let i = 0; i < nLimbs; i++) {
    const a = -Math.PI / 2 + (i / (nLimbs - 1) - 0.5) * (winter ? 2.2 : 2.0) + gauss() * 0.12;
    const r = winter ? 0.5 + R() * 0.28 : 0.55 + R() * 0.35;
    const ex = cx + Math.cos(a) * rx * r, ey = cy + Math.sin(a) * ry * r * 1.1;
    const mx = (fx + ex) / 2 + gauss() * 2, my = (fy + ey) / 2 + gauss() * 2;
    line(fx, fy, mx, my, Math.max(1, tw - 2), Math.max(1, tw - 3));
    line(mx, my, ex, ey, Math.max(1, tw - 3), 1);
    anchors.push([ex, ey], [mx, my]);
    const subs = winter ? 3 : 2;
    for (let s = 0; s < subs; s++) {
      const sa = a + (R() - 0.5) * 1.6, sl = (winter ? 0.32 : 0.24) * rx * (0.6 + R() * 0.6);
      const sx = ex + Math.cos(sa) * sl, sy = ey + Math.sin(sa) * sl * 0.9 - (winter ? sl * 0.2 : 0);
      line(ex, ey, sx, sy, 1, 1);
      anchors.push([sx, sy]);
      if (winter) for (let q = 0; q < 2; q++) { const qa = sa + (R() - 0.5) * 1.2, ql = sl * 0.5; line(sx, sy, sx + Math.cos(qa) * ql, sy + Math.sin(qa) * ql, 1, 1); }
    }
  }
  const leaves = [];
  if (!winter) {
    // the crown: clumps scattered round the limb ends and through the envelope, densest at the top
    const taken = new Set();
    const target = Math.round(((Math.PI * rx * ry) / 4.2) * C.fill);
    let tries = 0;
    while (leaves.length < target && tries++ < target * 30) {
      const [ax, ay] = R() < 0.55 ? anchors[Math.floor(R() * anchors.length)] : [cx + gauss() * rx * 0.75, cy + gauss() * ry * 0.75];
      const x = Math.round(ax + gauss() * rx * 0.42), y = Math.round(ay + gauss() * ry * 0.42);
      const e = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (e > 1 + (R() - 0.5) * 0.25 || !inBox(x, y)) continue;
      const low = (y - cy) / ry;                                   // -1 top .. +1 bottom
      if (low > 0.35 && R() < (low - 0.35) * 1.4) continue;        // thinner below, so the branches show
      const k = `${x},${y}`;
      if (taken.has(k)) continue;
      const cw = R() < 0.5 ? 2 : R() < 0.5 ? 3 : 1, ch = R() < 0.6 ? 2 : 1;
      for (let i = 0; i < cw; i++) for (let j = 0; j < ch; j++) taken.add(`${x + i},${y + j}`);
      // light from the upper left; darker underneath and on the right; a little noise for the mottled look
      const inner = Math.max(0, 1 - Math.hypot((x - cx) / rx, (y - cy - ry * 0.25) / ry)) * 0.35;   // shade near the middle of the crown
      const light = -0.7 * low - 0.35 * ((x - cx) / rx) - inner + gauss() * 0.7;
      const ci = Math.max(0, Math.min(S.leaves.length - 1, Math.round((1 - light) * (S.leaves.length - 1) / 2)));
      leaves.push({ x, y, w: cw, ht: ch, c: ci });
    }
  } else {
    // snow on top of the branches
    for (const b of bark.values()) if (!bark.has(`${b.x},${b.y - 1}`) && b.y < ground - 3 && R() < 0.75) leaves.push({ x: b.x, y: b.y - 1, w: 1, ht: 1, c: R() < 0.6 ? 0 : 1 });
  }
  // fallen leaves already lying under the tree in spring and autumn
  const fallen = [];
  if (season === 'spring' || season === 'autumn') for (let i = 0; i < Math.round(cols * 0.6); i++) fallen.push({ x: (cx + gauss() * rx * 0.8) * CELL, c: Math.floor(R() * S.leaves.length) });
  const top = Math.min(...[...bark.values(), ...leaves].map((c) => c.y));
  const span = Math.max(1, ground - top);
  const hf = (y) => Math.max(0, Math.min(1, (ground - y) / span));
  return {
    season, name: S.name, cols, rows, ground, palette: S.leaves, fallen,
    bark: [...bark.values()].map((b) => ({ ...b, h: hf(b.y) })),
    leaves: leaves.map((l, i) => ({ ...l, h: hf(l.y), ph: (i * 2.399) % (Math.PI * 2) })),
  };
}

// What the weather adds around the tree, from the forecast code and amounts (WMO codes, Open-Meteo).
export function weatherFx(code, precipMm) {
  const c = code ?? -1;
  const snow = [71, 73, 75, 77, 85, 86].includes(c);
  const rain = !snow && ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95);
  const amount = precipMm == null ? (rain || snow ? 0.4 : 0) : precipMm;
  return { rain, snow, storm: c >= 95, fog: c === 45 || c === 48, drops: rain || snow ? Math.round(Math.min(90, 14 + amount * 30)) : 0 };
}
