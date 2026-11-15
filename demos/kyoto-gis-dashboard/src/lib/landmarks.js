// Landmark symbols for the map, in three levels.
//   1  iconic places: their own silhouette (ink on a vermilion sun, a ground line under it), drawn here
//      for this project from each building's best-known outline; not copied from any map product
//   2  major places: one family of round washi plates with an ink glyph per category
//   3  everything else: the small category dots the map already had
// Which level a record gets comes from the data, never from guessing at its name:
//   level 1 = the record IDs listed in ICONIC (checked by hand against the dataset);
//   level 2 = records that have a verified Wikidata item or a verified photo, and castles;
//   level 3 = the rest. Hidden symbols never remove a record: its dot, search and click stay.
// Every symbol is painted once per theme on a canvas and handed to the map as an image, so the map
// draws hundreds of markers from a handful of cached bitmaps (no DOM node or SVG per place).

// record ID -> symbol. rank: lower wins when symbols would overlap at low zoom.
export const ICONIC = {
  A00265: { icon: 'kinkaku', rank: 1, what: 'Kinkaku: the three-storey Golden Pavilion' },
  A00560: { icon: 'kiyomizu', rank: 2, what: 'Kiyomizu-dera: the main hall on its wooden stage' },
  A00306: { icon: 'inari', rank: 3, what: 'Fushimi Inari Taisha: rows of torii' },
  A00579: { icon: 'nijo', rank: 4, what: 'Nijō Castle: corner turret on the stone wall' },
  A00564: { icon: 'toji', rank: 5, what: 'Tō-ji: the five-storey pagoda' },
  A00540: { icon: 'ginkaku', rank: 6, what: 'Ginkaku-ji: the two-storey Silver Pavilion' },
  A00182: { icon: 'byodoin', rank: 7, what: 'Byōdō-in: the Phoenix Hall and its wings' },
  A00563: { icon: 'nanzen', rank: 8, what: 'Nanzen-ji: the Sanmon gate' },
  A00011: { icon: 'amanohashidate', rank: 9, what: 'Amanohashidate: the pine-covered sandbar' },
  A00014: { icon: 'fukuchiyama', rank: 10, what: 'Fukuchiyama Castle: the keep' },
  A00582: { icon: 'heian', rank: 11, what: 'Heian Jingū: the Ōtenmon gate with its corridors' },
  A00559: { icon: 'yasaka', rank: 12, what: 'Yasaka Shrine: the west tower gate above the steps' },
  A00553: { icon: 'sanjusangendo', rank: 13, what: 'Sanjūsangen-dō: the long hall' },
  A00566: { icon: 'hokanji', rank: 14, what: 'Hōkan-ji: Yasaka Pagoda over the townhouse roofs' },
  A00074: { icon: 'tower', rank: 15, what: 'Kyoto Tower' },
};
export const CAT_ICONS = ['temple', 'shrine', 'castle', 'garden', 'museum', 'viewpoint', 'attraction'];

// Adds lm_tier (1-3), lm_icon, lm_rank and lm_cat to every attraction (new fields; nothing else changes).
export function applyLandmarks(data) {
  const photos = data?.photos?.photos || {};
  for (const f of data?.attractions?.features || []) {
    const p = f.properties;
    const ic = ICONIC[p.id];
    const major = !!p.wikidata || !!photos[p.id] || p.category === 'castle';
    p.lm_tier = ic ? 1 : major ? 2 : 3;
    p.lm_cat = 'cat-' + (CAT_ICONS.includes(p.category) ? p.category : 'attraction');
    p.lm_icon = ic ? 'lm-' + ic.icon : p.lm_cat;
    // overlap order: iconic by rank, then major places with a verified item, then the rest
    p.lm_rank = ic ? ic.rank : major ? (p.wikidata ? 100 : 200) : 900;
  }
  return data;
}

// ---------- drawing ----------
const L = 112, C = 64;   // canvas sizes (shown at half size: pixelRatio 2)
const PAL = {
  light: { ink: '#1f1b1a', halo: '#fbf6ec', disc: '#de4a33', gold: '#d9a441', paper: '#fbf6ec', plate: '#fbf6ec', plateInk: '#2a2622', rim: 'rgba(60,40,30,.28)' },
  dark: { ink: '#16131a', halo: '#f6efe2', disc: '#ff6348', gold: '#f0bd55', paper: '#f6efe2', plate: '#f4eee3', plateInk: '#221f1d', rim: 'rgba(0,0,0,.5)' },
};

