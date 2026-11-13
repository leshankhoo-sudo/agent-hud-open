// The day / night switch as a small physical object: a recessed glass track and a frosted soft
// glass key that squashes, stretches and springs like silicone under a finger. One canvas draws
// it; the HTML button on top of it takes the pointer, keyboard and screen reader.
//
// Geometry is in the design's own units (canvas 440 x 280, track 320 x 164 at 60,58, key 140 x 140
// with 12 margin, so the key travels 156). The canvas is shown at any scale with the same shape.
//
// One state drives everything: position x (0..156) and its velocity, and three deformations
// (press, stretch from drag speed, squeeze against an end). The key's outline is computed from
// that state each frame, and the glass, its glow, the dot pattern and the moving edge light are
// all drawn in that same deformed outline, so nothing drifts apart.
//
// t = x / 156 is the colour and pattern parameter: 0 night, 1 day. Colours are OKLab ramps.
import { ramp, rgba } from './oklab.js';

export const DESIGN = { W: 440, H: 280, TX: 60, TY: 58, TW: 320, TH: 164, TR: 58, K: 140, KR: 46, M: 12, TRAVEL: 156 };
const { W, H, TX, TY, TW, TH, TR, K, KR, M, TRAVEL } = DESIGN;
const KY = TY + TH / 2;            // key centre y
const KX0 = TX + M + K / 2;        // key centre x at x = 0

const C = {
  page: ramp(['#0E1016', '#3A3C44', '#8D8E93', '#E7E5E1']),
  track: ramp(['#06070B', '#2A2C33', '#7E8086', '#E2DFDA']),
  edge: ramp(['#8E9BFF', '#C9C4FF', '#FFFFFF', '#FFE2B0', '#FFB140']),
  dots: ramp(['#F4F6FF', '#E9ECF7', '#B9B3AA', '#5A4632']),
  glassTop: ramp(['#3A3E4E', '#FFFFFF']),
  glassBot: ramp(['#20222C', '#F2EFEA']),
};
export const pageColor = (t) => C.page(t);
const lerp = (a, b, f) => a + (b - a) * f;
const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (x) => { x = cl(x); return x * x * (3 - 2 * x); };

// ---------- dot patterns (15 x 15 grid, spacing 5.6, dot 4.3) ----------
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function buildParticles() {
  const moon = [], sun = [];
  for (let j = 0; j < 15; j++) for (let i = 0; i < 15; i++) {
    const inBody = Math.hypot(i - 6.6, j - 7.4) <= 5.6, inCut = Math.hypot(i - 9.2, j - 5.0) <= 4.9;
    if (inBody) moon.push({ x: i, y: j, a: inCut ? 0.16 : 1, star: false });
    if (Math.hypot(i - 7, j - 7) <= 3.3) sun.push({ x: i, y: j, a: 1 });
  }
  // a small cross-shaped star at the top right of the moon
  moon.push({ x: 12.5, y: 1.5, a: 1, star: true });
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) moon.push({ x: 12.5 + dx, y: 1.5 + dy, a: 0.6, star: true });
  // rays: two dots up, down, left and right from radius 4.9, one dot on each diagonal at 4.6
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) for (const r of [4.9, 5.9]) sun.push({ x: 7 + dx * r, y: 7 + dy * r, a: 1 });
  for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) sun.push({ x: 7 + (dx * 4.6) / Math.SQRT2, y: 7 + (dy * 4.6) / Math.SQRT2, a: 1 });
  // pair them by angle around the centre, so each dot travels a short, orderly way round
  const ang = (p) => Math.atan2(p.y - 7, p.x - 7);
  moon.sort((a, b) => ang(a) - ang(b)); sun.sort((a, b) => ang(a) - ang(b));
  const N = Math.max(moon.length, sun.length), rnd = mulberry(1987);
  const out = [];
  let lastM = -1, lastS = -1;
  for (let k = 0; k < N; k++) {
    const mi = Math.floor((k * moon.length) / N), si = Math.floor((k * sun.length) / N);
    const m = moon[mi], s = sun[si];
    const th = rnd() * Math.PI * 2;
    out.push({
      ax: m.x, ay: m.y, aa: mi === lastM ? 0 : m.a, star: m.star && mi !== lastM,
      bx: s.x, by: s.y, ba: si === lastS ? 0 : s.a,
      delay: rnd() * 0.25, rot: 0.6 + rnd() * 0.8, jx: Math.cos(th) * rnd(), jy: Math.sin(th) * rnd(), ph: rnd() * 6.283,
    });
    lastM = mi; lastS = si;
  }
  return out;
}
const PARTS = buildParticles();

