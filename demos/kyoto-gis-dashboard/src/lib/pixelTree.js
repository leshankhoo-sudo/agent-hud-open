// One small pixel tree for the weather panels: the season decides the tree, the forecast decides how it
// moves (PixelTree.jsx draws it). Everything here is plain data so it can be tested without a browser.
// The idea of a tree of pixel leaves that the wind and the pointer can shake loose comes from FeralUI's
// "Pixel Play" (credited in Data & Sources); the trees, colours and code here are this project's own.
// Japanese touch: the leaves grow in rounded "cloud" pads, as on pruned garden trees (niwaki), and the
// colours are traditional ones (sakura-iro, wakatake, momiji, yamabuki, sumi for the bark).

export const CELL = 3;   // one pixel of the tree, in CSS pixels

export const SEASON_TREE = {
  spring: { name: 'cherry in blossom', leaves: ['#fdeef1', '#f8d3dc', '#f2b6c6', '#e897ad', '#d97a95'], pad: 1.0, density: 0.82 },
  summer: { name: 'green maple', leaves: ['#b9db94', '#8cc673', '#5ea55a', '#3e8549', '#2b6a3d'], pad: 1.05, density: 0.92 },
  autumn: { name: 'maple in autumn colour', leaves: ['#f9c95a', '#f5a03c', '#ea7036', '#d44a2f', '#a9322b'], pad: 0.95, density: 0.86 },
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

// Build the tree in a box of w x h CSS pixels: bark cells, leaf cells (with their colour and a height
// factor 0..1 used for the sway), and the ground line. Same season and seed, same tree. The tree is
// grown, measured and, if it does not fit, grown again a little smaller; then it is centred.
export function buildTree(season, w, h, seed = 7) {
  const S = SEASON_TREE[season] || SEASON_TREE.autumn;
  const cols = Math.floor(w / CELL), rows = Math.floor(h / CELL);
  const ground = rows - 3;
  const winter = season === 'winter';
  const grown = (scale) => {
    const R = rng(seed + season.length * 131);
    const bark = new Map(), tips = [];
    let top = ground;
    const put = (x, y, tone) => { const k = `${x},${y}`; if (!bark.has(k)) bark.set(k, { x, y, tone }); if (y < top) top = y; };
    const maxDepth = winter ? 4 : 3;
    // a trunk with a slight bend, then forking limbs; winter shows finer twigs
    const grow = (x, y, ang, len, th, depth) => {
      const steps = Math.max(2, Math.round(len));
      const curve = (R() - 0.5) * (depth === 0 ? 0.35 : 0.6);
      let cx = x, cy = y, a = ang;
      for (let i = 0; i < steps; i++) {
        a = Math.max(-Math.PI + 0.35, Math.min(-0.35, a + curve / steps));   // branches keep growing upwards
        cx += Math.cos(a); cy += Math.sin(a);
        const t = Math.max(1, Math.round(th * (1 - (i / steps) * 0.3)));
        for (let dx = -Math.floor((t - 1) / 2); dx <= Math.floor(t / 2); dx++) put(Math.round(cx) + dx, Math.round(cy), dx < 0 ? 1 : 0);
      }
      if (depth >= maxDepth || len < 2) { tips.push({ x: cx, y: cy, depth }); return; }
      const n = depth === 0 ? (R() < 0.5 ? 3 : 2) : R() < 0.25 ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const spread = depth === 0 ? 0.5 + R() * 0.3 : (winter ? 0.38 : 0.36) + R() * 0.26;
        const side = n === 2 ? (k ? 1 : -1) : (k - 1) * 1.1;
        grow(cx, cy, a + side * spread + (R() - 0.5) * 0.2, len * (0.64 + R() * 0.1), Math.max(1, th * 0.62), depth + 1);
      }
    };
    const x0 = cols / 2;
    grow(x0, ground, -Math.PI / 2 + (R() - 0.5) * 0.12, rows * (winter ? 0.3 : 0.34) * scale, Math.max(2, Math.round(cols / 16)), 0);
    const leaves = [];
    if (!winter) {
      // cloud pads round the branch tips: denser in the middle, ragged at the edge, lit from the upper left
      const taken = new Set();
      for (const tp of tips) {
        if (tp.depth < 2) continue;
        const rx = cols * (0.12 + R() * 0.05) * S.pad * scale, ry = rx * (0.68 + R() * 0.12);
        for (let y = Math.floor(tp.y - ry); y <= tp.y + ry; y++) for (let x = Math.floor(tp.x - rx); x <= tp.x + rx; x++) {
          const d = ((x - tp.x) / rx) ** 2 + ((y - tp.y) / ry) ** 2;
          if (d > 1 || R() > S.density * (1.15 - d * 0.5) || y >= ground - 1) continue;
          const k = `${x},${y}`;
          if (taken.has(k)) continue;
          taken.add(k);
          if (y < top) top = y;
          const light = ((tp.x - x) / rx + (tp.y - y) / ry) * 0.5;   // upper left is lighter
          leaves.push({ x, y, c: Math.max(0, Math.min(S.leaves.length - 1, Math.round((1 - light) * 1.6 + R() * 1.6))) });
        }
      }
    } else {
      // snow sits on top of the branches
      for (const b of bark.values()) if (!bark.has(`${b.x},${b.y - 1}`) && b.y < ground - 2 && R() < 0.62) { leaves.push({ x: b.x, y: b.y - 1, c: R() < 0.6 ? 0 : 1 }); if (b.y - 1 < top) top = b.y - 1; }
    }
    return { bark: [...bark.values()], leaves, top };
  };
  let g, scale = 1;
  for (let i = 0; i < 8; i++) {
    g = grown(scale);
    const xs = [...g.bark, ...g.leaves].map((c) => c.x);
    g.minX = Math.min(...xs); g.maxX = Math.max(...xs);
    if (g.maxX - g.minX + 1 <= cols - 2 && g.top >= 1) break;
    scale *= 0.9;
  }
  const shift = Math.round((cols - 1) / 2 - (g.minX + g.maxX) / 2);
  const inside = (c) => c.x + shift >= 0 && c.x + shift < cols && c.y >= 0;
  const span = Math.max(1, ground - g.top);
  const hf = (y) => Math.max(0, Math.min(1, (ground - y) / span));
  return {
    season, name: S.name, cols, rows, ground, palette: S.leaves,
    bark: g.bark.filter(inside).map((b) => ({ ...b, x: b.x + shift, h: hf(b.y) })),
    leaves: g.leaves.filter(inside).map((l, i) => ({ ...l, x: l.x + shift, h: hf(l.y), ph: (i * 2.399) % (Math.PI * 2) })),
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
