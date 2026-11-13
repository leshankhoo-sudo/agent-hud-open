// 紅葉の小さな奇跡 — A Little Miracle Beneath the Maple Leaves.
// The scene inside the music control: one fixed view of a tea room at night in autumn, opening onto
// a maple garden with stones and a lit house beyond. The story is set by p, the music volume (0..1);
// every main pose is a pure function of p, so dragging forwards, backwards, stopping or jumping
// always shows the same picture for the same p:
//   0.00-0.15  Silence      a red maple leaf falls in the garden; the candle flickers
//   0.15-0.33  Arrival      a shadow on the shoji, the door slides, a traveller in an indigo kimono
//                           steps out and walks to the cushion by the table
//   0.33-0.50  Guest        under the table a black cat's ears catch the light, then its eyes open;
//                           it tilts its head; the traveller stops and looks
//   0.50-0.65  Wind         a gust carries the leaf into the room; the cat paws at it; it lands by the cup
//   0.65-0.82  Tea          the traveller sits and pours; steam rises; the cat watches
//   0.82-0.95  Miracle      the steam gathers into a small golden paper crane that circles the candle
//   0.95-1.00  Serenity     the crane flies to the garden, golden motes rise, and it becomes a golden
//                           maple leaf that drifts down; the traveller holds the cup, cat beside
// A separate clock (t) only drives small things: breathing, blinking, flame, steam curl, sway.
// The music colours the room through smoothed bands: low = garden light, mid = leaves and sleeve,
// high = candle, steam and the crane's shine, transients = a faint shimmer where it fits the scene.
// Units: the window is 254 x 78. Drawn for this project with plain canvas shapes.
const TAU = Math.PI * 2;
const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (p, a, b) => cl((p - a) / (b - a));
const ss = (x) => { x = cl(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, f) => a + (b - a) * f;
const mix = (a, b, f) => [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
function bez(p0, p1, p2, p3, u) { const v = 1 - u; return [v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0], v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1]]; }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function rr(g, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function glow(g, x, y, r, rgb, a) { if (a <= 0.004) return; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
const LEAF = [[0.5, 0], [0.61, 0.24], [0.82, 0.14], [0.75, 0.38], [1, 0.4], [0.8, 0.56], [0.9, 0.7], [0.64, 0.66], [0.54, 1], [0.46, 1], [0.36, 0.66], [0.1, 0.7], [0.2, 0.56], [0, 0.4], [0.25, 0.38], [0.18, 0.14], [0.39, 0.24]];
function leafShape(g, x, y, s, rot, fill) { g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = fill; g.beginPath(); LEAF.forEach(([a, b], i) => (i ? g.lineTo((a - 0.5) * s, (b - 0.5) * s) : g.moveTo((a - 0.5) * s, (b - 0.5) * s))); g.closePath(); g.fill(); g.restore(); }

// ---------- chapters ----------
const CHAPTERS = [[0.15, '01 Silence'], [0.33, '02 Arrival'], [0.5, '03 An unexpected guest'], [0.65, '04 Playful wind'], [0.82, '05 The warmth of tea'], [0.95, '06 The little miracle'], [1.01, '07 Serenity']];
export const chapterOf = (p) => CHAPTERS.find(([to]) => p < to)[1];

// ---------- places ----------
export const PLACES = {
  door: [13, 44], post: 50, cushionL: 124, table: [139, 197], tableTop: 62.2, cup: [147.5, 60.6], pot: [161, 59.2], candle: [187.5, 59.6],
  cat: [171, 69.6], leafRest: [104, 52.3], leafRoom: [151.5, 61.6], floor: 72.4,
};
const P = PLACES;

// ---------- the story, as functions of p ----------
// traveller: x, standing (0) .. seated (1), walk phase, arm pose, head turn (radians, + looks up)
export function traveller(p) {
  const shown = seg(p, 0.17, 0.2);
  const walk = seg(p, 0.2, 0.32);
  const x = lerp(P.door[0] + 14, P.cushionL, ss(walk)) + (p < 0.2 ? lerp(-4, 0, seg(p, 0.17, 0.2)) : 0);
  const steps = walk * 9;                    // nine steps from the door to the cushion
  const sit = ss(seg(p, 0.645, 0.69));
  const look = p < 0.36 ? 0 : p < 0.44 ? -0.32 * ss(seg(p, 0.36, 0.4)) : p < 0.5 ? -0.32 * (1 - ss(seg(p, 0.44, 0.5))) : 0;
  const lookCrane = p > 0.83 && p < 0.96 ? 0.22 * Math.sin(Math.PI * seg(p, 0.83, 0.96)) : 0;
  const pour = seg(p, 0.69, 0.82);           // lift (0-.15), pour (.15-.85), set down (.85-1)
  const cup = ss(seg(p, 0.955, 0.985));
  return { shown, x, steps, walking: walk > 0 && walk < 1, sit, head: look + lookCrane + (p > 0.955 ? -0.06 : 0), push: p > 0.16 && p < 0.21 ? Math.sin(Math.PI * seg(p, 0.16, 0.21)) : 0, pour, cup, shadow: p > 0.11 && p < 0.2 ? Math.sin(Math.PI * seg(p, 0.11, 0.2)) : 0 };
}
export function door(p) { return ss(seg(p, 0.155, 0.2)); } // 0 closed .. 1 open
// cat: under the table (ears lit, eyes open), out by the table, paw, watch, look up
export function cat(p) {
  const ears = seg(p, 0.33, 0.37), eyes = seg(p, 0.37, 0.41);
  const tilt = p > 0.41 && p < 0.5 ? Math.sin(Math.PI * seg(p, 0.41, 0.5)) * 0.32 : 0;
  const out = ss(seg(p, 0.48, 0.53));
  const paw = p > 0.545 && p < 0.6 ? Math.sin(Math.PI * seg(p, 0.545, 0.6)) : 0;
  const up = p > 0.83 && p < 0.955 ? ss(seg(p, 0.83, 0.86)) * (1 - ss(seg(p, 0.93, 0.955))) : 0;
  const x = lerp(P.cat[0], P.cat[0] + 6, out), y = lerp(68.2, P.floor, out);
  return { visible: p >= 0.33, ears, eyes, tilt, out, paw, up, x, y, watchTea: p > 0.66 && p < 0.83 ? 1 : 0, garden: p > 0.955 ? 1 : 0 };
}
// the red leaf: falls in the garden, is carried in on the wind, lands by the cup
export function leaf(p) {
  if (p < 0.15) { const u = ss(seg(p, 0, 0.15)); const [x, y] = bez([88, 27], [96, 34], [93, 44], P.leafRest, u); return { x: x + Math.sin(u * 9) * 2.4 * (1 - u), y, rot: u * 7.5, flying: u < 1 }; }
  if (p < 0.5) return { x: P.leafRest[0], y: P.leafRest[1], rot: 7.5, flying: false };
  if (p < 0.62) { const u = ss(seg(p, 0.5, 0.62)); const [x, y] = bez(P.leafRest, [118, 36], [140, 44], P.leafRoom, u); return { x, y, rot: 7.5 + u * 14, flying: true, u }; }
  return { x: P.leafRoom[0], y: P.leafRoom[1], rot: 21.5, flying: false };
}
// the crane: formed from the steam, circles the candle, flies to the garden and becomes a golden leaf
export function crane(p) {
  const form = ss(seg(p, 0.82, 0.865));
  if (form <= 0) return null;
  const fly = seg(p, 0.875, 0.95), out = seg(p, 0.95, 0.975), fall = seg(p, 0.972, 1);
  let x, y, dir = 1;
  const start = [P.cup[0] + 1, 45];
  if (fly <= 0) [x, y] = start;
  else if (out <= 0) {
    // half a circle over the candle, from its left to its right
    const c = [P.candle[0], 49], r = 13, a = Math.PI + Math.PI * ss(fly);
    const from = mix(start, [c[0] - r, c[1]], ss(seg(fly, 0, 0.2)));
    [x, y] = fly < 0.2 ? from : [c[0] + r * Math.cos(a), c[1] + r * 0.55 * Math.sin(a)];
  } else { [x, y] = bez([P.candle[0] + 13, 49], [210, 40], [216, 30], [222, 29], ss(out)); }
  if (out > 0.3) dir = 1;
  const wing = seg(p, 0.855, 0.88); // wings unfold
  const leafK = ss(seg(p, 0.968, 0.98));
  if (fall > 0) { const [lx, ly] = bez([222, 29], [218, 36], [228, 42], [225, 50.5], ss(fall)); x = lx + Math.sin(fall * 8) * 1.6 * (1 - fall); y = ly; }
  return { x, y, form, wing, fly, out, leafK, fall, dir, glow: form * (1 - leafK * 0.4) };
}
export function steam(p) { return p < 0.72 ? 0 : p < 0.82 ? ss(seg(p, 0.72, 0.78)) : p < 0.87 ? 1 - ss(seg(p, 0.82, 0.86)) * 0.85 : 0.15 + 0.35 * ss(seg(p, 0.95, 1)); }

// ---------- painted once: the parts of the room that never move ----------
function paintBack(g) {
  // night sky over the roofs, the house across the garden with lit shoji
  const sky = g.createLinearGradient(0, 21, 0, 40); sky.addColorStop(0, '#0d1022'); sky.addColorStop(1, '#1a1a2c');
  g.fillStyle = sky; g.fillRect(0, 0, 254, 60);
  // tiled roof in perspective, with rows of tiles
  g.fillStyle = '#26262f'; g.beginPath(); g.moveTo(52, 34); g.lineTo(78, 24.5); g.lineTo(214, 24.5); g.lineTo(240, 34); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(160,170,200,.12)'; g.lineWidth = 0.3;
  for (let i = 0; i < 26; i++) { const x = 80 + i * 5.2; g.beginPath(); g.moveTo(x, 24.8); g.lineTo(52 + ((x - 52) / 188) * 188 + (x - 146) * 0.18, 33.8); g.stroke(); }
  g.fillStyle = '#17161b'; g.fillRect(52, 33.6, 188, 1.6);
  // the house: posts and glowing shoji panels
  g.fillStyle = '#2c241e'; g.fillRect(56, 35, 182, 13);
  for (let i = 0; i < 8; i++) {
    const x = 62 + i * 21.5, warm = i % 3 === 1 ? 0.62 : 0.88;
    const sh = g.createLinearGradient(0, 36, 0, 46.5); sh.addColorStop(0, `rgba(255,214,150,${warm})`); sh.addColorStop(1, `rgba(236,170,92,${warm})`);
    g.fillStyle = sh; g.fillRect(x, 36.2, 16, 10.4);
    g.strokeStyle = 'rgba(70,44,22,.75)'; g.lineWidth = 0.32; g.beginPath();
    for (const dx of [4, 8, 12]) { g.moveTo(x + dx, 36.2); g.lineTo(x + dx, 46.6); }
    for (const dy of [39.6, 43]) { g.moveTo(x, dy); g.lineTo(x + 16, dy); }
    g.stroke();
  }
  g.fillStyle = '#211a15'; g.fillRect(56, 46.6, 182, 1.6);
}
function paintGarden(g) {
  // moss and gravel, stones lit from the house, low shrubs
  const moss = g.createLinearGradient(0, 47.5, 0, 57.5); moss.addColorStop(0, '#3a4a2a'); moss.addColorStop(1, '#1d2416');
  g.fillStyle = moss; g.beginPath(); g.moveTo(50, 57.5); g.lineTo(50, 49.5); g.quadraticCurveTo(140, 47, 240, 49.2); g.lineTo(240, 57.5); g.closePath(); g.fill();
  const stone = (pts, c) => { g.fillStyle = c; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); };
  stone([[118, 55], [120, 47.5], [124, 44.8], [128.5, 47], [129.5, 55]], '#8b8a86');
  stone([[130, 55], [131.6, 49.6], [135.5, 48.6], [138.2, 51.5], [138.8, 55]], '#77766f');
  stone([[112, 55.5], [113, 51.8], [116.8, 51], [118.5, 55.5]], '#6b6a65');
  stone([[176, 55], [178, 52], [183, 51.4], [186.2, 53.6], [186.5, 55]], '#706f69');
  g.fillStyle = 'rgba(255,214,160,.16)'; g.fillRect(121, 45.5, 2, 6); g.fillRect(132, 49.5, 1.6, 4);
  // shrubs in autumn colour along the front
  const rnd = mulberry(77);
  for (let i = 0; i < 140; i++) { const x = 54 + rnd() * 184, y = 54.2 + rnd() * 2.8; g.fillStyle = ['#6e1a0c', '#8a2812', '#a8401a', '#c8682a', '#5a3218'][i % 5]; g.globalAlpha = 0.7 + rnd() * 0.3; g.beginPath(); g.ellipse(x, y, 0.8 + rnd() * 1.2, 0.5 + rnd() * 0.7, 0, 0, TAU); g.fill(); }
  g.globalAlpha = 1;
}
function paintMaple(g, cx, top, w, h, seed, trunk) {
  // a maple: dark trunk and branches, a canopy of many small rounds in crimson and orange, lit underneath
  const rnd = mulberry(seed);
  g.strokeStyle = '#2a1b17'; g.lineCap = 'round';
  g.lineWidth = 1.7; g.beginPath(); g.moveTo(trunk[0], 56); g.quadraticCurveTo(trunk[1], 44, trunk[2], top + h * 0.55); g.stroke();
  g.lineWidth = 0.8; g.beginPath(); g.moveTo(trunk[1], 45); g.quadraticCurveTo(trunk[1] + w * 0.2, top + h * 0.6, cx + w * 0.3, top + h * 0.35); g.stroke();
  g.beginPath(); g.moveTo(trunk[2], top + h * 0.6); g.quadraticCurveTo(cx - w * 0.2, top + h * 0.4, cx - w * 0.38, top + h * 0.3); g.stroke();
  const inCanopy = () => { const u = rnd(), v = rnd(); return [cx + (u - 0.5) * w, top + v * h * (0.92 - 0.45 * Math.abs(u - 0.5) * 2 * 0.5)]; };
  // the dark inside of the crown first, so the leaves read as a volume, not a flat patch
  for (let i = 0; i < 26; i++) { const [x, y] = inCanopy(); g.fillStyle = ['#3d0c07', '#561409', '#2c0905'][i % 3]; g.globalAlpha = 0.8; g.beginPath(); g.ellipse(x, y + 1.5, 3.2 + rnd() * 2.6, 2 + rnd() * 1.8, 0, 0, TAU); g.fill(); }
  // then many small leaves: deep crimson inside, brighter scarlet and orange at the edges and on top
  const cols = ['#9c1f10', '#b8291a', '#c8321c', '#d8401f', '#e2552a', '#ee6a2c', '#f58a36'];
  for (let i = 0; i < 260; i++) {
    const [x, y] = inCanopy();
    const edge = Math.min(1, Math.abs(x - cx) / (w / 2) * 0.7 + (1 - (y - top) / h) * 0.5);
    g.fillStyle = cols[Math.min(cols.length - 1, Math.floor(edge * cols.length * 0.85 + rnd() * 2))];
    g.globalAlpha = 0.72 + rnd() * 0.28;
    const r = 0.65 + rnd() * 1.15;
    g.beginPath(); g.ellipse(x, y, r * 1.25, r, rnd() * 3, 0, TAU); g.fill();
  }
  // warm light from the house on the lower leaves
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-atop';
  const lit = g.createLinearGradient(0, top + h, 0, top); lit.addColorStop(0, 'rgba(255,190,110,.32)'); lit.addColorStop(0.6, 'rgba(255,190,110,0)');
  g.fillStyle = lit; g.fillRect(cx - w, top - 4, 2 * w, h + 8);
  g.globalCompositeOperation = 'source-over';
}
function paintRoom(g) {
  // ceiling with recessed lights, the lit transom, the beam, posts, left wall with its doorway,
  // the engawa, tatami, cushions
  g.fillStyle = '#100c0b'; g.fillRect(0, 0, 254, 12.2);
  for (let i = 0; i < 24; i++) { g.fillStyle = 'rgba(255,255,255,.025)'; g.fillRect(i * 11, 0, 0.4, 12.2); }
  g.fillStyle = '#1d1512'; g.fillRect(0, 12.2, 254, 7.6);
  for (let x = 2; x < 250; x += 30) {
    const tr = g.createLinearGradient(0, 13, 0, 19); tr.addColorStop(0, 'rgba(250,240,224,.88)'); tr.addColorStop(1, 'rgba(232,214,186,.8)');
    g.fillStyle = tr; g.fillRect(x, 13.2, 27, 5.6);
    g.strokeStyle = 'rgba(40,28,20,.7)'; g.lineWidth = 0.3; g.beginPath();
    for (let dx = 4.5; dx < 27; dx += 4.5) { g.moveTo(x + dx, 13.2); g.lineTo(x + dx, 18.8); }
    g.moveTo(x, 16); g.lineTo(x + 27, 16); g.stroke();
  }
  g.fillStyle = '#140f0d'; g.fillRect(0, 19.4, 254, 2.8);
  // left wall: plaster, the doorway's warm light behind (the sliding shoji is drawn over it)
  g.fillStyle = '#1b1613'; g.fillRect(0, 22.2, 50, 40);
  const back = g.createLinearGradient(0, 24, 0, 62); back.addColorStop(0, '#5a3a22'); back.addColorStop(1, '#3a2416');
  g.fillStyle = back; g.fillRect(5, 24.5, 30, 37.5);
  glow(g, 20, 40, 22, '255,170,90', 0.35);
  // posts and the right wall
  g.fillStyle = '#0f0b0a'; g.fillRect(P.post, 12.2, 4, 50); g.fillRect(3.5, 22.2, 2, 40); g.fillRect(35, 22.2, 2, 40);
  g.fillStyle = '#120d0c'; g.fillRect(238, 12.2, 16, 50); g.fillRect(236, 12.2, 2.4, 50);
  // engawa: polished boards reflecting the house
  const wood = g.createLinearGradient(0, 57.4, 0, 61.4); wood.addColorStop(0, '#4a3324'); wood.addColorStop(1, '#2a1c14');
  g.fillStyle = wood; g.fillRect(0, 57.4, 254, 4);
  g.fillStyle = 'rgba(255,200,130,.16)'; g.fillRect(54, 57.6, 184, 0.7);
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 0.25; for (let x = 6; x < 254; x += 14) { g.beginPath(); g.moveTo(x, 57.4); g.lineTo(x - 1.3, 61.4); g.stroke(); }
  // tatami, dark, with its borders in perspective
  const tat = g.createLinearGradient(0, 61.4, 0, 78); tat.addColorStop(0, '#2a2618'); tat.addColorStop(1, '#141209');
  g.fillStyle = tat; g.fillRect(0, 61.4, 254, 17);
  g.strokeStyle = 'rgba(8,6,3,.8)'; g.lineWidth = 0.55;
  for (const x of [30, 104, 178, 252]) { g.beginPath(); g.moveTo(x, 61.4); g.lineTo(x + (x - 127) * 0.3, 78); g.stroke(); }
  g.beginPath(); g.moveTo(0, 68.4); g.lineTo(254, 68.4); g.stroke();
  // cushions (zabuton)
  g.fillStyle = '#1d1b22'; rr(g, 112, 70.2, 26, 3.6, 1.6); g.fill();
  g.fillStyle = '#211e26'; rr(g, 205, 70.6, 25, 3.4, 1.6); g.fill();
  g.fillStyle = 'rgba(255,190,120,.08)'; g.fillRect(114, 70.3, 22, 0.5); g.fillRect(207, 70.7, 21, 0.5);
}

// ---------- the moving things ----------
function drawDoor(g, open, shadow, tShow) {
  // a sliding shoji panel over the doorway; it slides left behind the wall
  const x = lerp(5.5, -21, open);
  g.save(); g.beginPath(); g.rect(5, 22.2, 31, 40); g.clip();
  const pa = g.createLinearGradient(0, 24, 0, 62); pa.addColorStop(0, 'rgba(255,226,180,.95)'); pa.addColorStop(1, 'rgba(232,180,118,.92)');
  g.fillStyle = pa; g.fillRect(x, 24.5, 29.5, 37.5);
  // the traveller's shadow on the paper before the door opens
  if (shadow > 0.01) {
    g.globalAlpha = 0.55 * shadow; g.fillStyle = '#3a2416';
    g.beginPath(); g.ellipse(x + 17, 34.6, 2.6, 2.9, 0, 0, TAU); g.fill();
    g.beginPath(); g.moveTo(x + 13.6, 38); g.lineTo(x + 20.6, 38); g.lineTo(x + 22.4, 61); g.lineTo(x + 12, 61); g.closePath(); g.fill();
    g.globalAlpha = 1;
  }
  g.strokeStyle = 'rgba(60,38,20,.85)'; g.lineWidth = 0.4; g.beginPath();
  for (let dx = 4.9; dx < 29; dx += 4.9) { g.moveTo(x + dx, 24.5); g.lineTo(x + dx, 62); }
  for (let dy = 30.5; dy < 62; dy += 6.2) { g.moveTo(x, dy); g.lineTo(x + 29.5, dy); }
  g.stroke();
  g.strokeStyle = '#1a120e'; g.lineWidth = 1; g.strokeRect(x + 0.5, 24.9, 28.5, 36.8);
  g.restore();
}

function drawTraveller(g, T, o) {
  if (T.shown <= 0.01) return;
  const { t, mid, idle } = o;
  const x = T.x, base = P.floor - 0.2;
  const step = T.steps, phase = (step % 1) * TAU;
  const bob = T.walking ? Math.abs(Math.sin(phase)) * 0.45 : 0;
  const breath = idle > 1.2 ? Math.sin(t * 1.4) * 0.28 : Math.sin(t * 1.1) * 0.1;
  const sway = Math.sin(t * 0.9) * 0.25 * (0.4 + mid * 1.6);
  const s = T.sit, H = lerp(27, 17.2, s);
  const top = base - H - bob + breath * 0.3;
  const Z = 1.2, toLocal = ([wx, wy]) => [x + (wx - x) / Z, base + (wy - base) / Z];
  g.save();
  g.translate(x, base); g.scale(Z, Z); g.translate(-x, -base);
  g.globalAlpha = T.shown;
  // the body: an indigo kimono, wider at the hem; seated it folds forward into seiza
  const ind = g.createLinearGradient(x - 4, 0, x + 5, 0); ind.addColorStop(0, '#141b33'); ind.addColorStop(0.7, '#22305a'); ind.addColorStop(1, '#2d3b6a');
  g.fillStyle = ind;
  const sh = top + 5.4; // shoulders
  g.beginPath();
  if (s < 0.5) {
    const hemL = T.walking ? Math.sin(phase) * 0.8 : 0;
    g.moveTo(x - 3.3, sh); g.quadraticCurveTo(x - 4.1, sh + 6, x - 3.7 + hemL, base); g.lineTo(x + 4.4 + hemL * 0.6, base); g.quadraticCurveTo(x + 3.9, sh + 7, x + 3, sh);
  } else {
    g.moveTo(x - 3.2, sh); g.quadraticCurveTo(x - 4.6, sh + 6, x - 5.4, base); g.lineTo(x + 6.8, base); g.quadraticCurveTo(x + 6.2, base - 3.4, x + 2.2, base - 3.6); g.quadraticCurveTo(x + 3.6, sh + 4, x + 3, sh);
  }
  g.closePath(); g.fill();
  // collar, obi
  g.fillStyle = '#d9c8a8'; g.beginPath(); g.moveTo(x + 1.2, sh - 0.2); g.lineTo(x + 2.8, sh + 3.4); g.lineTo(x + 2.1, sh + 3.6); g.lineTo(x + 0.6, sh + 0.1); g.closePath(); g.fill();
  const obiY = lerp(sh + 7.4, sh + 5.6, s);
  g.fillStyle = '#b08a4a'; g.fillRect(x - 3.6, obiY, 7.2 + s * 0.6, 2.2);
  g.fillStyle = 'rgba(255,220,160,.35)'; g.fillRect(x - 3.6, obiY, 7.2, 0.4);
  // feet in white tabi, alternating while walking
  if (s < 0.4) {
    const f = T.walking ? Math.sin(phase) : 0;
    g.fillStyle = '#e8e2d6';
    g.beginPath(); g.ellipse(x + 1.6 + f * 1.6, base - 0.2, 1.3, 0.55, 0, 0, TAU); g.fill();
    g.globalAlpha = T.shown * 0.85; g.beginPath(); g.ellipse(x - 0.6 - f * 1.6, base - 0.2, 1.2, 0.5, 0, 0, TAU); g.fill(); g.globalAlpha = T.shown;
  }
  // head: hair in a low knot, face in profile towards the right, warm from the candle
  const hx = x + 0.9 + s * 0.4, hy = top + 2.4 + breath * 0.2;
  g.save(); g.translate(hx, hy); g.rotate(-T.head);
  g.fillStyle = '#e2bf9e'; g.beginPath(); g.ellipse(0.5, 0.2, 2.15, 2.4, 0, 0, TAU); g.fill();
  g.fillStyle = '#e2bf9e'; g.beginPath(); g.moveTo(2.4, -0.1); g.lineTo(3.1, 0.6); g.lineTo(2.4, 0.9); g.fill(); // nose
  g.fillStyle = '#120e10'; g.beginPath(); g.ellipse(-0.3, -0.6, 2.3, 2.1, 0, Math.PI * 0.95, Math.PI * 2.1); g.fill();
  g.beginPath(); g.arc(-2.2, 0.4, 1.25, 0, TAU); g.fill(); // knot
  g.fillStyle = 'rgba(255,190,120,.4)'; g.beginPath(); g.ellipse(1.6, 0.5, 0.9, 1.5, 0, -1.2, 1.2); g.fill();
  if (idle > 1.2 && (t % 4.2) < 0.13) { g.fillStyle = '#6b4a3a'; g.fillRect(1.5, 0, 0.8, 0.25); } // a blink
  g.restore();
  // the arm and the long sleeve; poses: hanging, sliding the door, pouring, holding the cup
  const sx = x + 1.4, sy = sh + 1.2;
  let hand;
  const pour = T.pour, lift = ss(seg(pour, 0, 0.15)), back = ss(seg(pour, 0.85, 1));
  const potHold = pour > 0 && pour < 1 ? lift * (1 - back) : 0;
  if (T.push > 0.01) hand = [sx - 7.5 * T.push, sy + 4];
  else if (T.cup > 0) hand = mix([sx + 4.4, sy + 7.6], [hx + 2.4, hy + 3.6], T.cup);
  else if (potHold > 0) hand = mix([sx + 3.4, sy + 8], toLocal([P.cup[0] + 6.6, P.cup[1] - 7.2]), potHold);
  else hand = s > 0.5 ? [sx + 4.4, sy + 7.6] : [sx + 1.2 + (T.walking ? Math.sin(phase) * 0.9 : 0), sy + 9.4];
  const sleeveSway = sway + (T.walking ? Math.sin(phase + 1) * 0.7 : 0);
  g.fillStyle = '#1b2647';
  g.beginPath(); g.moveTo(sx - 1.4, sy - 0.6); g.quadraticCurveTo(lerp(sx, hand[0], 0.5) - 2 + sleeveSway, lerp(sy, hand[1], 0.5) + 4.2, hand[0] - 0.8, hand[1] + 2.6);
  g.lineTo(hand[0] + 0.6, hand[1] + 0.4); g.quadraticCurveTo(lerp(sx, hand[0], 0.5) + 1.4, lerp(sy, hand[1], 0.5) - 0.4, sx + 1.6, sy); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,190,120,.35)'; g.lineWidth = 0.35; g.beginPath(); g.moveTo(sx + 1.6, sy); g.quadraticCurveTo(lerp(sx, hand[0], 0.5) + 1.4, lerp(sy, hand[1], 0.5) - 0.4, hand[0] + 0.6, hand[1] + 0.4); g.stroke();
  g.fillStyle = '#e2bf9e'; g.beginPath(); g.arc(hand[0] + 0.4, hand[1] + 0.6, 0.85, 0, TAU); g.fill();
  // warm rim light on the side facing the candle
  g.strokeStyle = 'rgba(255,186,110,.42)'; g.lineWidth = 0.45; g.beginPath(); g.moveTo(x + 3, sh); g.quadraticCurveTo(x + 3.9 + s * 2.4, sh + 7, x + 4.2 + s * 2.4, base - 0.5); g.stroke();
  g.restore();
  return { hand, potHold, pourFlow: ss(seg(pour, 0.18, 0.26)) * (1 - ss(seg(pour, 0.76, 0.84))) };
}