// ---------- outline of a rounded rectangle, by arc length from the top centre, clockwise ----------
function contour(w, h, r) {
  const sx = w / 2 - r, sy = h / 2 - r, q = (Math.PI * r) / 2;
  const segs = [sx, q, 2 * sy, q, 2 * sx, q, 2 * sy, q, sx];
  const total = segs.reduce((a, b) => a + b, 0);
  return (u) => {
    let d = (((u % 1) + 1) % 1) * total;
    // returns [x, y, nx, ny]
    if ((d -= 0) < segs[0]) return [d, -h / 2, 0, -1]; d -= segs[0];
    if (d < q) { const a = -Math.PI / 2 + d / r; return [sx + r * Math.cos(a), -sy + r * Math.sin(a), Math.cos(a), Math.sin(a)]; } d -= q;
    if (d < 2 * sy) return [w / 2, -sy + d, 1, 0]; d -= 2 * sy;
    if (d < q) { const a = d / r; return [sx + r * Math.cos(a), sy + r * Math.sin(a), Math.cos(a), Math.sin(a)]; } d -= q;
    if (d < 2 * sx) return [sx - d, h / 2, 0, 1]; d -= 2 * sx;
    if (d < q) { const a = Math.PI / 2 + d / r; return [-sx + r * Math.cos(a), sy + r * Math.sin(a), Math.cos(a), Math.sin(a)]; } d -= q;
    if (d < 2 * sy) return [-w / 2, sy - d, -1, 0]; d -= 2 * sy;
    if (d < q) { const a = Math.PI + d / r; return [-sx + r * Math.cos(a), -sy + r * Math.sin(a), Math.cos(a), Math.sin(a)]; } d -= q;
    return [-sx + d, -h / 2, 0, -1];
  };
}
const KEY_PATH = contour(K, K, KR);
function rrect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// ---------- springs ----------
// second-order spring with natural frequency w (rad/s) and damping ratio z
const spring = (s, target, w, z, dt) => { const a = w * w * (target - s.p) - 2 * z * w * s.v; s.v += a * dt; s.p += s.v * dt; };