// a hipped roof with upturned eaves: eave line at y (tips lifted), ridge at y - h
function roof(g, cx, y, hw, h, lift = 3, ridge = 0.32) {
  g.beginPath();
  g.moveTo(cx - hw, y - lift);
  g.quadraticCurveTo(cx, y + lift * 0.8, cx + hw, y - lift);
  g.quadraticCurveTo(cx + hw * 0.52, y - h * 0.42, cx + hw * ridge, y - h);
  g.lineTo(cx - hw * ridge, y - h);
  g.quadraticCurveTo(cx - hw * 0.52, y - h * 0.42, cx - hw, y - lift);
  g.closePath(); g.fill();
}
const box = (g, x, y, w, h) => g.fillRect(x, y, w, h);
const poly = (g, pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); };
const cut = (g, fn) => { g.save(); g.globalCompositeOperation = 'destination-out'; fn(); g.restore(); };
function torii(g, cx, base, w, h) {
  const top = base - h;
  g.beginPath();                                   // kasagi: the curved top beam
  g.moveTo(cx - w * 0.62, top); g.quadraticCurveTo(cx, top + h * 0.09, cx + w * 0.62, top);
  g.lineTo(cx + w * 0.56, top + h * 0.12); g.quadraticCurveTo(cx, top + h * 0.19, cx - w * 0.56, top + h * 0.12);
  g.closePath(); g.fill();
  box(g, cx - w * 0.5, top + h * 0.29, w, h * 0.075);   // nuki: the tie beam
  box(g, cx - w * 0.04, top + h * 0.16, w * 0.08, h * 0.14);
  box(g, cx - w * 0.38, top + h * 0.12, w * 0.1, h * 0.88); box(g, cx + w * 0.28, top + h * 0.12, w * 0.1, h * 0.88);
}
function pagoda(g, cx, base, hw0, step, tier, n = 5) {
  for (let i = 0; i < n; i++) {
    const b = base - i * tier, hw = hw0 - i * step;
    box(g, cx - hw * 0.44, b - tier * 0.55, hw * 0.88, tier * 0.55);
    roof(g, cx, b - tier * 0.5, hw, tier * 0.5, 2.4, 0.46);
  }
  const top = base - n * tier;
  box(g, cx - 0.9, top - 15, 1.8, 16);
  for (const dy of [4, 7, 10]) box(g, cx - 2.6, top - dy - 1, 5.2, 1.3);
}
const pine = (g, x, y, s = 1) => {
  box(g, x - 0.8 * s, y - 9 * s, 1.6 * s, 9 * s);
  for (const [dx, dy, rx, ry] of [[0, -11, 6, 2.6], [-3, -8, 5, 2.2], [3.5, -6.5, 4.5, 2]]) { g.beginPath(); g.ellipse(x + dx * s, y + dy * s, rx * s, ry * s, 0, 0, 7); g.fill(); }
};