function drawTable(g) {
  const [a, b] = P.table, y = P.tableTop;
  g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.ellipse((a + b) / 2, 71.2, 32, 2.6, 0, 0, TAU); g.fill();
  g.fillStyle = '#16100d'; g.fillRect(a + 3, y + 2.4, 2.4, 7.4); g.fillRect(b - 5.4, y + 2.4, 2.4, 7.4);
}
function drawTableTop(g) {
  const [a, b] = P.table, y = P.tableTop;
  const top = g.createLinearGradient(0, y, 0, y + 2.6); top.addColorStop(0, '#3a2a1f'); top.addColorStop(1, '#1d140f');
  g.fillStyle = top; rr(g, a, y, b - a, 2.6, 0.6); g.fill();
  g.fillStyle = 'rgba(255,190,120,.28)'; g.fillRect(a + 1, y, b - a - 2, 0.35);
  // cup and saucer
  g.fillStyle = '#2a2420'; g.beginPath(); g.ellipse(P.cup[0], y + 0.2, 3.3, 0.6, 0, 0, TAU); g.fill();
  g.fillStyle = '#d8d0c0'; rr(g, P.cup[0] - 1.6, y - 2.2, 3.2, 2.3, 0.7); g.fill();
}
function drawPot(g, Tr) {
  // the iron kettle: on the table, lifted, tilted over the cup, set down
  const h = Tr ? Tr.potHold : 0;
  const rest = P.pot, hold = [P.cup[0] + 3.4, P.cup[1] - 6.6];
  const [x, y] = mix(rest, hold, h);
  const tilt = h * (Tr ? 0.25 + 0.55 * Tr.pourFlow : 0.25);
  g.save(); g.translate(x, y); g.rotate(-tilt);
  g.fillStyle = '#0d0b0c'; g.beginPath(); g.ellipse(0, 0, 4.4, 2.9, 0, 0, TAU); g.fill();
  g.beginPath(); g.moveTo(-3.6, -0.8); g.lineTo(-6.6, -2.8); g.lineTo(-6.9, -2.1); g.lineTo(-3.8, 0.4); g.closePath(); g.fill(); // spout, towards the cup
  g.beginPath(); g.arc(0, -2.8, 0.7, 0, TAU); g.fill();
  g.strokeStyle = '#0d0b0c'; g.lineWidth = 0.6; g.beginPath(); g.arc(0, -1.6, 3.6, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
  g.strokeStyle = 'rgba(255,170,100,.45)'; g.lineWidth = 0.35; g.beginPath(); g.ellipse(0, 0, 4.4, 2.9, 0, -0.9, 0.6); g.stroke();
  g.restore();
  // the tea, a thin amber stream from the spout to the cup
  if (Tr && Tr.pourFlow > 0.02) {
    const sx = x - 6.6 * Math.cos(tilt) + 2.6 * Math.sin(tilt), sy = y - 2.4 + 6.6 * Math.sin(tilt) * 0.2;
    g.strokeStyle = `rgba(214,150,70,${0.8 * Tr.pourFlow})`; g.lineWidth = 0.5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo(sx - 0.8, sy + 2, P.cup[0], P.cup[1] - 1.4); g.stroke();
  }
}
function drawCandle(g, o) {
  const [x, y] = P.candle;
  g.fillStyle = 'rgba(240,220,190,.55)'; rr(g, x - 1.8, y - 0.8, 3.6, 3.4, 0.6); g.fill();
}
function drawFlame(g, o) {
  const [x, y] = P.candle, { t, high, still } = o;
  const fl = still ? 0 : (Math.sin(t * 11.3) * 0.5 + Math.sin(t * 17.7) * 0.5) * (0.12 + high * 0.55);
  glow(g, x, y - 1, 34 + fl * 7, '255,160,80', 0.3);
  glow(g, x, y - 1.4, 7, '255,220,150', 0.8);
  const h = 2.9 + fl * 1.5;
  g.fillStyle = '#ffd98e'; g.beginPath(); g.moveTo(x, y - 0.6); g.quadraticCurveTo(x - 1.3, y - 1.6, x + fl * 0.5, y - 0.8 - h); g.quadraticCurveTo(x + 1.3, y - 1.6, x, y - 0.6); g.fill();
  g.fillStyle = '#fff6da'; g.beginPath(); g.ellipse(x, y - 1.2, 0.4, 0.75, 0, 0, TAU); g.fill();
}

function drawCat(g, C, o) {
  if (!C.visible) return;
  const { t, idle, react } = o;
  const blinkNow = (idle > 1.2 && (t % 3.6) < 0.14) || (o.catBlink > 0);
  const x = C.x, y = C.y;
  const quick = react.catUp; // a short look up on a fast drag
  const lookUp = Math.max(C.up, quick);
  g.save();
  g.translate(x, y); g.scale(1.6, 1.6); g.translate(-x, -y);
  g.fillStyle = '#0c0b0d';
  if (C.out > 0.02) {
    // body, sitting; the tail curls and lifts a little when it is interested
    g.globalAlpha = C.out;
    g.beginPath(); g.ellipse(x + 1.4, y - 2.2, 3.2, 2.4, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(x - 0.6, y - 3.4, 1.8, 2.6, -0.3, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,170,100,.55)'; g.lineWidth = 0.35;
    g.beginPath(); g.ellipse(x + 1.4, y - 2.2, 3.2, 2.4, 0, -1.4, 0.3); g.stroke();
    g.beginPath(); g.ellipse(x - 0.6, y - 3.4, 1.8, 2.6, -0.3, -1.6, -0.4); g.stroke();
    g.strokeStyle = '#0c0b0d'; g.lineWidth = 0.9; g.lineCap = 'round';
    const tw = Math.sin(t * 1.3) * 0.6 + C.paw * 1.2;
    g.beginPath(); g.moveTo(x + 4.2, y - 1); g.quadraticCurveTo(x + 7 + tw, y - 1.4, x + 6.4 + tw, y - 4.6 - lookUp); g.stroke();
    // paw: reaches up at the leaf, or chases the motes when it waits in the crane scene
    const chase = C.up > 0.5 && idle > 1.2 ? Math.max(0, Math.sin(t * 2.2)) : 0;
    const paw = Math.max(C.paw, chase * 0.8);
    g.lineWidth = 0.75; g.beginPath(); g.moveTo(x - 1.2, y - 2); g.lineTo(x - 1.6 - paw * 1.8, y - 0.6 - paw * 4.2); g.stroke();
    g.globalAlpha = 1;
  }
  // head: under the table only the ears catch the light, then the eyes open
  const hx = x - 1.2 - C.out * 0.6, hy = y - lerp(1.6, 6.2, C.out) - lookUp * 0.6;
  g.translate(hx, hy); g.rotate(-C.tilt - lookUp * 0.25);
  const under = 1 - C.out;
  g.globalAlpha = lerp(Math.max(0.15, C.ears), 1, C.out);
  g.fillStyle = '#0c0b0d'; g.beginPath(); g.ellipse(0, 0, 1.9, 1.6, 0, 0, TAU); g.fill();
  if (C.out > 0.3) { g.strokeStyle = 'rgba(255,170,100,.5)'; g.lineWidth = 0.3; g.beginPath(); g.ellipse(0, 0, 1.9, 1.6, 0, -1.2, 0.6); g.stroke(); }
  const ear = (s, tw) => { g.beginPath(); g.moveTo(s * 0.5, -1.1); g.lineTo(s * 1.6 + tw, -3.1 - (s > 0 ? 0 : 0.2)); g.lineTo(s * 1.9, -0.4); g.closePath(); g.fill(); };
  const twitch = Math.sin(t * 7) > 0.97 ? 0.4 : 0;
  ear(-1, 0); ear(1, twitch);
  // the candle catches the ear tips
  g.fillStyle = `rgba(255,170,100,${(0.55 * C.ears).toFixed(3)})`;
  g.beginPath(); g.moveTo(1.4, -2.4); g.lineTo(1.6 + twitch, -3.1); g.lineTo(1.75, -2.2); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(-1.4, -2.4); g.lineTo(-1.6, -3.3); g.lineTo(-1.75, -2.2); g.closePath(); g.fill();
  // eyes: amber-green, they follow the crane when it flies
  if (C.eyes > 0.02) {
    const open = blinkNow ? 0.12 : C.eyes;
    const look = o.craneDir || 0;
    g.globalAlpha = 1;
    for (const ex of [-0.75, 0.75]) {
      g.fillStyle = '#c9e07a'; g.beginPath(); g.ellipse(ex, -0.1, 0.48, 0.42 * open, 0, 0, TAU); g.fill();
      g.fillStyle = '#0b0a08'; g.beginPath(); g.ellipse(ex + look * 0.18, -0.1 - lookUp * 0.1, 0.14, 0.32 * open, 0, 0, TAU); g.fill();
      glow(g, ex, -0.1, 1.4, '200,240,120', 0.35 * open * (under * 0.8 + 0.2));
    }
  }
  g.restore();
}

const p_inRoom = (L) => L.y > 57;
function drawLeaf(g, L, o) {
  const { react, mid, still } = o;
  const spin = L.flying ? (1 + react.speed * 1.4) : 1;
  const flutter = still ? 0 : Math.sin(o.t * 2 + 1) * 0.15 * (0.3 + mid);
  leafShape(g, L.x, L.y, 4.2, L.rot * spin + flutter, '#d8331c');
  if (L.x > 112 || p_inRoom(L)) glow(g, L.x, L.y, 3, '255,120,70', 0.25);
  g.strokeStyle = 'rgba(120,20,10,.7)'; g.lineWidth = 0.18;
}

function drawSteam(g, amount, o) {
  if (amount <= 0.01 || o.still) return;
  const { t, high } = o;
  const [cx, cy] = P.cup;
  g.save(); g.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const k = (t * 0.26 + i / 4) % 1, x = cx + Math.sin(t * 1.3 + i * 2) * (0.6 + k * 2.2), y = cy - 2.4 - k * 14;
    g.globalAlpha = Math.sin(k * Math.PI) * amount * (0.45 + high * 0.4);
    g.strokeStyle = '#fffaf2'; g.lineWidth = 0.5 + k * 1.2;
    g.beginPath(); g.moveTo(x, y + 3); g.quadraticCurveTo(x + Math.sin(t * 1.7 + i) * 2, y + 1.5, x + Math.sin(t * 1.1 + i) * 1.2, y); g.stroke();
  }
  g.restore();
}

function drawCrane(g, Cr, o) {
  if (!Cr) return;
  const { t, high, still, trans } = o;
  // steam motes gathering into the crane
  if (Cr.form < 1) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + t * 0.6, r = (1 - Cr.form) * 9;
      glow(g, Cr.x + Math.cos(a) * r, Cr.y + Math.sin(a) * r * 0.6 + (1 - Cr.form) * 6, 1.1, '255,235,190', 0.7 * Cr.form);
    }
  }
  const shine = 0.5 + 0.5 * high + 0.6 * trans;
  glow(g, Cr.x, Cr.y, 14, '255,200,110', 0.45 * Cr.glow * shine);
  if (Cr.leafK > 0) { leafShape(g, Cr.x, Cr.y, 5, (Cr.fall || 0) * 6 + 0.4, `rgba(240,192,80,${Cr.leafK})`); glow(g, Cr.x, Cr.y, 6, '255,214,120', 0.5 * Cr.leafK); }
  if (Cr.leafK >= 1) return;
  const flap = still ? 0.3 : Math.sin(t * (Cr.fly > 0 ? 9 : 2.4)) * 0.55 * Cr.wing;
  const open = Cr.wing;
  g.save(); g.translate(Cr.x, Cr.y); g.scale(Cr.dir * 1.6, 1.6);
  g.globalAlpha = Cr.form * (1 - Cr.leafK);
  const gold = g.createLinearGradient(-4, -4, 4, 3); gold.addColorStop(0, '#fff3c4'); gold.addColorStop(0.5, '#f0c25a'); gold.addColorStop(1, '#b88326');
  g.fillStyle = gold;
  // body: a folded diamond, neck up to the front, tail up behind
  g.beginPath(); g.moveTo(-2.6, 0); g.lineTo(0, -0.9); g.lineTo(2.6, 0); g.lineTo(0, 1.2); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(1.6, -0.2); g.lineTo(4.2, -3.6); g.lineTo(4.9, -3.4); g.lineTo(2.4, 0.3); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(-1.6, -0.2); g.lineTo(-4.6, -2.8); g.lineTo(-2.2, 0.4); g.closePath(); g.fill();
  // wings: folded flat, then open and beat
  const wy = -0.6 - open * 3.4 - flap * 2.6;
  g.fillStyle = 'rgba(255,236,170,.92)';
  g.beginPath(); g.moveTo(-0.9, -0.5); g.lineTo(lerp(-0.4, -1.8, open), wy); g.lineTo(lerp(1.1, 2.6, open), wy * 0.85); g.lineTo(0.9, -0.5); g.closePath(); g.fill();
  g.globalAlpha *= 0.65; g.beginPath(); g.moveTo(-0.6, -0.2); g.lineTo(lerp(-0.2, -2.6, open), -wy * 0.3 + 0.8); g.lineTo(lerp(0.6, 1.6, open), -wy * 0.22 + 0.6); g.lineTo(0.6, -0.2); g.closePath(); g.fill();
  g.restore();
}

