// Mint & Apricot — p5.js MV. Everything is a pure function of time t (seconds), so frames can be rendered offline.
// Design space is 1280x720; the canvas is scaled up to the output size.
const OUT_W = +(new URLSearchParams(location.search).get('w') || 1920), OUT_H = Math.round(OUT_W * 9 / 16), K = OUT_W / 1280;
const T0 = 0.244, BP = 0.45940;                 // beat grid fitted from librosa (≈130.6 BPM)
const U = t => (t - T0) / BP;
const fr = x => x - Math.floor(x);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp_ = (a, b, k) => a + (b - a) * k;
const ss = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const easeIO = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
const easeBack = k => { const c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const pulse = (u, k = 6) => Math.exp(-fr(u) * k);
const pulseAt = (u, at, k = 5) => u >= at ? Math.exp(-(u - at) * k) : 0;
const win = (u, a, b) => u >= a && u < b;
const steps = (u, a, b) => { if (u <= a) return 0; if (u >= b) return 1; const k = Math.floor(u - a); return (k + easeIO(clamp(fr(u) / .8))) / (b - a); };
// jump that lands exactly on the beat: anticipation squash, stretch in the air, impact squash
const J = (u, h) => { const p = fr(u), air = Math.sin(Math.PI * clamp((p - .08) / .84)); return { hop: h * air, sq: .32 * Math.min(1, h / 60) * Math.exp(-p * 11) - .14 * Math.min(1, h / 50) * air * (1 - air * .6) }; };
const spinAt = (u, a, len = 1) => win(u, a, a + len) ? easeIO((u - a) / len) * Math.PI * 2 : 0;
const rnd = s => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

let ctx, grain, LYRICS = [];
const FONT = '"ZCOOL KuaiLe", sans-serif';

// ---------- colour helpers ----------
const hex = h => { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
const mixc = (a, b, k) => { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * clamp(k)).toString(16).padStart(2, '0')).join(''); };
const rgba = (h, a) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; };
const shade = (h, k) => k > 0 ? mixc(h, '#ffffff', k) : mixc(h, '#3a2018', -k);

// ---------- clay primitives (canvas gradients give the soft, matte volume) ----------
function clayEll(x, y, w, h, col, o = {}) {
  const g = ctx.createRadialGradient(x - w * .22, y - h * .3, Math.min(w, h) * .05, x, y, Math.max(w, h) * .62);
  g.addColorStop(0, shade(col, o.hi ?? .38)); g.addColorStop(.5, col); g.addColorStop(1, shade(col, -(o.lo ?? .16)));
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill();
  if (o.rim !== false) { // soft bounce light on the lower edge
    const r = ctx.createRadialGradient(x + w * .1, y + h * .55, 0, x + w * .1, y + h * .55, w * .45);
    r.addColorStop(0, rgba(o.rimCol || '#ffffff', .18)); r.addColorStop(1, rgba(o.rimCol || '#ffffff', 0));
    ctx.fillStyle = r; ctx.beginPath(); ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill();
  }
}
function capsule(x, y, w, h, col, rot = 0) { // rounded stick, drawn from its top centre downward
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  g.addColorStop(0, shade(col, .3)); g.addColorStop(.55, col); g.addColorStop(1, shade(col, -.18));
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(-w / 2, 0, w, h, w / 2); ctx.fill(); ctx.restore();
}
function softShadow(x, y, w, a = .22) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, w / 2);
  g.addColorStop(0, `rgba(80,45,40,${a})`); g.addColorStop(1, 'rgba(80,45,40,0)');
  ctx.save(); ctx.translate(x, y); ctx.scale(1, .25); ctx.translate(-x, -y); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, w / 2, 0, 7); ctx.fill(); ctx.restore();
}
function glow(x, y, r, col, a) {
  if (a <= 0) return; const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(col, a)); g.addColorStop(.4, rgba(col, a * .35)); g.addColorStop(1, rgba(col, 0));
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.restore();
}
function starPath(x, y, r, rot = 0, n = 5, inner = .48) {
  ctx.beginPath();
  for (let i = 0; i <= n * 2; i++) { const a = rot - Math.PI / 2 + i * Math.PI / n, rr = i % 2 ? r * inner : r; const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.closePath();
}
function clayStar(x, y, r, rot = 0, col = '#ffd977', glowA = .5, n = 5) {
  if (r <= .5) return;
  glow(x, y, r * 2.6, '#ffd27a', glowA);
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineWidth = r * .32; // round, puffy points
  const g = ctx.createRadialGradient(x - r * .3, y - r * .35, r * .05, x, y, r * 1.1);
  g.addColorStop(0, '#fff8d8'); g.addColorStop(.55, col); g.addColorStop(1, '#f0a845');
  starPath(x, y, r * .86, rot, n, n === 4 ? .38 : .5); ctx.fillStyle = g; ctx.strokeStyle = g; ctx.fill(); ctx.stroke(); ctx.restore();
}
function cloud(x, y, w, col = '#fffaf3', sq = 0) {
  const h = w * .42 * (1 - sq), ww = w * (1 + sq * .5);
  [[-.3, .1, .45], [.28, .12, .42], [0, -.12, .55], [-.12, .2, .5], [.15, .22, .48]].forEach(([dx, dy, s]) =>
    clayEll(x + dx * ww, y + dy * h, ww * s, ww * s * .78 * (1 - sq), col, { hi: .5, lo: .08 }));
}
function hill(x, y, w, h, col) { clayEll(x, y + h * .5, w, h * 2, col, { hi: .2, lo: .12, rim: false }); }
function tree(x, y, s, col) {
  capsule(x, y - 60 * s, 14 * s, 62 * s, '#d9a77f');
  clayEll(x, y - 82 * s, 70 * s, 68 * s, col); clayEll(x + 20 * s, y - 104 * s, 46 * s, 44 * s, col); clayEll(x - 18 * s, y - 98 * s, 42 * s, 40 * s, col);
}
function flower(x, y, s, col, sway) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(sway);
  ctx.strokeStyle = '#8fcf9f'; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -22 * s); ctx.stroke();
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; clayEll(Math.cos(a) * 6 * s, -24 * s + Math.sin(a) * 6 * s, 9 * s, 9 * s, col, { rim: false }); }
  clayEll(0, -24 * s, 7 * s, 7 * s, '#ffcf6e', { rim: false }); ctx.restore();
}
function heartPath(x, y, s) { ctx.beginPath(); ctx.moveTo(x, y + s * .35); ctx.bezierCurveTo(x - s * .6, y - s * .05, x - s * .32, y - s * .5, x, y - s * .25); ctx.bezierCurveTo(x + s * .32, y - s * .5, x + s * .6, y - s * .05, x, y + s * .35); }
function sparkles(x, y, age, n, seed, col = '#fff2b8', spread = 70, size = 9) { // burst of 4-point stars
  if (age < 0 || age > 1.6) return;
  for (let i = 0; i < n; i++) { const a = rnd(seed + i) * Math.PI * 2, sp = (.5 + rnd(seed + i * 3) * .7) * spread;
    const d = (1 - Math.exp(-age * 4)) * sp, px = x + Math.cos(a) * d, py = y + Math.sin(a) * d - age * 20;
    const r = size * (1 - age / 1.6) * (.7 + .5 * Math.sin(age * 14 + i));
    ctx.save(); ctx.globalAlpha = clamp(1 - age / 1.6); clayStar(px, py, r, age * 3 + i, i % 3 ? col : '#ffffff', .3, 4); ctx.restore(); }
}