// each landmark: (g = ink context, a = accent context, P = palette); the building stands on y = 84
const B = 84;
const DRAW = {
  kinkaku(g, a, P) {
    a.fillStyle = P.gold;
    box(a, 35, 70, 42, 13); box(a, 39, 57, 34, 9); box(a, 46, 45, 20, 8);
    box(g, 30, B - 1.6, 52, 1.6); box(g, 35, 76, 42, 1.2);
    roof(g, 56, 70, 30, 6, 3); roof(g, 56, 57, 25, 6, 3); roof(g, 56, 45, 17, 9, 3, 0.06);
    g.beginPath(); g.moveTo(56, 31); g.quadraticCurveTo(60, 32, 59, 36); g.lineTo(53, 36); g.quadraticCurveTo(52, 32, 56, 31); g.fill();   // the phoenix
    for (const x of [41, 48, 55, 62, 69]) box(g, x, 70, 1.2, 13);
  },
  ginkaku(g) {
    box(g, 35, 68, 42, 16); roof(g, 56, 68, 31, 7, 3);
    box(g, 43, 53, 26, 9); roof(g, 56, 53, 21, 12, 3, 0.06);
    box(g, 55.2, 34, 1.6, 8);
    cut(g, () => { box(g, 40, 73, 9, 9); box(g, 63, 73, 9, 9); g.beginPath(); g.arc(56, 59, 3, Math.PI, 0); g.lineTo(59, 62); g.lineTo(53, 62); g.fill(); });
  },
  kiyomizu(g) {
    roof(g, 56, 56, 37, 19, 4, 0.36); box(g, 27, 55, 58, 8); box(g, 19, 63, 74, 3);
    for (let x = 22; x <= 88; x += 8.2) box(g, x, 66, 2.3, 18);
    box(g, 20, 71.5, 72, 1.5); box(g, 20, 78, 72, 1.5);
    cut(g, () => { for (let x = 31; x <= 77; x += 9.2) box(g, x, 57.5, 5.5, 4); });
  },
  inari(g) { torii(g, 56, B, 24, 26); torii(g, 56, B, 40, 41); torii(g, 56, B, 58, 56); },
  nijo(g, a, P) {
    poly(g, [[14, B], [23, 68], [89, 68], [98, B]]);
    cut(g, () => { for (const [x, y, w] of [[24, 73, 14], [44, 73, 16], [66, 73, 15], [20, 78.5, 18], [43, 78.5, 13], [61, 78.5, 20], [84, 78.5, 9]]) box(g, x, y, w, 0.9); });
    a.fillStyle = P.paper; box(a, 37, 55, 38, 13); box(a, 44, 43, 24, 7);
    roof(g, 56, 55, 27, 6, 3); roof(g, 56, 43, 20, 9, 3, 0.2);
    box(g, 37, 62, 38, 6); for (const x of [43, 51, 59, 67]) box(g, x, 57.5, 2.4, 3);
  },
  toji(g) { pagoda(g, 56, B, 25, 3, 10.4); },
  hokanji(g) {
    pagoda(g, 56, B - 4, 17, 1.9, 10);
    roof(g, 24, B - 4, 15, 5, 2); box(g, 12, B - 4, 24, 4); roof(g, 89, B - 2, 14, 5, 2); box(g, 78, B - 2, 22, 2);
  },
  byodoin(g) {
    roof(g, 56, 61, 21, 12, 3, 0.4); box(g, 43, 61, 26, 23);
    for (const s of [-1, 1]) {
      roof(g, 56 + s * 30, 70, 17, 5, 2.4); for (let i = 0; i < 4; i++) box(g, 56 + s * (18 + i * 8) - 1, 70, 2, 14);
      roof(g, 56 + s * 41, 62, 7, 6, 2, 0.1); box(g, 56 + s * 41 - 3, 61, 6, 9);
      g.beginPath(); g.moveTo(56 + s * 8, 47); g.lineTo(56 + s * 11, 43.5); g.lineTo(56 + s * 6, 46); g.fill();   // the phoenixes on the ridge
    }
    box(g, 10, B - 1.2, 92, 1.2);
    cut(g, () => { g.beginPath(); g.arc(56, 69, 3.4, 0, 7); g.fill(); box(g, 51, 75, 10, 9); });
  },
  nanzen(g) {
    roof(g, 56, 50, 37, 15, 4, 0.42); box(g, 27, 49, 58, 9); box(g, 22, 58, 68, 2.4);
    roof(g, 56, 66, 39, 6, 3, 0.6); box(g, 24, 65, 64, 19);
    cut(g, () => { for (let i = 0; i < 5; i++) box(g, 27.5 + i * 12, 68, 9, 16); for (let i = 0; i < 5; i++) box(g, 30 + i * 11.4, 51.5, 6, 4.5); });
  },
  heian(g) {
    roof(g, 56, 51, 26, 11, 3, 0.4); box(g, 36, 50, 40, 8); roof(g, 56, 64, 31, 6, 3, 0.6); box(g, 32, 63, 48, 21);
    for (const s of [-1, 1]) { roof(g, 56 + s * 40, 72, 15, 4.5, 2); box(g, 56 + s * 40 - 12, 71, 24, 13); }
    cut(g, () => { for (const x of [36, 50.5, 65]) box(g, x, 68, 11, 16); for (const s of [-1, 1]) for (let i = 0; i < 3; i++) box(g, 56 + s * 40 - 10 + i * 7.4, 75, 5, 9); });
  },
  yasaka(g) {
    roof(g, 56, 47, 22, 10, 3, 0.35); box(g, 40, 46, 32, 7); box(g, 36, 53, 40, 2); roof(g, 56, 60, 26, 5.5, 3, 0.6); box(g, 39, 59, 34, 15);
    for (const s of [-1, 1]) { roof(g, 56 + s * 29, 66, 10, 4, 2); box(g, 56 + s * 29 - 8, 65, 16, 9); }
    poly(g, [[30, 74], [82, 74], [92, B], [20, B]]);
    cut(g, () => { box(g, 49, 62, 14, 12); for (const y of [77, 80.3]) box(g, 22, y, 68, 0.9); });
  },
  sanjusangendo(g) {
    roof(g, 56, 67, 51, 12, 3, 0.86); box(g, 9, 66, 94, 15); box(g, 5, 81, 102, 3);
    cut(g, () => { for (let x = 12; x < 100; x += 6.1) box(g, x, 70, 3.6, 9); });
  },
  fukuchiyama(g, a, P) {
    poly(g, [[25, B], [32, 73], [80, 73], [87, B]]);
    a.fillStyle = P.paper; box(a, 35, 62, 42, 11); box(a, 41, 50, 30, 7); box(a, 47, 40, 18, 6);
    box(g, 35, 68, 42, 5); box(g, 41, 54, 30, 3);
    roof(g, 56, 62, 28, 6, 3); roof(g, 56, 50, 22, 6, 3); roof(g, 56, 40, 15, 9, 3, 0.14);
    roof(g, 22, 68, 10, 4, 2); box(g, 15, 67, 14, 9);
    for (const x of [51, 59]) box(g, x, 42, 2, 2.6);
  },
  tower(g, a, P) {
    box(g, 38, 70, 36, 14); cut(g, () => { for (let x = 41; x < 72; x += 5) for (const y of [73, 78]) box(g, x, y, 3, 2.6); });
    a.fillStyle = P.paper; poly(a, [[51, 70], [54, 40], [58, 40], [61, 70]]);
    g.beginPath(); g.ellipse(56, 37, 10, 4.2, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(56, 31.5, 6.5, 3, 0, 0, 7); g.fill();
    box(g, 55.2, 12, 1.6, 18); box(g, 50.6, 40, 0.9, 30); box(g, 60.5, 40, 0.9, 30);
  },
  amanohashidate(g) {
    g.beginPath(); g.moveTo(6, 80); g.bezierCurveTo(34, 77, 60, 66, 106, 58); g.lineTo(106, 62); g.bezierCurveTo(64, 71, 38, 82, 6, B); g.closePath(); g.fill();
    [[20, 79, 1], [33, 76, 1.15], [46, 72.5, 1], [59, 68.5, 1.2], [73, 65, 1], [87, 62, 0.9], [99, 60, 0.75]].forEach(([x, y, s]) => pine(g, x, y, s));
  },
};
const GLYPH = {
  temple(g) { roof(g, 32, 31, 18, 10, 3, 0.3); box(g, 20, 30, 24, 13); box(g, 16, 43, 32, 2.6); cut(g, () => box(g, 28.5, 34, 7, 9)); },
  shrine(g) { torii(g, 32, 46, 28, 28); },
  castle(g) { poly(g, [[15, 46], [20, 38], [44, 38], [49, 46]]); box(g, 22, 31, 20, 7); roof(g, 32, 31, 15, 4.5, 2); box(g, 26, 23, 12, 5); roof(g, 32, 23, 10, 6, 2, 0.15); },
  garden(g) { pine(g, 30, 44, 1.75); g.beginPath(); g.ellipse(43, 43.5, 6, 3.2, 0, 0, 7); g.fill(); box(g, 14, 45.5, 36, 1.8); },
  museum(g) {   // a hanging scroll
    box(g, 20, 16.5, 24, 2.6); box(g, 20, 45, 24, 2.6); box(g, 23, 19, 18, 26);
    cut(g, () => { box(g, 25.5, 22.5, 13, 19); });
    g.beginPath(); g.arc(32, 29, 3.2, 0, 7); g.fill(); box(g, 28, 35, 8, 1.5); box(g, 29.5, 38, 5, 1.5);
  },
  viewpoint(g, a, P) {
    a.fillStyle = P.disc; a.beginPath(); a.arc(41, 22, 4.6, 0, 7); a.fill();
    poly(g, [[13, 46], [26, 24], [33, 35], [38, 29], [51, 46]]);
    cut(g, () => poly(g, [[23, 29], [26, 24], [29, 29], [27.5, 30.5], [26, 28.8], [24.5, 30.5]]));
  },
  attraction(g) {   // a stone lantern
    roof(g, 32, 26, 13, 6, 2.4, 0.12); box(g, 31, 16.5, 2, 4); box(g, 26.5, 26, 11, 8); box(g, 23.5, 34, 17, 2.2); box(g, 30, 36, 4, 8); poly(g, [[23, 46.5], [26, 43.5], [38, 43.5], [41, 46.5]]);
    cut(g, () => box(g, 30, 28, 4, 4.4));
  },
};

const mk = (s) => { const c = document.createElement('canvas'); c.width = c.height = s; return c; };
// ink + accent with a thin halo around both, so the shape reads on any basemap
function withHalo(go, ink, acc, size, halo, w) {
  const m = mk(size), gm = m.getContext('2d');
  gm.drawImage(ink, 0, 0); gm.drawImage(acc, 0, 0);
  gm.globalCompositeOperation = 'source-in'; gm.fillStyle = halo; gm.fillRect(0, 0, size, size);
  for (let i = 0; i < 12; i++) go.drawImage(m, Math.cos(i * Math.PI / 6) * w, Math.sin(i * Math.PI / 6) * w);
  go.drawImage(acc, 0, 0); go.drawImage(ink, 0, 0);
}
function landmarkImage(key, theme) {
  const P = PAL[theme] || PAL.dark;
  const ink = mk(L), acc = mk(L), out = mk(L);
  const gi = ink.getContext('2d'), ga = acc.getContext('2d'), go = out.getContext('2d');
  gi.fillStyle = P.ink;
  DRAW[key](gi, ga, P);
  gi.beginPath(); gi.moveTo(14, 90); gi.quadraticCurveTo(56, 80.5, 98, 90); gi.quadraticCurveTo(56, 85.5, 14, 90); gi.fill();   // the ground line
  go.shadowColor = P.rim; go.shadowBlur = 5; go.shadowOffsetY = 1.5;
  go.fillStyle = P.disc; go.beginPath(); go.arc(56, 50, 33, 0, 7); go.fill();
  go.shadowColor = 'transparent';
  withHalo(go, ink, acc, L, P.halo, 2.2);
  return out;
}
function categoryImage(cat, theme, ring) {
  const P = PAL[theme] || PAL.dark;
  const ink = mk(C), acc = mk(C), out = mk(C);
  const gi = ink.getContext('2d'), ga = acc.getContext('2d'), go = out.getContext('2d');
  gi.fillStyle = P.plateInk;
  GLYPH[cat](gi, ga, P);
  go.shadowColor = P.rim; go.shadowBlur = 4; go.shadowOffsetY = 1.2;
  go.fillStyle = P.plate; go.beginPath(); go.arc(32, 32, 25, 0, 7); go.fill();
  go.shadowColor = 'transparent';
  go.lineWidth = 3; go.strokeStyle = ring; go.beginPath(); go.arc(32, 32, 25, 0, 7); go.stroke();
  go.lineWidth = 0.8; go.strokeStyle = 'rgba(40,30,25,.35)'; go.beginPath(); go.arc(32, 32, 22.4, 0, 7); go.stroke();
  go.drawImage(acc, 0, 0); go.drawImage(ink, 0, 0);
  return out;
}

// Registers (or repaints, on a theme change) every symbol with the map: 15 landmarks + 7 category plates.
export function addLandmarkImages(map, theme, catColors) {
  const put = (name, cv) => {
    const img = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
    if (map.hasImage(name)) map.updateImage(name, img); else map.addImage(name, img, { pixelRatio: 2 });
  };
  for (const key of Object.keys(DRAW)) put('lm-' + key, landmarkImage(key, theme));
  for (const cat of CAT_ICONS) put('cat-' + cat, categoryImage(cat, theme, catColors[cat] || '#888'));
}
// data URLs, for the legend and for checking the set by eye
const urls = {};
export function landmarkURL(name, theme = 'light', ring = '#888') {
  const k = `${name}|${theme}|${ring}`;
  if (!urls[k]) urls[k] = (name.startsWith('lm-') ? landmarkImage(name.slice(3), theme) : categoryImage(name.slice(4), theme, ring)).toDataURL();
  return urls[k];
}
