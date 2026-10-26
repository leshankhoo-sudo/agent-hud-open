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
    if (P.keep) clayStar(18, -134, 9, u * 2, '#ff9a52', .5, 4); // Claude's keepsake spark
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


// ---------- shared scene helpers ----------
function sky(top, bot) { const g = ctx.createLinearGradient(0, -400, 0, 1000); g.addColorStop(0, top); g.addColorStop(1, bot); ctx.fillStyle = g; ctx.fillRect(-2000, -1000, 6000, 3000); }
function skyStars(u, n, seed, alpha = 1, par = 0, camx = 0) {
  if (alpha <= .01) return;
  for (let i = 0; i < n; i++) { const x = rnd(seed + i) * 1800 - 260 + camx * par, y = rnd(seed + i * 7) * 420 - 80;
    const tw = .6 + .4 * Math.sin(u * 2 + i) + .3 * pulse(u + i % 3 * .33, 6);
    ctx.save(); ctx.globalAlpha = alpha * clamp(tw); clayStar(x, y, 4 + rnd(i + seed * 3) * 5, i, '#fff1b8', .15, i % 2 ? 4 : 5); ctx.restore(); }
}
function setCam(cx, cy, z) { ctx.translate(640, 360); ctx.scale(z, z); ctx.translate(-cx, -cy); }