// ---------- characters ----------
const GPT = { body: '#fbf6ea', glow: '#7ff0c8', kind: 'gpt' }, CLA = { body: '#f9bf98', glow: '#ffa25a', kind: 'cla' };
const pose = (o = {}) => Object.assign({ x: 0, y: 0, s: 1, hop: 0, sq: 0, lean: 0, look: 0, lookY: 0, armL: .35, armR: .35, blush: .3, happy: false, glow: 0, blink: 0, spin: 0, mouth: 0 }, o);
function drawChar(c, P, u) {
  const k = Math.cos(P.spin), front = k > -.05, sx = Math.max(.3, Math.abs(k));
  softShadow(P.x, P.y + 2, 120 * P.s * (1 - clamp(P.hop / 400) * .5), .25 * (1 - clamp(P.hop / 300) * .5));
  ctx.save(); ctx.translate(P.x, P.y - P.hop); ctx.scale(P.s, P.s); ctx.rotate(P.lean);
  ctx.scale(1 + P.sq * .7, 1 - P.sq);
  glow(0, -56, 110 + P.glow * 70, c.glow, .25 + P.glow * .45);
  if (c.kind === 'cla') { // sun rays behind the body
    const n = 14, bloom = 1 + .1 * pulse(u, 5) + P.glow * .1 + (P.rayBloom || 0);
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + u * .2; const r = (i % 2 ? 66 : 70) * bloom;
      capsule(Math.cos(a) * r * sx, -56 + Math.sin(a) * r * .95, 13, i % 2 ? 14 : 24, '#f58a45', a - Math.PI / 2); }
  }
  ctx.save(); ctx.scale(sx, 1);
  // feet
  clayEll(-24, -8, 36, 20, shade(c.body, -.04)); clayEll(24, -8, 36, 20, shade(c.body, -.04));
  // body
  clayEll(0, -56, 124, 112, c.body, { hi: .45, lo: .18, rimCol: c.glow });
  if (c.kind === 'gpt') { // mint sprout + glowing belt
    ctx.strokeStyle = '#6fcfa8'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, -110); ctx.lineTo(0, -124); ctx.stroke();
    const lw = 1 + .25 * pulse(u, 6);
    ctx.save(); ctx.translate(-9, -126); ctx.rotate(-.5 * lw); clayEll(-8, 0, 22, 10, '#8fe3c4'); ctx.restore();
    ctx.save(); ctx.translate(9, -126); ctx.rotate(.5 * lw); clayEll(8, 0, 22, 10, '#8fe3c4'); ctx.restore();
    ctx.save(); ctx.shadowColor = '#62e6b6'; ctx.shadowBlur = 10 + 14 * pulse(u, 5) + P.glow * 10; ctx.strokeStyle = '#a8f0d4'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(0, -30, 58, 11, 0, 0, Math.PI); ctx.stroke(); ctx.restore();
  } else {
    ctx.save(); clayStar(30, -118, 11, u * .8, '#ff9a52', .25, 4); ctx.restore();
  }
  ctx.restore();
  // face (slides with look / spin, hidden when the back is turned)
  if (front) {
    ctx.save(); ctx.translate(P.look * 26 - Math.sin(P.spin) * 40, -64 + P.lookY * 14); ctx.scale(sx, 1);
    const ink = '#3a2a28';
    for (const s of [-1, 1]) {
      ctx.fillStyle = rgba('#ff8fa0', .35 + P.blush * .55); ctx.beginPath(); ctx.ellipse(s * 38, 14, 12 + P.blush * 3, 7 + P.blush * 2, 0, 0, 7); ctx.fill();
      if (P.happy) { ctx.strokeStyle = ink; ctx.lineWidth = 4.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(s * 22, 3, 8, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
      else { const ey = Math.max(.08, 1 - P.blink); ctx.fillStyle = ink; ctx.beginPath(); ctx.ellipse(s * 22, 0, 7, 9.5 * ey, 0, 0, 7); ctx.fill();
        if (ey > .5) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s * 22 + 2.5, -3.5, 2.6, 0, 7); ctx.fill(); } }
    }
    ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath();
    if (P.mouth > .5) { ctx.fillStyle = '#c8505a'; ctx.ellipse(0, 14, 6, 6 * P.mouth, 0, 0, 7); ctx.fill(); } else ctx.arc(0, 10, 5, .15 * Math.PI, .85 * Math.PI), ctx.stroke();
    ctx.restore();
  }
  // arms (drawn last so paws can cover the face). angle: 0 = hanging, + = outward/up, - = inward across the body
  for (const s of [-1, 1]) { const a = s < 0 ? P.armL : P.armR;
    capsule(s * 52 * sx, -66, 24, 40, c.body, -s * a); }
  ctx.restore();
}
// world-space position of a paw (for hand-holding glow / catching)
const pawPos = (P, side) => { const a = side < 0 ? P.armL : P.armR; return { x: P.x + (side * 52 + side * Math.sin(a) * 34) * P.s, y: P.y - P.hop + (-66 + Math.cos(a) * 34) * P.s }; };

