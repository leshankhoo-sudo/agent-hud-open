// The little room inside the music control, drawn on a canvas in a 254 x 78 unit frame.
// A tatami room at night looks out over an engawa to a garden: maples, rocks, a stone lantern and
// a house with shoji across the way; a low table with an iron kettle, a cup and a candle; a cat
// on a cushion. One number, L (0..1, how loud the music is; 0 when it is paused), runs the scene:
//   0      night, moonlight only, the cat asleep
//   > .03  the candle is lit
//   > .1   the cat wakes and sits up; shoji across the garden light up one after another
//   > .3   the ceiling lights and the stone lantern come on, the kettle steams, leaves begin to fall
//   > .6   the wind chime swings, the cat sways to the music, notes drift up
//   > .86  a fox looks in from the garden to see what the noise is
// `beat` (0..1) is the level of the music at this moment, so the flame and the leaves answer the
// piano. Foliage and the falling things follow the season theme. All drawn for this project.
const TAU = Math.PI * 2;
const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ss = (a, b, x) => { const t = cl((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (() => { let s = 7919; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();

const PAL = {
  spring: { canopy: ['#f7c6d4', '#f2a9c0', '#fbdde6', '#e98fb0', '#f5b8cb'], drift: ['#fbd3df', '#f4b3c8', '#ffe9ef'], moss: '#4c7a44', shrub: '#3f6b3c', kind: 'petal' },
  summer: { canopy: ['#5fae5a', '#3f8f4c', '#86c96a', '#2f7a45', '#70b85f'], drift: ['#e4ff9a'], moss: '#3c7a3a', shrub: '#2f6a3a', kind: 'firefly' },
  autumn: { canopy: ['#e2472a', '#f07a2e', '#c9321f', '#f6a63a', '#b3261a'], drift: ['#e9542c', '#f39a3a', '#c93522'], moss: '#55723a', shrub: '#3d5a30', kind: 'leaf' },
  winter: { canopy: ['#eef3fb', '#d5dfef', '#ffffff', '#c2cfe4', '#e3eaf6'], drift: ['#ffffff'], moss: '#c9d4e4', shrub: '#dfe7f3', kind: 'snow' },
};
// canopies: [cx, cy, r, colour index, phase]
// each canopy is many small rounds, the larger ones behind
const blobs = (x0, x1, y0, y1, n) => Array.from({ length: n }, () => { const u = rnd(), v = rnd(); return [lerp(x0, x1, u), lerp(y0, y1, v) + Math.abs(u - 0.5) * 7, 2.5 + rnd() * 3.3, Math.floor(rnd() * 5), rnd() * TAU]; }).sort((a, b) => b[2] - a[2]);
const TREE_L = blobs(57, 102, 21, 33, 30);
const TREE_R = blobs(170, 238, 20, 34, 42);
const STARS = Array.from({ length: 14 }, () => [rnd() * 254, 20 + rnd() * 12, 0.25 + rnd() * 0.35, rnd() * TAU]);

function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function glow(g, x, y, r, rgb, a) {
  if (a <= 0.003) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
}

function drawCat(g, L, t, beat, still) {
  const up = ss(0.07, 0.17, L), groove = ss(0.55, 0.8, L);
  const bx = 112, floor = 71.4;
  const breathe = still ? 0 : Math.sin(t * 1.5) * 0.14 * (1 - up);
  const bob = still ? 0 : Math.sin(t * 5.2) * (0.25 + beat * 0.9) * groove;
  const sway = still ? 0 : Math.sin(t * 2.6) * 0.8 * groove;
  const brx = lerp(8.4, 4.5, up), bry = lerp(3.3, 5.4, up) + breathe;
  const hy = lerp(floor - 3.4, floor - 12.2, up) + bob, hx = lerp(bx - 7.2, bx + 0.4, up) + sway;
  g.fillStyle = '#1d1a1f';
  // tail
  const tw = still ? 0.2 : Math.sin(t * (1.4 + groove * 2.4)) * (0.25 + up * 0.5 + beat * 0.5);
  g.strokeStyle = '#1d1a1f'; g.lineWidth = 1.5; g.lineCap = 'round';
  g.beginPath();
  if (up < 0.5) { g.moveTo(bx + 6, floor - 1.2); g.quadraticCurveTo(bx + 1, floor + 0.9, bx - 6.5, floor - 0.6); }
  else { g.moveTo(bx + 3.4, floor - 1); g.quadraticCurveTo(bx + 9 + tw * 2, floor - 1 - up * 2, bx + 8.2 + tw * 5, floor - 6.5 - groove * 3); }
  g.stroke();
  // body and head
  g.beginPath(); g.ellipse(bx, floor - bry, brx, bry, 0, 0, TAU); g.fill();
  g.beginPath(); g.arc(hx, hy, 2.9, 0, TAU); g.fill();
  const ear = (sx) => { g.beginPath(); g.moveTo(hx + sx * 0.7, hy - 2.1); g.lineTo(hx + sx * 2.5, hy - 4.6 - up * 0.5); g.lineTo(hx + sx * 2.9, hy - 1.2); g.closePath(); g.fill(); };
  ear(-1); ear(1);
  // light catching the fur from the candle side
  if (L > 0.05) { g.strokeStyle = `rgba(255,196,128,${0.5 * ss(0.05, 0.3, L)})`; g.lineWidth = 0.5; g.beginPath(); g.arc(hx, hy, 2.9, -1.1, 0.5); g.stroke(); g.beginPath(); g.ellipse(bx, floor - bry, brx, bry, 0, -1.2, 0.2); g.stroke(); }
  // open eyes once awake
  if (up > 0.6) { g.fillStyle = `rgba(214,240,160,${0.9 * ss(0.6, 1, up)})`; g.beginPath(); g.arc(hx - 1, hy - 0.2, 0.42, 0, TAU); g.arc(hx + 1.1, hy - 0.2, 0.42, 0, TAU); g.fill(); }
  // asleep: small z z z
  if (up < 0.3 && !still) {
    g.fillStyle = '#cfd6ff'; g.font = '600 3.4px sans-serif';
    for (let i = 0; i < 3; i++) { const k = (t * 0.32 + i / 3) % 1; g.globalAlpha = (1 - up / 0.3) * Math.sin(k * Math.PI) * 0.85; g.fillText('z', bx - 6 + k * 7 + Math.sin(k * 6) * 0.8, floor - 6 - k * 9); }
    g.globalAlpha = 1;
  }
}

function drawFox(g, L, t, still) {
  const k = ss(0.86, 0.97, L);
  if (k <= 0.01) return;
  const x = 241.5, y = 61.5 - k * 10.5 + (still ? 0 : Math.sin(t * 3.1) * 0.3);
  g.fillStyle = '#d8742c';
  g.beginPath(); g.moveTo(x - 4.6, y + 9); g.lineTo(x - 4.4, y - 0.4); g.lineTo(x - 3.4, y - 5.2); g.lineTo(x - 1.1, y - 1.8); g.lineTo(x + 1.1, y - 1.8); g.lineTo(x + 3.4, y - 5.2); g.lineTo(x + 4.4, y - 0.4); g.lineTo(x + 4.6, y + 9); g.closePath(); g.fill();
  g.fillStyle = '#fff3e2'; g.beginPath(); g.moveTo(x - 3.2, y + 1.6); g.lineTo(x, y + 4.4); g.lineTo(x + 3.2, y + 1.6); g.lineTo(x + 2.2, y + 9); g.lineTo(x - 2.2, y + 9); g.closePath(); g.fill();
  g.fillStyle = '#2a1a12'; g.beginPath(); g.arc(x, y + 4.2, 0.55, 0, TAU); g.fill();
  g.fillStyle = '#1b130e'; g.beginPath(); g.ellipse(x - 1.7, y + 0.9, 0.5, 0.26, 0.2, 0, TAU); g.ellipse(x + 1.7, y + 0.9, 0.5, 0.26, -0.2, 0, TAU); g.fill();
}

// store: { parts: [], notes: [], kind }  (one per control)
export function drawGarden(g, o) {
  const { L, t, beat = 0, px = 0, still = false, store } = o;
  const P = PAL[o.season] || PAL.autumn;
  const amb = ss(0.05, 0.72, L);
  const wind = still ? 0 : 0.25 + L * 0.9 + beat * 0.8;
  g.save();
  g.clearRect(0, 0, 254, 78);
  // ---- house across the garden ----
  g.save(); g.translate(px * 1.6, 0);
  g.fillStyle = '#2b2a36';
  g.beginPath(); g.moveTo(92, 34.5); g.quadraticCurveTo(100, 33, 108, 26.5); g.lineTo(228, 26.5); g.quadraticCurveTo(236, 33, 244, 34.5); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 0.35;
  for (let x = 112; x < 228; x += 4) { g.beginPath(); g.moveTo(x, 27); g.lineTo(x + (x - 168) * 0.07, 34); g.stroke(); }
  g.fillStyle = '#3a342f'; g.fillRect(98, 34.5, 140, 14.5);
  g.fillStyle = '#28221e'; g.fillRect(96, 48, 144, 1.6);
  g.restore();
  // ---- trees ----
  const tree = (list, trunk, shift) => {
    g.save(); g.translate(px * shift, 0);
    g.strokeStyle = '#2a1c18'; g.lineWidth = 1.6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(trunk[0], 53); g.quadraticCurveTo(trunk[1], 40, trunk[2], 30); g.stroke();
    g.lineWidth = 0.8; g.beginPath(); g.moveTo(trunk[1], 41); g.quadraticCurveTo(trunk[3], 34, trunk[4], 27); g.stroke();
    for (const [cx, cy, r, ci, ph] of list) {
      const sw = still ? 0 : Math.sin(t * 1.25 + ph) * 0.55 * wind;
      g.fillStyle = P.canopy[ci % P.canopy.length];
      g.beginPath(); g.arc(cx + sw, cy + sw * 0.3, o.season === 'winter' ? r * 0.62 : r, 0, TAU); g.fill();
    }
    g.restore();
  };
  tree(TREE_L, [66, 70, 76, 64, 62], 3.2);
  tree(TREE_R, [206, 201, 196, 214, 222], 3.2);
  // ---- garden floor: moss, shrubs, rocks, stone lantern ----
  g.save(); g.translate(px * 4.6, 0);
  const moss = g.createLinearGradient(0, 49, 0, 58); moss.addColorStop(0, P.moss); moss.addColorStop(1, '#2c3a26');
  g.fillStyle = moss; g.beginPath(); g.moveTo(-20, 58); g.lineTo(-20, 51); g.quadraticCurveTo(60, 48, 130, 50.5); g.quadraticCurveTo(200, 52.5, 274, 50); g.lineTo(274, 58); g.closePath(); g.fill();
  g.fillStyle = P.shrub;
  for (const [x, y, r] of [[18, 53, 6], [30, 52, 7.5], [44, 54, 5.5], [222, 54, 5], [236, 53, 7], [250, 54, 6]]) { g.beginPath(); g.ellipse(x, y, r, r * 0.55, 0, Math.PI, 0); g.fill(); }
  g.fillStyle = P.canopy[1];
  for (const [x, y] of [[15, 50.8], [21, 51.6], [28, 49.4], [33, 50.6], [43, 52], [221, 52.4], [233, 50.4], [239, 51.4], [249, 51.8]]) { g.beginPath(); g.arc(x, y, 0.6, 0, TAU); g.fill(); }
  g.fillStyle = '#7d7f86';
  g.beginPath(); g.moveTo(112, 55); g.lineTo(114, 48.5); g.lineTo(118.5, 46.6); g.lineTo(122.5, 49); g.lineTo(124, 55); g.closePath(); g.fill();
  g.fillStyle = '#8f9199';
  g.beginPath(); g.moveTo(127, 55); g.lineTo(128.6, 44.6); g.lineTo(132.4, 42.8); g.lineTo(136, 46); g.lineTo(137.4, 55); g.closePath(); g.fill();
  g.fillStyle = '#6f7178';
  g.beginPath(); g.moveTo(141, 55); g.lineTo(142.6, 50); g.lineTo(147, 48.6); g.lineTo(151, 51); g.lineTo(152, 55); g.closePath(); g.fill();
  if (o.season === 'winter') { g.fillStyle = '#f4f7fc'; for (const [x, y, w] of [[118.4, 47, 4], [132.3, 43.2, 3.6], [146.8, 49, 4]]) { g.beginPath(); g.ellipse(x, y, w, 0.9, 0, 0, TAU); g.fill(); } }
  // stone lantern
  g.fillStyle = '#5d5f66';
  g.fillRect(164.6, 53, 6.8, 2); g.fillRect(167, 46, 2, 7);
  g.fillRect(165.2, 41.4, 5.6, 4.6);
  g.beginPath(); g.moveTo(162.2, 41.6); g.quadraticCurveTo(165, 40.6, 166.2, 38.4); g.lineTo(169.8, 38.4); g.quadraticCurveTo(171, 40.6, 173.8, 41.6); g.closePath(); g.fill();
  g.beginPath(); g.arc(168, 37.6, 0.9, 0, TAU); g.fill();
  g.restore();
  // ---- things in the air (behind the room's frame) ----
  if (!still && store) {
    if (store.kind !== P.kind) { store.kind = P.kind; store.parts = []; }
    const want = P.kind === 'firefly' ? Math.round(7 * (1 - L * 0.6)) : P.kind === 'snow' ? Math.round(6 + L * 22) : Math.round(ss(0.22, 1, L) * 20 + (L > 0.02 ? 2 : 0));
    while (store.parts.length < want) store.parts.push({ x: 56 + rnd() * 190, y: P.kind === 'firefly' ? 34 + rnd() * 18 : 18 + rnd() * 4, v: 3.2 + rnd() * 4, r: rnd() * TAU, s: 0.9 + rnd() * 0.9, c: P.drift[Math.floor(rnd() * P.drift.length)], ph: rnd() * TAU });
    const dt = o.dt || 0.016;
    store.parts = store.parts.filter((q, i) => {
      if (P.kind === 'firefly') {
        q.x += Math.sin(t * 0.7 + q.ph) * 2.2 * dt; q.y += Math.cos(t * 0.9 + q.ph * 2) * 1.4 * dt;
        q.a = 0.35 + 0.65 * Math.max(0, Math.sin(t * 1.7 + q.ph * 3));
        return i < want;
      }
      q.y += q.v * (0.7 + wind * 0.6) * dt; q.x += (Math.sin(t * 1.4 + q.ph) * 3 - wind * 2.4) * dt; q.r += dt * (1 + wind) * (i % 2 ? 1 : -1);
      g.save(); g.translate(q.x + px * 4, q.y); g.rotate(q.r); g.fillStyle = q.c;
      if (P.kind === 'snow') { g.beginPath(); g.arc(0, 0, 0.42 * q.s, 0, TAU); g.fill(); }
      else if (P.kind === 'petal') { g.beginPath(); g.ellipse(0, 0, 0.95 * q.s, 0.55 * q.s, 0, 0, TAU); g.fill(); }
      else { g.beginPath(); g.moveTo(0, -1.1 * q.s); g.lineTo(0.8 * q.s, 0); g.lineTo(0, 1.1 * q.s); g.lineTo(-0.8 * q.s, 0); g.closePath(); g.fill(); }
      g.restore();
      return q.y < 57;
    });
  }
  drawFox(g, L, t, still);
  // ---- engawa ----
  g.save(); g.translate(px * 6.5, 0);
  const wood = g.createLinearGradient(0, 56, 0, 61.5); wood.addColorStop(0, '#8a6244'); wood.addColorStop(1, '#5a3d2a');
  g.fillStyle = wood; g.fillRect(-20, 56.5, 294, 5);
  g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 0.3;
  for (let x = -10; x < 270; x += 13) { g.beginPath(); g.moveTo(x, 56.5); g.lineTo(x - 1.4, 61.5); g.stroke(); }
  g.fillStyle = 'rgba(255,230,190,.25)'; g.fillRect(-20, 56.5, 294, 0.45);
  g.restore();
  // ---- the room: tatami, cushions, table ----
  g.save(); g.translate(px * 8.5, 0);
  const tat = g.createLinearGradient(0, 61, 0, 78); tat.addColorStop(0, '#6f6a45'); tat.addColorStop(1, '#4d4a32');
  g.fillStyle = tat; g.fillRect(-20, 61.5, 294, 17);
  g.strokeStyle = 'rgba(20,18,10,.55)'; g.lineWidth = 0.55;
  for (const x of [20, 94, 168, 242]) { g.beginPath(); g.moveTo(x, 61.5); g.lineTo(x + (x - 127) * 0.28, 78); g.stroke(); }
  g.beginPath(); g.moveTo(-20, 68.2); g.lineTo(274, 68.2); g.stroke();
  // cushions
  g.fillStyle = '#34304a'; rr(g, 97, 70.4, 31, 3.6, 1.8); g.fill();
  g.fillStyle = '#3a3552'; rr(g, 212, 70.8, 30, 3.4, 1.7); g.fill();
  // table
  g.fillStyle = '#1c1512'; rr(g, 148, 63.6, 56, 2.3, 0.7); g.fill();
  g.fillRect(151.5, 65.8, 2.2, 6.4); g.fillRect(198.3, 65.8, 2.2, 6.4);
  // cup and saucer
  g.fillStyle = '#d9d3c4'; g.beginPath(); g.ellipse(160, 63.3, 3.3, 0.6, 0, 0, TAU); g.fill();
  g.fillStyle = '#efeadb'; rr(g, 158.3, 60.8, 3.4, 2.4, 0.8); g.fill();
  // iron kettle
  g.fillStyle = '#121013';
  g.beginPath(); g.ellipse(173, 60.4, 5.2, 3.3, 0, 0, TAU); g.fill();
  g.beginPath(); g.moveTo(177.6, 59.6); g.lineTo(180.8, 57.4); g.lineTo(181.3, 58.2); g.lineTo(178, 61); g.closePath(); g.fill();
  g.beginPath(); g.arc(173, 56.9, 0.75, 0, TAU); g.fill();
  g.strokeStyle = '#121013'; g.lineWidth = 0.75; g.beginPath(); g.arc(173, 58.2, 4.6, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
  // candle holder
  g.fillStyle = 'rgba(240,220,190,.5)'; rr(g, 187, 60.2, 3.6, 3.4, 0.7); g.fill();
  drawCat(g, L, t, beat, still);
  g.restore();
  // ---- the frame of the room: ceiling, transom, beam, posts, a half-drawn screen ----
  g.save(); g.translate(px * 11, 0);
  g.fillStyle = '#16110f'; g.fillRect(-20, 0, 294, 13.4);
  g.fillStyle = '#2a211c'; g.fillRect(-20, 13.4, 294, 7);
  g.fillStyle = '#6a5c4a';
  for (let x = -12; x < 270; x += 15.5) g.fillRect(x, 14.4, 13.6, 5);
  g.strokeStyle = 'rgba(30,22,16,.7)'; g.lineWidth = 0.3;
  for (let x = -12; x < 270; x += 15.5) { g.beginPath(); g.moveTo(x + 4.5, 14.4); g.lineTo(x + 4.5, 19.4); g.moveTo(x + 9, 14.4); g.lineTo(x + 9, 19.4); g.moveTo(x, 16.9); g.lineTo(x + 13.6, 16.9); g.stroke(); }
  g.fillStyle = '#1b1411'; g.fillRect(-20, 20.2, 294, 1.9);
  g.fillRect(50.5, 13.4, 3.6, 48.6); g.fillRect(228.4, 13.4, 3.6, 48.6);
  // a rolled bamboo blind over the left bay
  g.fillStyle = '#7a6a48'; g.fillRect(-20, 22.1, 70.5, 3.4);
  g.strokeStyle = 'rgba(40,30,16,.6)'; g.lineWidth = 0.25;
  for (const y of [23, 24, 25]) { g.beginPath(); g.moveTo(-20, y); g.lineTo(50.5, y); g.stroke(); }
  g.fillStyle = '#5a4a30'; g.beginPath(); g.ellipse(15, 26.2, 36, 1.3, 0, 0, TAU); g.fill();
  // wind chime
  const sw = still ? 0.05 : Math.sin(t * 2.3) * (0.06 + L * 0.3 + beat * 0.35) * ss(0.2, 0.7, L + 0.2);
  g.strokeStyle = '#2a211c'; g.lineWidth = 0.3; g.beginPath(); g.moveTo(140, 22); g.lineTo(140, 25.4); g.stroke();
  g.fillStyle = 'rgba(190,225,240,.75)'; g.beginPath(); g.arc(140, 26.8, 1.9, Math.PI, 0); g.lineTo(141.9, 27.6); g.lineTo(138.1, 27.6); g.closePath(); g.fill();
  g.save(); g.translate(140, 27.6); g.rotate(sw); g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 0.25; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 2.6); g.stroke(); g.fillStyle = '#e8563c'; g.fillRect(-0.8, 2.6, 1.6, 4.6); g.restore();
  g.restore();

  // ---- night falls over everything drawn so far (the sky is still empty and is added last) ----
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = `rgba(9,12,38,${(0.8 * (1 - amb)).toFixed(3)})`;
  g.fillRect(0, 0, 254, 78);
  g.globalCompositeOperation = 'source-over';

  // ---- light ----
  const fl = still ? 0 : (Math.sin(t * 11.3) * 0.5 + Math.sin(t * 17.7) * 0.5) * (0.12 + beat * 0.3);
  // shoji across the garden
  g.save(); g.translate(px * 1.6, 0);
  for (let i = 0; i < 7; i++) {
    const on = ss(0.1 + i * 0.065, 0.17 + i * 0.065, L), x = 101.5 + i * 19.2;
    if (x + 16 < 56 || on <= 0) continue;
    g.fillStyle = `rgba(255,208,140,${0.94 * on})`; g.fillRect(x, 36.2, 16, 10.6);
    g.strokeStyle = `rgba(70,44,22,${0.8 * on})`; g.lineWidth = 0.3;
    g.beginPath(); g.moveTo(x + 5.3, 36.2); g.lineTo(x + 5.3, 46.8); g.moveTo(x + 10.6, 36.2); g.lineTo(x + 10.6, 46.8); g.moveTo(x, 39.7); g.lineTo(x + 16, 39.7); g.moveTo(x, 43.2); g.lineTo(x + 16, 43.2); g.stroke();
    glow(g, x + 8, 41.5, 13, '255,190,110', 0.14 * on);
  }
  g.restore();
  // what stands in front of those windows is drawn again, lit from behind and below
  const lit = ss(0.12, 0.6, L);
  if (lit > 0.01) {
    g.save(); g.translate(px * 3.2, 0); g.globalAlpha = 1;
    for (const list of [TREE_L, TREE_R]) for (const [cx, cy, r, ci, ph] of list) {
      const s2 = still ? 0 : Math.sin(t * 1.25 + ph) * 0.55 * wind;
      g.globalAlpha = lit * 0.92; g.fillStyle = P.canopy[ci % P.canopy.length];
      g.beginPath(); g.arc(cx + s2, cy + s2 * 0.3, o.season === 'winter' ? r * 0.62 : r, 0, TAU); g.fill();
    }
    g.globalAlpha = 1; g.restore();
  }
  // stone lantern
  const lan = ss(0.3, 0.42, L);
  g.save(); g.translate(px * 4.6, 0);
  if (lan > 0) { g.fillStyle = `rgba(255,214,150,${lan})`; g.fillRect(166.4, 42.4, 3.2, 2.8); glow(g, 168, 43.8, 9 + fl, '255,180,96', 0.42 * lan); }
  g.restore();
  // fireflies shine in the dark
  if (P.kind === 'firefly' && store && !still) for (const q of store.parts) { glow(g, q.x + px * 4, q.y, 2.6, '214,255,130', 0.85 * (q.a || 0)); }
  // room lights
  g.save(); g.translate(px * 11, 0);
  [62, 108, 154, 200].forEach((x, j) => {
    const on = ss(0.3 + j * 0.055, 0.4 + j * 0.055, L);
    if (on <= 0) return;
    const cone = g.createLinearGradient(0, 11, 0, 62); cone.addColorStop(0, `rgba(255,214,160,${0.2 * on})`); cone.addColorStop(1, 'rgba(255,214,160,0)');
    g.fillStyle = cone; g.beginPath(); g.moveTo(x - 1.6, 11); g.lineTo(x + 1.6, 11); g.lineTo(x + 15, 62); g.lineTo(x - 15, 62); g.closePath(); g.fill();
    g.fillStyle = `rgba(255,236,200,${on})`; g.beginPath(); g.ellipse(x, 10.6, 1.9, 0.75, 0, 0, TAU); g.fill();
    glow(g, x, 10.6, 5.5, '255,214,160', 0.5 * on);
  });
  const ran = ss(0.34, 0.62, L);
  if (ran > 0) { g.fillStyle = `rgba(255,210,150,${0.3 * ran})`; for (let x = -12; x < 270; x += 15.5) g.fillRect(x, 14.4, 13.6, 5); }
  g.restore();
  // candle, steam and notes on the table
  g.save(); g.translate(px * 8.5, 0);
  const fire = ss(0.02, 0.08, L);
  if (fire > 0) {
    glow(g, 188.8, 59, 24 + L * 20 + fl * 6, '255,170,84', (0.2 + L * 0.2) * fire);
    glow(g, 188.8, 59.4, 6, '255,220,150', 0.75 * fire);
    const fh = (2.6 + L * 1.5 + fl * 1.6) * fire;
    g.fillStyle = '#ffd98e'; g.beginPath(); g.moveTo(188.8, 60.6); g.quadraticCurveTo(187.5, 59.6 - fh * 0.3, 188.8 + fl * 0.5, 60.4 - fh); g.quadraticCurveTo(190.1, 59.6 - fh * 0.3, 188.8, 60.6); g.fill();
    g.fillStyle = '#fff6da'; g.beginPath(); g.ellipse(188.8, 60, 0.4, 0.75, 0, 0, TAU); g.fill();
    // warm edge on the table top and the kettle
    g.fillStyle = `rgba(255,190,120,${0.5 * fire})`; g.fillRect(150, 63.6, 52, 0.4);
    g.strokeStyle = `rgba(255,180,110,${0.55 * fire})`; g.lineWidth = 0.4; g.beginPath(); g.ellipse(173, 60.4, 5.2, 3.3, 0, -0.9, 0.5); g.stroke();
  }
  const steam = ss(0.2, 0.45, L);
  if (steam > 0 && !still) {
    g.strokeStyle = `rgba(255,255,255,${0.34 * steam})`; g.lineWidth = 0.5; g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.28 + i / 3) % 1, x = 181 + i * 0.6, y = 57 - k * 13;
      g.globalAlpha = Math.sin(k * Math.PI);
      g.beginPath(); g.moveTo(x, y + 4); g.quadraticCurveTo(x + Math.sin(t * 1.6 + i * 2) * 2.2, y + 2, x + Math.sin(t * 1.1 + i) * 1.4, y); g.stroke();
    }
    g.globalAlpha = 1;
  }
  const song = ss(0.55, 0.75, L);
  if (song > 0 && !still) {
    g.fillStyle = '#ffe9c2'; g.strokeStyle = '#ffe9c2'; g.lineWidth = 0.35;
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.22 + i / 3) % 1, x = 118 + i * 5 + Math.sin(k * 5 + i) * 2.4, y = 58 - k * 24;
      g.globalAlpha = Math.sin(k * Math.PI) * song * 0.9;
      g.beginPath(); g.ellipse(x, y, 0.95, 0.7, -0.4, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(x + 0.85, y - 0.2); g.lineTo(x + 0.85, y - 3.4); g.lineTo(x + 2.3, y - 2.7); g.stroke();
    }
    g.globalAlpha = 1;
  }
  g.restore();
  // fox eyes catch the light
  const fk = ss(0.9, 0.97, L);
  if (fk > 0) { const fy = 61.5 - ss(0.86, 0.97, L) * 10.5 + 0.9; glow(g, 239.8, fy, 1.5, '255,236,150', 0.9 * fk); glow(g, 243.2, fy, 1.5, '255,236,150', 0.9 * fk); }
  // ---- the sky goes in last, behind everything: moon, stars, then the night itself ----
  g.globalCompositeOperation = 'destination-over';
  g.save(); g.translate(px * 0.8, 0);
  g.fillStyle = '#f6f2e0'; g.beginPath(); g.arc(33, 32, 3.6, 0, TAU); g.fill();
  glow(g, 33, 32, 12, '205,220,255', 0.34);
  g.fillStyle = '#fff';
  for (const [x, y, r, ph] of STARS) { g.globalAlpha = 0.4 + 0.6 * (still ? 1 : Math.abs(Math.sin(t * 0.9 + ph))); g.beginPath(); g.arc(x, y + 8, r, 0, TAU); g.fill(); }
  g.globalAlpha = 1;
  g.restore();
  const sky = g.createLinearGradient(0, 18, 0, 54);
  sky.addColorStop(0, '#10163c'); sky.addColorStop(1, '#2c3a78');
  g.fillStyle = sky; g.fillRect(0, 0, 254, 78);
  g.globalCompositeOperation = 'source-over';
  g.restore();
}