export function createGlassSwitch(canvas, { reduceMotion = false, onFrame } = {}) {
  const g = canvas.getContext('2d');
  const hasFilter = 'filter' in g;
  const layer = document.createElement('canvas'), lg = layer.getContext('2d');
  const S = {
    x: 0, v: 0, mode: 'idle', target: 0,      // position and how it is moving
    press: { p: 0, v: 0 }, pressOn: 0,           // 0..1, pointer down
    str: { p: 0, v: 0 }, strT: 0, dir: 0,        // extra width from drag speed (design units)
    over: { p: 0, v: 0 }, overT: 0, overSide: 0, // squeeze against an end, 0..1
    dragX0: 0, dragP0: 0, samples: [], lastMove: 0,
    scale: 1, dpr: 1, raf: 0, last: 0, time: 0, twinkle: 0, frozen: false, dead: false,
  };
  const reduce = reduceMotion;

  // ---------- size ----------
  const resize = (cssTrackH) => {
    S.scale = cssTrackH / TH;
    S.dpr = Math.min(3, window.devicePixelRatio || 1);
    const cw = W * S.scale, ch = H * S.scale;
    canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
    canvas.style.left = `${-TX * S.scale}px`; canvas.style.top = `${-TY * S.scale}px`;
    for (const c of [canvas, layer]) { c.width = Math.max(2, Math.round(cw * S.dpr)); c.height = Math.max(2, Math.round(ch * S.dpr)); }
    buildSprites();
    draw();
    idleTwinkle();
  };

  // ---------- geometry from the state ----------
  const shape = () => {
    const press = S.press.p, str = S.str.p, over = S.over.p;
    const sx = 1 + 0.035 * press + str / K - 0.06 * over;
    const sy = 1 - 0.02 * press - (0.45 * str) / K + (5 / K) * over;
    // the visible position never leaves the track: past an end it is held back softly (3 units at most)
    let x = S.x;
    if (x > TRAVEL) x = TRAVEL + 3 * Math.tanh((x - TRAVEL) / 3);
    if (x < 0) x = -3 * Math.tanh(-x / 3);
    const cx = KX0 + x + S.dir * str * 0.25 + S.overSide * over * 3;
    return { cx, cy: KY, sx, sy, t: cl(x / TRAVEL) };
  };

  // ---------- cached blurs (made once per size; the per-frame work draws them, it never blurs them) ----------
  const sprite = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h)); return c; };
  const K_PAD = 40; // room round the key sprite for its shadow
  function buildSprites() {
    const k = S.scale * S.dpr, OFF = 4000;
    // track drop shadow, shadow only: the shape is drawn far off the canvas and only its shadow lands
    const ts = sprite(canvas.width, canvas.height), tg = ts.getContext('2d');
    tg.setTransform(k, 0, 0, k, 0, 0); tg.shadowColor = '#000'; tg.shadowBlur = 26 * k; tg.shadowOffsetX = OFF * k; tg.shadowOffsetY = 10 * k;
    rrect(tg, TX - OFF, TY, TW, TH, TR); tg.fill();
    // track inner shadow: a thick rim just outside the track, clipped, so only its shadow falls inside
    const ti = sprite(canvas.width, canvas.height), tig = ti.getContext('2d');
    tig.setTransform(k, 0, 0, k, 0, 0); rrect(tig, TX, TY, TW, TH, TR); tig.clip();
    rrect(tig, TX - 9, TY - 9, TW + 18, TH + 18, TR + 9); tig.lineWidth = 18; tig.strokeStyle = '#000';
    tig.shadowColor = '#000'; tig.shadowBlur = 16 * k; tig.shadowOffsetY = 5 * k; tig.stroke();
    // key drop shadow (undeformed; it is drawn through the key's own deformation each frame)
    const ks = sprite((K + 2 * K_PAD) * k, (K + 2 * K_PAD) * k), kg = ks.getContext('2d');
    kg.setTransform(k, 0, 0, k, 0, 0); kg.shadowColor = '#000'; kg.shadowBlur = 20 * k; kg.shadowOffsetX = OFF * k; kg.shadowOffsetY = 7 * k;
    rrect(kg, K_PAD - OFF, K_PAD, K, K, KR); kg.fill();
    S.sp = { ts, ti, ks };
  }

  // ---------- drawing ----------
  function draw() {
    if (S.dead || !S.sp) return;
    const k = S.scale * S.dpr;
    const { cx, cy, sx, sy, t } = shape();
    const px = 1 / S.scale; // one CSS pixel in design units, for hairlines
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.clearRect(0, 0, canvas.width, canvas.height);
    const edge = C.edge(t);

    // track: drop shadow, body, inner shadow, ambient reflection, fine rim
    g.globalAlpha = lerp(0.55, 0.12, t); g.drawImage(S.sp.ts, 0, 0);
    g.globalAlpha = 1;
    g.setTransform(k, 0, 0, k, 0, 0);
    rrect(g, TX, TY, TW, TH, TR); g.fillStyle = rgba(C.track(t)); g.fill();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = lerp(0.85, 0.22, t); g.drawImage(S.sp.ti, 0, 0); g.globalAlpha = 1;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.save();
    rrect(g, TX, TY, TW, TH, TR); g.clip();
    const ax = cx + lerp(-58, 58, ease(t)), ay = cy + lerp(46, -46, ease(t));
    const amb = g.createRadialGradient(ax, ay, 0, ax, ay, 130);
    amb.addColorStop(0, rgba(edge, lerp(0.34, 0.26, t))); amb.addColorStop(1, rgba(edge, 0));
    g.fillStyle = amb; g.fillRect(TX, TY, TW, TH);
    g.restore();
    rrect(g, TX + 0.5 * px, TY + 0.5 * px, TW - px, TH - px, TR);
    g.lineWidth = px; g.strokeStyle = `rgba(255,255,255,${lerp(0.06, 0.55, t).toFixed(3)})`; g.stroke();

    // key: everything below is drawn in the key's own deformed frame
    g.save();
    g.translate(cx, cy); g.scale(sx, sy);
    g.globalAlpha = lerp(0.5, 0.16, t); g.drawImage(S.sp.ks, -K / 2 - K_PAD, -K / 2 - K_PAD, K + 2 * K_PAD, K + 2 * K_PAD); g.globalAlpha = 1;
    const keyPath = () => rrect(g, -K / 2, -K / 2, K, K, KR);
    keyPath();
    const gl = g.createLinearGradient(0, -K / 2, 0, K / 2);
    gl.addColorStop(0, rgba(C.glassTop(t), lerp(0.92, 0.9, t))); gl.addColorStop(1, rgba(C.glassBot(t), lerp(0.94, 0.9, t)));
    g.fillStyle = gl; g.fill();
    g.save(); keyPath(); g.clip();
    // coloured glow inside the glass, gathered round where the edge light is
    const u0 = 0.6 + 0.53 * ease(t);
    const [bx, by] = KEY_PATH(u0);
    const ig = g.createRadialGradient(bx * 0.8, by * 0.8, 0, bx * 0.8, by * 0.8, 92);
    ig.addColorStop(0, rgba(edge, lerp(0.42, 0.34, t))); ig.addColorStop(1, rgba(edge, 0));
    g.fillStyle = ig; g.fillRect(-K, -K, 2 * K, 2 * K);
    // soft white sheen on the top half
    const sh = g.createLinearGradient(0, -K / 2, 0, 6);
    sh.addColorStop(0, `rgba(255,255,255,${lerp(0.1, 0.65, t).toFixed(3)})`); sh.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sh; g.beginPath(); g.ellipse(0, -K * 0.2, K * 0.46, K * 0.32, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    // dot pattern, with its cool glow at night and a contrast halo half way
    if (!S.skip?.dots) drawDots(t, k, cx, cy, sx, sy);
    // fine glass rim
    keyPath(); g.lineWidth = px / Math.max(sx, sy); g.strokeStyle = `rgba(255,255,255,${lerp(0.14, 0.9, t).toFixed(3)})`; g.stroke();
    g.restore();

    // the moving edge light, on the deformed outline
    if (!S.skip?.edge) drawEdge(t, k, cx, cy, sx, sy, edge, u0);
    onFrame?.(t);
  }

  function paintDots(ctx, t) {
    const step = 5.6, size0 = 4.3;
    const tw = !reduce && t < 0.5 ? S.time : 0;
    for (let i = 0; i < PARTS.length; i++) {
      const q = PARTS[i];
      const p = ease(cl((t - q.delay) / 0.75));
      const bump = Math.sin(Math.PI * p);
      let x = lerp(q.ax, q.bx, p) - 7, y = lerp(q.ay, q.by, p) - 7;
      if (!reduce) {
        const th = bump * 1.1 * q.rot, c = Math.cos(th), s = Math.sin(th);
        const rx = x * c - y * s, ry = x * s + y * c;
        x = rx + bump * 2.2 * q.jx; y = ry + bump * 2.2 * q.jy;
      }
      let a = lerp(q.aa, q.ba, p);
      if (q.star && tw) a *= 0.72 + 0.28 * Math.sin(tw * 1.6 + q.ph);
      if (a <= 0.01) continue;
      const sz = size0 * (1 - 0.15 * bump);
      ctx.globalAlpha = a;
      ctx.fillRect(x * step - sz / 2, y * step - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
  }
  function drawDots(t, k, cx, cy, sx, sy) {
    const glow = reduce ? 0 : 1 - cl(t / 0.6);
    const mid = Math.sin(Math.PI * t);
    if (hasFilter && (glow > 0.01 || mid > 0.05)) {
      // the dots once on a side canvas, then blurred only over the key's own box
      const m = g.getTransform();
      lg.setTransform(1, 0, 0, 1, 0, 0); lg.globalCompositeOperation = 'source-over'; lg.clearRect(0, 0, layer.width, layer.height);
      lg.setTransform(m); lg.fillStyle = '#fff'; paintDots(lg, t);
      const half = (K / 2 + 14) * k, bx0 = Math.max(0, Math.floor(cx * k - half * sx)), by0 = Math.max(0, Math.floor(cy * k - half * sy));
      const bw = Math.min(layer.width - bx0, Math.ceil(2 * half * sx)), bh = Math.min(layer.height - by0, Math.ceil(2 * half * sy));
      const tint = (css) => { lg.setTransform(1, 0, 0, 1, 0, 0); lg.globalCompositeOperation = 'source-in'; lg.fillStyle = css; lg.fillRect(bx0, by0, bw, bh); };
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
      // half way the dots and the glass are both mid-grey: a faint halo of the opposite tone keeps them readable
      if (mid > 0.05) { tint(t < 0.5 ? 'rgb(20,22,32)' : 'rgb(60,44,30)'); g.globalAlpha = (t < 0.5 ? 0.6 : 0.5) * mid; g.filter = `blur(${(1.4 * k).toFixed(2)}px)`; g.drawImage(layer, bx0, by0, bw, bh, bx0, by0, bw, bh); }
      if (glow > 0.01) { tint('rgb(214,224,255)'); g.globalAlpha = 0.85 * glow; g.filter = `blur(${(2.5 * k).toFixed(2)}px)`; g.drawImage(layer, bx0, by0, bw, bh, bx0, by0, bw, bh); }
      g.restore();
    }
    g.fillStyle = rgba(C.dots(t)); paintDots(g, t);
  }

  // The edge light: about 90 short pieces along the deformed outline, brightness falling off as
  // exp(-2.6 f^2) from the middle of the band. A coloured outer glow and a white core, each drawn as
  // a few widening strokes of falling strength (the same falloff a blur gives, without blurring the
  // canvas every frame). Pieces of equal strength are stroked together.
  const PTS = new Float32Array(2 * 91), ALPHA = new Float32Array(91);
  function drawEdge(t, k, cx, cy, sx, sy, edge, u0) {
    const half = lerp(0.22, 0.19, t), N = 90;
    for (let i = 0; i <= N; i++) {
      const f = -1 + (2 * i) / N;
      const [x, y, nx, ny] = KEY_PATH(u0 + f * half);
      const mx = nx * sy, my = ny * sx, ml = Math.hypot(mx, my) || 1;
      PTS[2 * i] = cx + x * sx + (mx / ml) * 1.5; PTS[2 * i + 1] = cy + y * sy + (my / ml) * 1.5;
      const fm = f - 1 / N; // the piece ending at point i is centred half a step back
      ALPHA[i] = Math.exp(-2.6 * fm * fm);
    }
    const LEVELS = 10;
    const pass = (width, css, peak) => {
      g.lineWidth = width; g.strokeStyle = css;
      for (let lv = 1; lv <= LEVELS; lv++) {
        const lo = (lv - 0.5) / LEVELS, hi = (lv + 0.5) / LEVELS;
        let any = false;
        g.beginPath();
        for (let i = 1; i <= N; i++) { const a = ALPHA[i]; if (a >= lo && a < hi) { g.moveTo(PTS[2 * i - 2], PTS[2 * i - 1]); g.lineTo(PTS[2 * i], PTS[2 * i + 1]); any = true; } }
        if (any) { g.globalAlpha = Math.min(1, peak * (lv / LEVELS)); g.stroke(); }
      }
      g.globalAlpha = 1;
    };
    g.save();
    g.setTransform(k, 0, 0, k, 0, 0);
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.globalCompositeOperation = t < 0.6 ? 'lighter' : 'source-over';
    const col = rgba(edge, 1), white = lerp(0.9, 0.55, t);
    pass(26, col, 0.07); pass(15, col, 0.13); pass(8.5, col, 0.26); pass(4.2, col, 1);   // coloured, wide and soft
    pass(6, '#ffffff', 0.22 * white); pass(2.2, '#ffffff', white);                     // white core
    g.restore();
  }

  // ---------- simulation ----------
  const step = (dt) => {
    S.time += dt;
    // press: critically damped-ish, about 0.16 s, at most ~1.5 % overshoot
    spring(S.press, S.pressOn, reduce ? 40 : 26, 0.8, dt);
    // stretch from drag speed: follows the speed, then settles on a soft spring (not at once)
    if (S.mode === 'drag' && performance.now() - S.lastMove > 50) S.strT *= Math.exp(-dt * 10);
    spring(S.str, reduce ? 0 : S.strT, 17, 0.55, dt);
    spring(S.over, S.overT, 20, 0.8, dt);
    if (S.mode === 'spring') {
      // release / click: under-damped spring, k = 129, damping ratio 0.6
      const kk = reduce ? 600 : 129, c = 2 * Math.sqrt(kk) * (reduce ? 1 : 0.6);
      const a = kk * (S.target - S.x) - c * S.v;
      S.v += a * dt; S.x += S.v * dt;
      // squeeze a little where it overshoots past an end
      const past = S.x > TRAVEL ? S.x - TRAVEL : S.x < 0 ? -S.x : 0;
      S.overT = cl(past / 8) * 0.6; S.overSide = S.x > TRAVEL ? 1 : S.x < 0 ? -1 : S.overSide;
      if (Math.abs(S.target - S.x) < 0.05 && Math.abs(S.v) < 2) { S.x = S.target; S.v = 0; S.mode = 'idle'; S.overT = 0; }
    }
  };
  const busy = () => S.mode !== 'idle' || Math.abs(S.press.p - S.pressOn) > 0.002 || Math.abs(S.press.v) > 0.01 || Math.abs(S.str.p) > 0.05 || Math.abs(S.str.v) > 0.05 || Math.abs(S.over.p - S.overT) > 0.002 || Math.abs(S.over.v) > 0.01;
  const frame = (now) => {
    S.raf = 0;
    if (S.dead) return;
    const dt = Math.min(0.05, (now - (S.last || now)) / 1000) || 1 / 60; S.last = now;
    // fixed sub-steps keep the springs identical at any frame rate
    for (let left = dt; left > 1e-4; left -= 1 / 240) step(Math.min(1 / 240, left));
    draw();
    if (busy() && !document.hidden) S.raf = requestAnimationFrame(frame);
    else { S.last = 0; idleTwinkle(); }
  };
  const kick = () => { clearTimeout(S.twinkle); if (!S.raf && !S.dead) S.raf = requestAnimationFrame(frame); };
  // at rest at night the little star twinkles: a redraw about 8 times a second, nothing more
  const idleTwinkle = () => {
    clearTimeout(S.twinkle);
    if (reduce || S.dead || document.hidden || shape().t > 0.5) return;
    S.twinkle = setTimeout(() => { S.time += 0.125; draw(); idleTwinkle(); }, 125);
  };
  const onVis = () => { if (document.hidden) clearTimeout(S.twinkle); else kick(); };
  document.addEventListener('visibilitychange', onVis);

  // ---------- input (positions in CSS pixels; converted to design units) ----------
  const api = {
    get t() { return shape().t; },
    get x() { return S.x; },
    resize,
    set(t) { S.x = cl(t) * TRAVEL; S.v = 0; S.mode = 'idle'; S.target = S.x; kick(); },
    freeze() { S.frozen = true; },
    animateTo(t) { if (S.frozen) return; S.target = cl(t) * TRAVEL; S.mode = 'spring'; kick(); },
    down(cssX) { if (S.frozen) return; S.mode = 'drag'; S.v = 0; S.pressOn = 1; S.dragX0 = cssX / S.scale; S.dragP0 = S.x; S.samples = [[performance.now(), S.x]]; S.lastMove = performance.now(); kick(); },
    move(cssX) {
      if (S.mode !== 'drag') return;
      const raw = S.dragP0 + cssX / S.scale - S.dragX0;
      // past an end: up to about 110 units of extra input is absorbed like a rubber band
      let x = raw, over = 0, side = 0;
      if (raw > TRAVEL) { over = raw - TRAVEL; side = 1; } else if (raw < 0) { over = -raw; side = -1; }
      if (over > 0) { const c = 1 - Math.exp(-over / 55); x = side > 0 ? TRAVEL + 2 * c : -2 * c; S.overT = c; S.overSide = side; } else S.overT = 0;
      const now = performance.now();
      S.samples.push([now, cl(raw, 0, TRAVEL)]); while (S.samples.length > 2 && now - S.samples[0][0] > 80) S.samples.shift();
      const [t0, x0] = S.samples[0];
      const vel = now - t0 > 4 ? ((cl(raw, 0, TRAVEL) - x0) / (now - t0)) * 1000 : 0; // design units per second
      S.v = vel; S.lastMove = now;
      S.strT = over > 0 ? 0 : 16 * (1 - Math.exp(-Math.abs(vel) / 650));
      if (Math.abs(vel) > 30) S.dir = Math.sign(vel);
      S.x = x; kick();
    },
    // returns the end it will settle at, 0 or 1
    up({ toggle = false } = {}) {
      if (S.mode !== 'drag') return null;
      S.pressOn = 0; S.overT = 0; S.strT = 0;
      const t = cl(S.x / TRAVEL);
      let end;
      if (toggle) end = S.dragP0 / TRAVEL > 0.5 ? 0 : 1;
      else {
        const vt = (performance.now() - S.lastMove < 80 ? S.v : 0) / TRAVEL; // t per second
        end = t + vt * 0.06 >= 0.5 ? 1 : 0;
      }
      S.x = cl(S.x, -2, TRAVEL + 2);
      S.target = end * TRAVEL; S.mode = 'spring'; kick();
      return end;
    },
    // for timing tests: draw the switch at t without moving it
    _drawAt(t, parts = {}) { const x = S.x; S.x = cl(t) * TRAVEL; S.skip = parts; draw(); S.skip = null; S.x = x; },
    knobCenter() { const { cx, cy } = shape(); return [cx - TX, cy - TY]; }, // in design units, from the track's top left
    destroy() { S.dead = true; cancelAnimationFrame(S.raf); clearTimeout(S.twinkle); document.removeEventListener('visibilitychange', onVis); },
  };
  return api;
}