function drawMotes(g, p, o) {
  const k = ss(seg(p, 0.95, 0.985));
  if (k <= 0) return;
  const rnd = mulberry(311);
  for (let i = 0; i < 16; i++) {
    const x = 196 + rnd() * 36, y0 = 24 + rnd() * 26, ph = rnd() * TAU;
    const y = y0 - (o.still ? 0 : ((o.t * 0.12 + rnd()) % 1) * 6);
    glow(g, x, y, 1.6, '255,214,120', k * (0.4 + 0.4 * Math.sin(o.t * 1.4 + ph) + o.trans * 0.3));
  }
}

// ---------- the scene ----------
// cache: { res, back, maples:[{c,x,y}], garden, room } built for one resolution
export function buildTeaCache(res) {
  const make = (w, h, paint) => { const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(w * res)); c.height = Math.max(2, Math.round(h * res)); const g = c.getContext('2d'); g.setTransform(res, 0, 0, res, 0, 0); paint(g); return c; };
  const back = make(254, 78, paintBack);
  const garden = make(254, 78, paintGarden);
  const room = make(254, 78, paintRoom);
  const maple = (cx, top, w, h, seed, trunk) => ({ x: cx - w / 2 - 5, y: top - 5, w: w + 10, h: 62 - top, c: make(w + 10, 62 - top, (g) => { g.translate(-(cx - w / 2 - 5), -(top - 5)); paintMaple(g, cx, top, w, h, seed, trunk); }) });
  return { res, back, garden, room, maples: [maple(84, 22.5, 52, 22, 11, [86, 88, 84]), maple(206, 21.5, 64, 24, 23, [204, 201, 198]), maple(150, 25, 28, 13, 37, [152, 151, 149])] };
}