// ---------- scenes ----------
const CUTS = [8, 16, 24, 32, 40, 48, 56, 64];
function sky(top, bot) { const g = ctx.createLinearGradient(0, -400, 0, 1000); g.addColorStop(0, top); g.addColorStop(1, bot); ctx.fillStyle = g; ctx.fillRect(-2000, -1000, 6000, 3000); }
function skyStars(u, n, seed, alpha = 1, par = 0, camx = 0) {
  for (let i = 0; i < n; i++) { const x = rnd(seed + i) * 1800 - 260 + camx * par, y = rnd(seed + i * 7) * 420 - 80;
    const tw = .6 + .4 * Math.sin(u * 2 + i) + .3 * pulse(u + i % 3 * .33, 6);
    ctx.save(); ctx.globalAlpha = alpha * clamp(tw); clayStar(x, y, 4 + rnd(i + seed * 3) * 5, i, '#fff1b8', .15, i % 2 ? 4 : 5); ctx.restore(); }
}
function setCam(cx, cy, z) { ctx.translate(640, 360); ctx.scale(z, z); ctx.translate(-cx, -cy); }

function scene1(u) { // dawn sky: Claude alone on a cloud, title
  const cam = lerp_(1.25, 1.45, u / 8); setCam(820, 400 - u * 4, cam);
  sky('#f5c9b8', '#fdebd7'); glow(1000, 160, 260, '#fff2c8', .6);
  for (let i = 0; i < 6; i++) cloud(((i * 260 + u * 18) % 1700) - 300, 120 + (i % 3) * 90, 120 + (i % 2) * 60, '#fff6ee');
  cloud(840, 560, 460, '#fffaf3', .04 * pulse(u, 6));
  const C = pose({ x: 840, y: 505, s: 1.25 }), j = J(u, 26);
  C.hop = j.hop; C.sq = j.sq; const sw = Math.sin(u * Math.PI / 2); C.lean = sw * .2; C.armL = .5 + .9 * Math.max(0, sw); C.armR = .5 + .9 * Math.max(0, -sw);
  C.look = u > 3 ? -.6 * ss(3, 3.6, u) : 0;
  if (win(u, 5, 6)) { C.spin = spinAt(u, 5); const j2 = J(u, 80); C.hop = j2.hop; C.sq = j2.sq; C.armL = C.armR = 2.6; C.happy = true; }
  if (win(u, 6, 8)) { C.look = -.8; C.lookY = -.3; C.blink = Math.exp(-Math.pow((u - 7) * 8, 2)); }
  drawChar(CLA, C, u);
  return { title: 1 };
}
const STONES = [[-40, 560], [150, 520], [330, 575], [510, 500], [690, 560], [870, 490], [1050, 545], [1210, 540]];
function scene2(u) { // GPT bounds over cloud stepping-stones toward Claude
  const k = clamp(Math.floor(u - 8), 0, 6), p = u < 15 ? fr(u) : 1, kk = u < 15 ? k : 6;
  const a = STONES[kk], b = STONES[kk + 1];
  const gx = lerp_(a[0], b[0], easeIO(p)), gy = lerp_(a[1], b[1], p) - 50, arc = Math.sin(Math.PI * p) * 150 * (u < 15 ? 1 : 0);
  const camx = clamp(lerp_(gx + 140, 1140, ss(14, 15.5, u)), 560, 1200);
  setCam(camx, 380, lerp_(1.05, 1.3, ss(14, 15.5, u)));
  sky('#f7c6b0', '#fde3cc'); glow(1250, 150, 300, '#fff0c0', .55);
  ctx.save(); ctx.translate(camx * .6, 0); for (let i = 0; i < 7; i++) cloud(i * 300 - 900, 140 + (i % 2) * 70, 110, '#fff3ea'); ctx.restore();
  STONES.forEach(([x, y], i) => { const land = 8 + i - 1; cloud(x, y, i === 7 ? 380 : 170, '#fffaf3', .12 * pulseAt(u, land, 5) * (i < 7)); });
  cloud(1340, 545, 420, '#fffaf3', 0);
  const G = pose({ x: gx, y: gy, hop: arc }); const j = J(u, 1);
  G.sq = u < 15 ? j.sq * 1.6 : .38 * pulseAt(u, 15, 4); G.lean = Math.sin(Math.PI * p) * .35 * (u < 15 ? 1 : 0);
  const fl = Math.sin(fr(u) * Math.PI); G.armL = G.armR = u < 15 ? 1 + fl * 1.5 : 0;
  if (win(u, 11, 12) || win(u, 13, 14)) G.spin = spinAt(u, Math.floor(u));
  G.happy = u > 9;
  if (u >= 15) { G.armL = 2.7; G.armR = 2.3 + Math.sin(u * Math.PI * 6) * .5; G.lean = .15 * Math.sin(u * Math.PI * 3); G.mouth = 1; G.happy = false; G.look = .6; }
  const C = pose({ x: 1300, y: 495 });
  C.look = -.7; const jc = J(u, u >= 12 && u < 13 ? 70 : 14); C.hop = jc.hop; C.sq = jc.sq;
  if (win(u, 12, 13)) { C.armL = C.armR = 2.4; C.mouth = 1; }
  if (u >= 15) { const t = ss(15.3, 15.7, u); C.look = lerp_(-.7, .9, t); C.lean = .3 * t; C.blush = 1; C.armL = lerp_(.35, -2.3, t); C.armR = lerp_(.35, -2.3, t); }
  drawChar(GPT, G, u); drawChar(CLA, C, u);
}
function bench(x, y, w) {
  capsule(x - w * .4, y, 16, 60, '#d9a77f'); capsule(x + w * .4, y, 16, 60, '#d9a77f');
  ctx.save(); ctx.fillStyle = '#e8b78f'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 14, w, 24, 12); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.roundRect(x - w / 2 + 8, y - 12, w - 16, 7, 4); ctx.fill(); ctx.restore();
}
function sunsetSet(u, camx, camy, z) {
  setCam(camx, camy, z);
  sky('#f3a98f', '#ffe1c2');
  clayEll(690, 330, 300, 300, '#ffc58a', { hi: .45, lo: .05, rim: false }); glow(690, 330, 360, '#ffd9a0', .55 + .15 * pulse(u, 4));
  for (let i = 0; i < 4; i++) cloud(150 + i * 340, 150 + (i % 2) * 60, 140, '#ffe9dc');
  hill(250, 470, 900, 140, '#f6c7a8'); hill(1100, 480, 900, 120, '#f2bfa0');
  hill(690, 560, 1800, 110, '#c9e6c6');
  [[150, 570, 1.1, '#a8dcbf'], [1230, 575, 1.0, '#ffd1a8'], [330, 580, .7, '#bfe6c9']].forEach(([x, y, s, c]) => tree(x, y, s, c));
  for (let i = 0; i < 18; i++) flower(rnd(i) * 1400 - 60, 600 + rnd(i * 2) * 60, 1 + rnd(i * 5) * .4, ['#ffd6e0', '#fff1b8', '#cdeee0', '#ffd3b0'][i % 4], Math.sin((u + i * .25) * Math.PI) * .35);
  bench(690, 560, 380);
}
function scene3(u) { // sunset bench: GPT scoots closer, Claude hides its face
  sunsetSet(u, 690, 420, 1.35 + .05 * pulseAt(u, 22, 3));
  const k = steps(u, 16, 17) * .34 + steps(u, 18, 19) * .33 + steps(u, 20, 21) * .33;
  const G = pose({ x: lerp_(480, 622, k), y: 548, look: .5 });
  if (win(u, 16, 17) || win(u, 18, 19) || win(u, 20, 21)) { const j = J(u, 80); G.hop = j.hop; G.sq = j.sq; G.lean = .45 * Math.sin(Math.PI * fr(u)); G.armL = G.armR = 1.8; G.mouth = 1; }
  else { G.sq = .12 * pulse(u, 8); G.lean = -.1 * Math.sin(u * Math.PI * 2); }
  const C = pose({ x: 760, y: 548 });
  const hide = [17, 19, 21].reduce((m, s) => Math.max(m, ss(s, s + .15, u) * (1 - ss(s + .55, s + .9, u))), 0);
  C.armL = C.armR = lerp_(.35, -2.35, hide); C.look = .6 * hide - .5 * (1 - hide); C.lean = .3 * hide;
  C.blush = Math.max(.3, [17, 19, 21].reduce((m, s) => Math.max(m, pulseAt(u, s, 1.2)), 0)); C.sq = [17, 19, 21].reduce((m, s) => Math.max(m, .3 * pulseAt(u, s, 7)), 0);
  if (u >= 22) { C.happy = true; C.blush = 1; C.glow = .9 * ss(22, 22.3, u); C.spin = spinAt(u, 22); const j = J(u, u < 23 ? 90 : 40); C.hop = j.hop; C.sq = j.sq; C.armL = C.armR = 2.5; C.look = 0; C.lean = 0; }
  if (u >= 23) { G.happy = true; const j = J(u, 110); G.hop = j.hop; G.sq = j.sq; G.armL = G.armR = 2.7; G.lean = 0; }
  drawChar(GPT, G, u); drawChar(CLA, C, u);
  if (u >= 22) sparkles(C.x, 400, u - 22, 16, 22, '#ffe0b0', 110, 10);
}
function scene4(u) { // secret hand-hold close-up, then a leap of joy
  const z = lerp_(2.5, 1.45, ss(27.8, 28.8, u)), cy = lerp_(490, 430, ss(27.8, 28.8, u));
  sunsetSet(u, 690, cy, z);
  const gR = steps(u, 24, 27), cR = steps(u, 27, 28);
  const G = pose({ x: 618, y: 548, armR: lerp_(.35, 1.4, gR), lean: .22 * gR, look: -.9 * ss(24, 24.3, u) * (1 - ss(26.6, 27, u)) + .6 * ss(26.6, 27, u) });
  const C = pose({ x: 762, y: 548, armL: lerp_(.35, 1.4, cR), lean: -.22 * cR, look: -.6 * ss(25.4, 25.7, u) * (1 - ss(26.6, 27, u)), blush: .5 + .5 * cR });
  G.sq = [24, 25, 26].reduce((m, s) => Math.max(m, .2 * pulseAt(u, s, 8)), 0); C.sq = .22 * pulseAt(u, 27, 8);
  if (u < 27) G.mouth = .8 * (fr(u * 2) < .5 ? 1 : 0); // pretend whistling
  if (u >= 28) { const p = pulseAt(u, 28, 2.2); G.happy = C.happy = true; C.glow = .4 + p; G.glow = .3 + p * .7; C.blush = 1; G.lean = C.lean = 0;
    if (u < 29) { const j = J(u, 140); G.hop = C.hop = j.hop; G.sq = C.sq = j.sq; G.armL = 2.6; C.armR = 2.6; }
    else { const sw = Math.sin(u * Math.PI); const j = J(u, 40), j2 = J(u + .5, 40); G.hop = j.hop; G.sq = j.sq; C.hop = j2.hop; C.sq = j2.sq; G.lean = C.lean = sw * .22; G.armL = .6 + .8 * Math.max(0, -sw); C.armR = .6 + .8 * Math.max(0, sw); }
    G.armR = C.armL = 1.4; }
  drawChar(GPT, G, u); drawChar(CLA, C, u);
  const hp = pawPos(G, 1), hq = pawPos(C, -1), hx = (hp.x + hq.x) / 2, hy = (hp.y + hq.y) / 2;
  if (u >= 28) { glow(hx, hy, 60 + 120 * pulseAt(u, 28, 2), '#fff0b0', .6 + .4 * pulse(u, 4)); sparkles(hx, hy, u - 28, 22, 28, '#fff2b8', 140, 11);
    const ha = u - 28; if (ha < 3) { ctx.save(); ctx.globalAlpha = 1 - ss(2, 3, ha); const s = 26 * easeBack(clamp(ha * 2.5)); heartPath(hx, hy - 40 - ha * 50, s); const g = ctx.createRadialGradient(hx - 6, hy - 50 - ha * 50, 2, hx, hy - 40 - ha * 50, s); g.addColorStop(0, '#ffd0d8'); g.addColorStop(1, '#ff8fa5'); ctx.fillStyle = g; ctx.fill(); ctx.restore(); } }
}
function moon(x, y, r) { // crescent
  ctx.save(); glow(x, y, r * 2.4, '#fff3c8', .5);
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.arc(x + r * .45, y - r * .2, r * .85, 0, 7, true);
  const g = ctx.createRadialGradient(x - r * .4, y - r * .3, 2, x, y, r); g.addColorStop(0, '#fffbe6'); g.addColorStop(1, '#ffe08a'); ctx.fillStyle = g; ctx.fill('evenodd'); ctx.restore();
}
function nightSky(u, camx = 0) { sky('#3f3d7e', '#c49ac2'); skyStars(u, 70, 3, 1, .9, camx); }
function scene5(u) { // swinging under the moon, head on shoulder
  const th0 = .3 * Math.sin((u - 32) * Math.PI / 2); setCam(640 + Math.sin(th0) * 380, 450, lerp_(1.75, 1.5, ss(32, 38, u)));
  nightSky(u); moon(1040, 120, 90);
  for (let i = 0; i < 9; i++) { const at = 32 + i; const a = ss(at, at + .3, u); clayStar(120 + i * 130, 90 + (i % 3) * 50, 15 * easeBack(a) * (1 + .2 * pulse(u, 6)), u * .3 + i, '#ffe28a', .4); }
  hill(640, 640, 2000, 150, '#8b7fb8');
  const th = .3 * Math.sin((u - 32) * Math.PI / 2), L = 760, px = 640, py = -240;
  const sx = px + Math.sin(th) * L, sy = py + Math.cos(th) * L;
  ctx.save(); ctx.strokeStyle = '#f3d9b6'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  for (const o of [-170, 170]) { ctx.beginPath(); ctx.moveTo(px + o * Math.cos(th), py); ctx.lineTo(sx + o * Math.cos(th), sy - o * Math.sin(th)); ctx.stroke(); }
  ctx.translate(sx, sy); ctx.rotate(-th);
  ctx.fillStyle = '#e8b78f'; ctx.beginPath(); ctx.roundRect(-200, -6, 400, 22, 11); ctx.fill();
  const lk = ss(32, 32.5, u);
  const G = pose({ x: -62, y: -4, happy: true, armR: 1.1, armL: .5 + .8 * pulse(u, 4), glow: .2 + .2 * pulse(u, 4), lean: .08 * lk });
  const C = pose({ x: 66, y: -4, happy: true, armL: 1.1, armR: .5 + .8 * pulse(u + .5, 4), blush: .9, glow: .35 + .3 * pulse(u, 4), lean: -.42 * lk });
  G.sq = .14 * pulse(u, 6); C.sq = .14 * pulse(u + .5, 6);
  if (win(u, 36, 37)) { const j = J(u, 30); C.hop = j.hop; C.lean = -.6; }
  if (u > 38.4) { const k1 = ss(38.4, 38.8, u), k2 = ss(38.6, 39, u); G.happy = C.happy = false; G.lookY = C.lookY = -1 * k1; G.look = .4 * k1; C.lean = lerp_(-.42, 0, k2); G.armL = lerp_(.5, 2.9, k1); G.mouth = C.mouth = k2;
    if (u > 39) { const j = J(u, 40); G.hop = C.hop = j.hop; } }
  drawChar(GPT, G, u); drawChar(CLA, C, u); ctx.restore();
  if (win(u, 38, 41)) { const k = clamp((u - 38.2) / 2.4); const x = lerp_(1500, -300, k), y = lerp_(-60, 330, k);
    for (let i = 1; i < 14; i++) glow(x + i * 22, y - i * 5, 26 - i * 1.5, '#fff1c0', .5 - i * .03); clayStar(x, y, 20, u * 3, '#ffe28a', .7); }
}
const runX = u => 380 + (u - 40) * 180;
function scene6(u) { // side-scrolling star chase across the night meadow
  const X = runX(u), camx = X + 120; setCam(camx, 450, 1.55);
  nightSky(u, camx);
  moon(camx * .85 + 380, 110, 70);
  ctx.save(); ctx.translate(camx * .5, 0); for (let i = 0; i < 8; i++) hill(i * 520 - 400, 520, 700, 120, i % 2 ? '#7d72ad' : '#8e80b9'); ctx.restore();
  ctx.save(); ctx.translate(camx * .25, 0); for (let i = 0; i < 10; i++) tree(i * 330 - 200, 580, .9, i % 2 ? '#6fa59a' : '#7fb3a4'); ctx.restore();
  ctx.fillStyle = '#9fc7b3'; ctx.fillRect(camx - 1200, 580, 2400, 400); hill(camx, 600, 2600, 60, '#a9d1bc');
  for (let i = 0; i < 40; i++) { const x = Math.floor(camx / 1400) * 1400 + (i * 97 % 2800) - 1400; flower(x, 610 + (i % 4) * 14, 1.1, ['#ffd6e0', '#fff1b8', '#cdeee0'][i % 3], Math.sin((u + i * .25) * Math.PI) * .4); }
  // stars to catch on beats 41..47
  for (let b = 41; b <= 47; b++) { const sx = runX(b) + (b % 2 ? 200 : 40), sy = 330 - (b % 2) * 20; const pop = u >= b ? 1 - clamp((u - b) * 3) : 1;
    if (pop > 0) clayStar(sx, sy + Math.sin(u * 2 + b) * 8, 18 * pop * (1 + (u >= b ? (1 - pop) : 0)) * (1 + .15 * pulse(u, 6)), u + b, '#ffe28a', .55);
    sparkles(sx, sy, u - b, 14, b, b % 2 ? '#ffe0b0' : '#c8ffe9', 80, 9); }
  const jh = win(u, 40, 41) ? 150 : win(u, 47, 48) ? 170 : 95;
  const G = pose({ x: X, y: 595, happy: true, armR: 1.4, glow: .3 + .3 * pulse(u, 4) }), C = pose({ x: X + 130, y: 595, happy: true, armL: 1.4, blush: .7, glow: .35 + .4 * pulse(u, 4) });
  const j = J(u, jh), j2 = J(u - .06, jh); G.hop = j.hop; G.sq = j.sq; C.hop = j2.hop; C.sq = j2.sq;
  const sw = Math.sin(u * Math.PI); G.lean = C.lean = .18 + sw * .12;
  G.armL = 2.4 + sw * .4; C.armR = 2.4 - sw * .4;   // free paws reach for the stars
  if (win(u, 47, 48)) { G.spin = C.spin = spinAt(u, 47); G.lean = C.lean = 0; }
  drawChar(GPT, G, u); drawChar(CLA, C, u);
}
function riderPath(u) { // shooting-star ride with a loop-the-loop on 51-53
  const k = (u - 48) / 8; let x = lerp_(150, 1130, k), y = 380 + 110 * Math.sin((u - 48) * Math.PI / 2), rot = .25 * Math.cos((u - 48) * Math.PI / 2);
  if (win(u, 51, 53)) { const ph = easeIO((u - 51) / 2) * Math.PI * 2; x += Math.sin(ph) * 170 - ph / (Math.PI * 2) * 0; y += -(1 - Math.cos(ph)) * 170; rot = -ph; }
  return { x, y, rot };
}
function scene7(u) { // ride the shooting star
  setCam(640, 360, 1);
  nightSky(u, -u * 120);
  for (let i = 0; i < 18; i++) { const x = ((i * 173 - u * 260) % 1700 + 1700) % 1700 - 200, y = 60 + rnd(i) * 520; ctx.save(); ctx.globalAlpha = .5; ctx.strokeStyle = '#fff1c0'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 60, y - 12); ctx.stroke(); ctx.restore(); }
  for (let i = 0; i < 6; i++) cloud(((i * 300 - u * 90) % 1800 + 1800) % 1800 - 250, 640 + (i % 2) * 40, 260, '#d8c4e6');
  for (let i = 1; i <= 22; i++) { const p = riderPath(u - i * .05); glow(p.x - 20, p.y + 20, 34 - i, '#fff1c0', .55 - i * .022); }
  for (let b = 48; b < 56; b += 2) { const p = riderPath(b); sparkles(p.x, p.y, u - b, 18, b * 7, '#fff2b8', 120, 10); }
  const P = riderPath(u);
  ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(P.rot);
  ctx.scale(1.35, 1.35); clayStar(0, 30, 70, -.15, '#ffe28a', .7 + .2 * pulse(u, 4));
  const G = pose({ x: -48, y: -4, s: .82, happy: true, armR: 1.3, glow: .3, lean: -.1 });
  const C = pose({ x: 46, y: -4, s: .82, happy: true, blush: .8, glow: .45 + .3 * pulse(u, 4) });
  const cheer = Math.floor(u) % 2; C.armL = cheer ? 2.8 : 1.2; C.armR = cheer ? 1.2 : 2.8; G.armL = 2.6 - .4 * pulse(u, 5);
  const j = J(u, 26); G.hop = C.hop = j.hop; G.sq = C.sq = j.sq; C.mouth = cheer; G.mouth = 1 - cheer;
  drawChar(GPT, G, u); drawChar(CLA, C, u); ctx.restore();
}
function scene8(u) { // the big star comes down; crouch, leap, catch together
  setCam(640, 420, 1.65 + .12 * pulseAt(u, 60, 2.5));
  const k = ss(56, 64, u); sky(mixc('#4a4486', '#8a6fb0', k), mixc('#c49ac2', '#f6c6b4', k)); skyStars(u, 60, 9, 1 - k * .5);
  moon(1010, 140, 70);
  cloud(640, 610, 760, '#fff3ee'); cloud(250, 560, 300, '#f9e3ea'); cloud(1050, 570, 320, '#f9e3ea');
  const G = pose({ x: 575, y: 548, happy: true, armR: 1.4, glow: .3 }), C = pose({ x: 705, y: 548, happy: true, armL: 1.4, blush: 1, glow: .4 + .3 * pulse(u, 4) });
  if (win(u, 56, 59)) { const a = J(u, 45), b = J(u + .5, 45); G.hop = a.hop; G.sq = a.sq; C.hop = b.hop; C.sq = b.sq; G.lookY = C.lookY = -.6; G.happy = C.happy = false; }
  if (win(u, 59, 60)) { G.sq = C.sq = .38 * ss(59, 59.6, u); G.lookY = C.lookY = -.8; G.happy = C.happy = false; }
  if (win(u, 60, 61)) { const a = J(u, 160); G.hop = C.hop = a.hop; G.sq = C.sq = a.sq; }
  const raise = ss(59.6, 60.1, u); G.armL = lerp_(.35, 2.9, raise); C.armR = lerp_(.35, 2.9, raise);
  if (win(u, 61, 62)) { const a = J(u, 30), b = J(u + .5, 30); G.hop = a.hop; C.hop = b.hop; }
  if (win(u, 62, 63)) { G.spin = spinAt(u, 62); const a = J(u, 150); G.hop = a.hop; G.sq = a.sq; }
  if (win(u, 63, 64)) { C.spin = -spinAt(u, 63); const a = J(u, 120); C.hop = a.hop; C.sq = a.sq; }
  C.rayBloom = .45 * pulseAt(u, 60, .9); C.glow += 1.1 * pulseAt(u, 60, 1.2); G.glow += .7 * pulseAt(u, 60, 1.5);
  const sw = Math.sin(u * Math.PI / 2); if (u >= 61) { G.lean = C.lean = sw * .15; }
  drawChar(GPT, G, u); drawChar(CLA, C, u);
  // star: descends, then rides on the pair's raised paws
  const pa = pawPos(G, -1), pb = pawPos(C, 1);
  const held = { x: (pa.x + pb.x) / 2, y: Math.min(pa.y, pb.y) - 34 };
  const fall = { x: 640, y: lerp_(-120, 300, ss(56, 60, u)) };
  const sp = u < 60 ? fall : { x: lerp_(fall.x, held.x, ss(60, 60.25, u)), y: lerp_(fall.y, held.y, ss(60, 60.25, u)) };
  clayStar(sp.x, sp.y, 40 * (1 + .1 * pulse(u, 5)), u < 60 ? u * 1.5 : 90 + Math.sin(u) * .2, '#ffe28a', .8 + .3 * pulse(u, 4));
  sparkles(sp.x, sp.y, u - 60, 30, 60, '#fff2b8', 220, 13);
}
function scene9(u) { // finale: snuggled on the moon, holding the star
  const z = lerp_(2.0, 1.05, ss(64, 70, u)); setCam(640, lerp_(470, 360, ss(64, 70, u)), z);
  sky('#3f3d7e', '#d6a3bf'); skyStars(u, 90, 5);
  for (let i = 0; i < 5; i++) cloud(i * 320 - 40, 640 + (i % 2) * 30, 300, '#cdb7dd');
  // big crescent seat
  ctx.save(); glow(640, 520, 420, '#fff1c0', .35 + .1 * pulse(u, 4));
  ctx.beginPath(); ctx.arc(640, 340, 260, .12 * Math.PI, .88 * Math.PI); ctx.arc(640, 300, 250, .86 * Math.PI, .14 * Math.PI, true); ctx.closePath();
  const g = ctx.createLinearGradient(0, 480, 0, 620); g.addColorStop(0, '#fff6d8'); g.addColorStop(1, '#ffd77a'); ctx.fillStyle = g; ctx.fill(); ctx.restore();
  const k = ss(64, 65, u), sw = Math.sin(u * Math.PI / 2);
  const G = pose({ x: 575 + sw * 8, y: 555, happy: true, armR: 1.2, armL: 2.2, lean: .08 * k + sw * .16, glow: .35 }), C = pose({ x: 698 + sw * 8, y: 555, happy: true, armL: 1.2, armR: 2.2, blush: 1, lean: -.42 * k + sw * .16, glow: .5 + .2 * pulse(u, 4) });
  G.sq = .12 * pulse(u, 6); C.sq = .12 * pulse(u + .5, 6);
  if (win(u, 66, 67) || win(u, 68, 69)) { const a = J(u, 45); G.hop = C.hop = a.hop; }
  drawChar(GPT, G, u); drawChar(CLA, C, u);
  const pa = pawPos(G, -1), pb = pawPos(C, 1); clayStar((pa.x + pb.x) / 2 + 60, Math.min(pa.y, pb.y) - 30, 34 * (1 + .1 * pulse(u, 5)), Math.sin(u) * .2, '#ffe28a', .8);
  return { end: ss(65, 66.2, u) };
}
const SCENES = [[0, scene1], [8, scene2], [16, scene3], [24, scene4], [32, scene5], [40, scene6], [48, scene7], [56, scene8], [64, scene9]];