// o: { p, t, dt, still, low, mid, high, trans, idle, react: { speed, catUp }, px }
export function drawTeaRoom(g, cache, o) {
  const p = cl(o.p);
  const px = o.px || 0;
  g.clearRect(0, 0, 254, 78);
  const blit = (c, shift) => g.drawImage(c, px * shift, 0, 254, 78);
  // far: sky and the lit house
  blit(cache.back, 1.2);
  // the house's light breathes very slightly with the low end of the music
  if (o.low > 0.01) { g.fillStyle = `rgba(255,190,110,${(0.07 * o.low).toFixed(3)})`; g.fillRect(56 + px * 1.2, 35, 182, 13); }
  // maples, swaying a little with the mid range
  cache.maples.forEach((m, i) => {
    const sway = o.still ? 0 : Math.sin(o.t * (0.7 + i * 0.13) + i) * (0.25 + o.mid * 0.9);
    g.save(); g.translate(m.x + px * 2.6 + sway * 0.5, m.y); g.transform(1, 0, sway * 0.025, 1, 0, 0);
    g.drawImage(m.c, 0, 0, m.w, m.h); g.restore();
  });
  blit(cache.garden, 3.4);
  // the red leaf while it is still in the garden
  const L = leaf(p);
  if (L.x < 112 && p < 0.5) drawLeaf(g, { ...L, x: L.x + px * 3.4 }, o);
  // the room
  g.save(); g.translate(px * 6, 0);
  g.drawImage(cache.room, 0, 0, 254, 78);
  drawDoor(g, door(p), traveller(p).shadow);
  // downlights in the ceiling
  for (const x of [30, 92, 160, 222]) { glow(g, x, 10.6, 6, '255,220,170', 0.55); g.fillStyle = '#fff4e0'; g.beginPath(); g.ellipse(x, 10.4, 1.3, 0.5, 0, 0, TAU); g.fill(); }
  const T = traveller(p), C = cat(p), Cr = crane(p);
  drawTable(g);
  if (C.out < 0.5) drawCat(g, C, { ...o, craneDir: Cr ? Math.sign(Cr.x - C.x) : 0 });
  drawTableTop(g);
  drawCandle(g, o);
  const Tr = drawTraveller(g, T, o) || null;
  drawPot(g, Tr);
  if (L.x >= 112 || p >= 0.5) drawLeaf(g, L, o);
  if (C.out >= 0.5) drawCat(g, C, { ...o, craneDir: Cr ? Math.sign(Cr.x - C.x) : 0 });
  drawFlame(g, o);
  drawSteam(g, steam(p), o);
  g.restore();
  drawCrane(g, Cr ? { ...Cr, x: Cr.x + px * (Cr.out > 0 ? lerp(6, 3, Cr.out) : 6) } : null, o);
  drawMotes(g, p, o);
  // a soft vignette, as through a lens
  const v = g.createRadialGradient(127, 44, 30, 127, 44, 150); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.42)');
  g.fillStyle = v; g.fillRect(0, 0, 254, 78);
}

// What a tap at (x, y) lands on, in the window's own units. Returns a name or null.
export function hitTea(x, y, p, px = 0) {
  const near = (cx, cy, r, shift) => Math.hypot(x - (cx + px * shift), y - cy) <= r;
  const C = cat(p);
  if (C.visible && near(C.x - 1, C.y - lerp(1.6, 4, C.out), 6.5, 6)) return 'cat';
  if (near(P.candle[0], P.candle[1] - 2, 5.5, 6)) return 'candle';
  const T = traveller(p);
  if (T.shown > 0.5 && near(T.x + 0.5, P.floor - (T.sit > 0.5 ? 9 : 13), 7, 6)) return 'traveller';
  if (y > 21 && y < 46 && ((x > 56 && x < 112) || (x > 172 && x < 238))) return 'maple';
  return null;
}