// ---------- overlay: title, lyrics, grain, flash ----------
function textPop(str, x, y, size, a, col = '#fff8ec') {
  if (a <= 0) return; ctx.save(); ctx.globalAlpha = a; ctx.font = `${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = size * .16; ctx.strokeStyle = 'rgba(150,80,60,.55)'; ctx.strokeText(str, x, y);
  ctx.shadowColor = 'rgba(240,138,75,.6)'; ctx.shadowBlur = size * .4; ctx.fillStyle = col; ctx.fillText(str, x, y); ctx.restore();
}
function overlay(t, u, info) {
  if (info.title) { const a = ss(.4, 1.4, u) * (1 - ss(5.6, 7, u)); const p = 1 + .04 * pulse(u, 5);
    ctx.save(); ctx.translate(640, 150 + (1 - a) * 14); ctx.scale(p, p); textPop('薄荷 & 杏桃', 0, 0, 84, a); textPop('Mint & Apricot · 两个 AI 小精灵的甜蜜日常', 0, 70, 28, a * .95); ctx.restore(); }
  if (info.end) { textPop('一直在你身边', 640, 130, 66, info.end); textPop('Mint & Apricot', 640, 190, 26, info.end * .95); }
  const L = LYRICS.find(l => t >= l.start - .1 && t < l.end + .15);
  if (L) { const a = ss(L.start - .1, L.start + .15, t) * (1 - ss(L.end, L.end + .15, t)); textPop(L.text, 640, 660, 34, a); }
}

window.renderFrame = function (t) {
  const u = U(t);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, OUT_W, OUT_H);
  ctx.save(); ctx.scale(K, K);
  // beat camera punch on bar downbeats + small kick on every beat, rotated slightly
  const bar = Math.floor(u) % 4 === 0 && u > 0 ? pulse(u, 5) : 0, z = 1 + bar * .045 + pulse(u, 8) * .012;
  ctx.translate(640, 360); ctx.scale(z, z); ctx.rotate((Math.floor(u) % 2 ? 1 : -1) * pulse(u, 7) * .006 * (u > 8)); ctx.translate(-640, -360);
  let i = SCENES.length - 1; while (i > 0 && u < SCENES[i][0]) i--;
  ctx.save(); const info = SCENES[i][1](u) || {}; ctx.restore();
  ctx.restore();
  ctx.save(); ctx.scale(K, K);
  overlay(t, u, info);
  // vignette, grain, cut flash, fades
  const v = ctx.createRadialGradient(640, 360, 300, 640, 360, 820); v.addColorStop(0, 'rgba(60,30,40,0)'); v.addColorStop(1, 'rgba(60,30,40,.32)'); ctx.fillStyle = v; ctx.fillRect(0, 0, 1280, 720);
  ctx.restore();
  ctx.save(); ctx.globalAlpha = .07; ctx.globalCompositeOperation = 'overlay'; ctx.drawImage(grain.elt, (Math.floor(t * 30) % 4) * -16, (Math.floor(t * 30) % 3) * -16); ctx.restore();
  const cut = CUTS.reduce((m, c) => Math.max(m, pulseAt(u, c, 6)), 0);
  const fade = Math.max(1 - ss(-.6, .5, u), ss(69.4, 70.6, u), cut * .55);
  if (fade > 0) { ctx.fillStyle = `rgba(255,244,230,${fade})`; ctx.fillRect(0, 0, OUT_W, OUT_H); }
  return true;
};

function setup() {
  const c = createCanvas(OUT_W, OUT_H); pixelDensity(1); noLoop(); ctx = drawingContext;
  grain = createGraphics(OUT_W + 64, OUT_H + 64); grain.pixelDensity(1); grain.loadPixels();
  for (let i = 0; i < grain.pixels.length; i += 4) { const v = 128 + (Math.random() - .5) * 255; grain.pixels[i] = grain.pixels[i + 1] = grain.pixels[i + 2] = v; grain.pixels[i + 3] = 255; }
  grain.updatePixels();
  fetch('lyrics.json').then(r => r.ok ? r.json() : []).catch(() => [])
    .then(ly => { LYRICS = ly; return document.fonts.load(`40px ${FONT}`, '薄荷杏桃一直在你身边 Mint & Apricot·两个AI小精灵的甜蜜日常' + ly.map(l => l.text).join('')); })
    .then(() => { window.renderFrame(0); window.ready = true; });
}
function draw() { }
