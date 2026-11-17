import { useEffect, useRef } from 'react';

// Site-wide pointer light (after the reference recording): a small ring a beat behind the pointer and a
// short burst of sparks thrown off behind it, gone within half a second, so it stays small and never
// draws a long line across the page.
// Sparks are laid per distance travelled, not per frame (pointer-trail-emitter guide, MengTo, MIT), so a
// flick and a crawl leave the same density; each is shot backwards with a sideways spread, faster when the
// hand is faster, slowed hard by drag, and drawn as a short streak along its own motion.
// The colour follows what is under the pointer, not the theme: the page under it is sampled (panel
// colours, photos, the closing video, canvases) and over a dark area the sparks glow warm white with a
// little vermilion (added light), over a light one they turn to ink and rust. Each spark keeps the colour
// it was born with, so a trail crossing an edge changes colour along its length.
// One fixed canvas for the whole page: no pointer events, client coordinates, sleeps when nothing is left
// to draw. Not started on touch-only devices. With "reduce motion" the ring and a small still cluster of
// sparks sit at the pointer, with nothing moving on its own.
const N = 260;            // ring buffer of sparks
const STEP = 4.5;          // px of travel per spark
const CAP = 20;           // most sparks per frame (a jumping pointer must not spawn thousands)
const IDLE = 0.6;         // s between tiny sparks while the pointer rests

const GLOW = { ring: '236, 240, 244', a: '255, 238, 220', b: '255, 255, 255', c: '255, 140, 86', blend: 'lighter', gain: 1 };
const INK = { ring: '58, 44, 40', a: '62, 48, 44', b: '160, 64, 36', c: '24, 22, 26', blend: 'source-over', gain: 1 };

// ---- what colour is the page under a point ------------------------------------------------------------
const thumbs = new Map();   // image URL -> { d: 24×24 RGBA, w, h } once loaded
const thumb = (url) => {
  let t = thumbs.get(url);
  if (t) return t.d ? t : null;
  t = {}; thumbs.set(url, t);
  const im = new Image();
  im.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 24;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, 24, 24);
      t.d = g.getImageData(0, 0, 24, 24).data; t.w = im.naturalWidth; t.h = im.naturalHeight;
    } catch { /* a cross-origin picture cannot be read: it is skipped */ }
  };
  im.src = url;
  return null;
};
let live8 = null;
const liveSample = (el, w, h, r, x, y) => {   // a video frame or a 2D canvas, read at 8×8
  if (!w || !h) return null;
  try {
    if (!live8) { const c = document.createElement('canvas'); c.width = c.height = 8; live8 = c.getContext('2d', { willReadFrequently: true }); }
    live8.clearRect(0, 0, 8, 8); live8.drawImage(el, 0, 0, 8, 8);
    const d = live8.getImageData(0, 0, 8, 8).data;
    return cover(d, 8, w, h, r, x, y);
  } catch { return null; }
};
// pixel of a cover-fitted picture (object-fit / background-size: cover, centred) at client x, y
const cover = (d, n, iw, ih, r, x, y) => {
  const s = Math.max(r.width / iw, r.height / ih), dw = iw * s, dh = ih * s;
  const u = Math.min(0.999, Math.max(0, (x - r.left - (r.width - dw) / 2) / dw));
  const v = Math.min(0.999, Math.max(0, (y - r.top - (r.height - dh) / 2) / dh));
  const k = (Math.floor(v * n) * n + Math.floor(u * n)) * 4;
  return d[k + 3] < 20 ? null : [d[k], d[k + 1], d[k + 2]];
};
const rgba = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
const luminanceAt = (x, y, skip) => {
  let A = 0; const C = [0, 0, 0];
  const add = (c, a) => { const k = (1 - A) * a; C[0] += c[0] * k; C[1] += c[1] * k; C[2] += c[2] * k; A += k; };
  const media = (el, r) => {
    if (el.tagName === 'IMG') { if (!el.complete) return null; const t = thumb(el.currentSrc || el.src); return t && cover(t.d, 24, t.w, t.h, r, x, y); }
    if (el.tagName === 'VIDEO') return el.readyState >= 2 ? liveSample(el, el.videoWidth, el.videoHeight, r, x, y) : null;
    if (el.tagName === 'CANVAS') return liveSample(el, el.width, el.height, r, x, y);
    return null;
  };
  const inside = (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  for (const el of document.elementsFromPoint(x, y)) {
    if (el === skip) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
    const op = +cs.opacity;
    const r = el.getBoundingClientRect();
    // a wash laid over it with ::after (a gradient scrim): taken at the average of its colour stops
    for (const pe of ['::after', '::before']) {
      const ps = getComputedStyle(el, pe);
      if (ps.content === 'none' || ps.position !== 'absolute') continue;
      const stops = [...(ps.backgroundImage + ' ' + ps.backgroundColor).matchAll(/rgba?\([^)]+\)/g)].map((m) => rgba(m[0])).filter((s) => s && s.a > 0);
      if (stops.length) {
        const a = stops.reduce((s, q) => s + q.a, 0) / stops.length;
        const c = [0, 1, 2].map((i) => stops.reduce((s, q) => s + q.c[i] * q.a, 0) / stops.reduce((s, q) => s + q.a, 0));
        add(c, a * op * (+ps.opacity || 0));
      }
    }
    // a picture inside that takes no pointer events (card photos) is not in the hit list: look one level down
    for (const ch of el.children) {
      if (!/^(IMG|VIDEO|CANVAS)$/.test(ch.tagName) || ch === skip) continue;
      const cr = ch.getBoundingClientRect();
      if (!inside(cr) || getComputedStyle(ch).pointerEvents !== 'none') continue;
      const cp = media(ch, cr); if (cp) add(cp, op * (+getComputedStyle(ch).opacity || 0));
    }
    let px = media(el, r);
    if (!px && cs.backgroundImage.includes('url(')) {
      const m = cs.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
      const t = m && thumb(m[1]); if (t) px = cover(t.d, 24, t.w, t.h, r, x, y);
    }
    if (px) add(px, op);
    const bg = rgba(cs.backgroundColor);
    if (bg && bg.a > 0) add(bg.c, bg.a * op);
    if (A > 0.97) break;
  }
  if (A < 0.97) add(document.documentElement.dataset.theme === 'light' ? [240, 239, 236] : [12, 12, 18], 1);
  return (0.2126 * C[0] + 0.7152 * C[1] + 0.0722 * C[2]) / 255;
};

export default function CursorLight() {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !matchMedia('(hover: hover) and (pointer: fine)').matches) return undefined;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ctx = cv.getContext('2d');
    let w = 0, h = 0, dpr = 1, raf = 0, last = 0, seen = false, inside = false, lastMove = 0, glow = 0, t = 0, idleAt = 0, live = 0, spawned = 0;
    let lum = document.documentElement.dataset.theme === 'light' ? 0.9 : 0.1, lumAt = -1, dark = lum < 0.5, ring = 0;   // ring: 0 = glow, 1 = ink, eased
    const ptr = { x: 0, y: 0 }, E = { x: 0, y: 0, lx: 0, ly: 0, acc: 0, i: 0 };
    const P = Array.from({ length: N }, () => ({ x: 0, y: 0, vx: 0, vy: 0, age: 1, life: 1, s: 1, k: 'a', ink: false }));
    const fit = () => {
      dpr = Math.min(2, devicePixelRatio || 1);
      w = innerWidth; h = innerHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    };
    const sense = () => {   // what the pointer is over; a little hysteresis so an edge does not flicker
      try { lum = luminanceAt(ptr.x, ptr.y, cv); } catch { /* keep the last reading */ }
      dark = dark ? lum < 0.58 : lum < 0.46;
    };
    const rnd = () => Math.random();
    // take the slot before advancing the index, so a spark is born where it is owed
    const spawn = (x, y, ux, uy, speed, idle) => {
      const i = E.i; E.i = (i + 1) % N; spawned++;
      const p = P[i];
      p.x = x + (rnd() - 0.5) * 3; p.y = y + (rnd() - 0.5) * 3;
      if (idle) {
        const a = rnd() * 6.283, v = 10 + rnd() * 14;
        p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v; p.life = 0.45 + rnd() * 0.25; p.s = 0.8;
      } else {
        // thrown back against the direction of travel, fanned out sideways; a faster hand throws them harder
        const lat = (rnd() - 0.5) * 2 * (0.35 + rnd() * 0.5), back = (0.55 + rnd() * 0.6) * Math.min(520, 60 + speed * 0.32);
        p.vx = -ux * back - uy * lat * back; p.vy = -uy * back + ux * lat * back;
        p.life = 0.18 + rnd() * 0.24; p.s = 0.8 + rnd() * 1.1;
      }
      p.age = 0; p.ink = !dark;
      const r = rnd(); p.k = r < 0.18 ? 'b' : r < 0.36 ? 'c' : 'a';
    };
    const draw = (pal, inkPass) => {
      ctx.globalCompositeOperation = pal.blend;
      ctx.lineCap = 'round';
      for (const p of P) {
        if (p.age >= p.life || p.ink !== inkPass) continue;
        const u = p.age / p.life;
        const op = Math.pow(1 - u, 1.4) * 0.95 * pal.gain;
        const sp = Math.hypot(p.vx, p.vy), len = Math.min(16, sp * 0.04);
        ctx.strokeStyle = `rgba(${pal[p.k]}, ${op.toFixed(3)})`;
        ctx.lineWidth = p.s;
        ctx.beginPath(); ctx.moveTo(p.x, p.y);
        if (len > 0.6) ctx.lineTo(p.x - (p.vx / sp) * len, p.y - (p.vy / sp) * len); else ctx.lineTo(p.x + 0.01, p.y);
        ctx.stroke();
        if (p.k === 'b' && !inkPass) {   // a hot spark carries a small soft glow at its head
          ctx.fillStyle = `rgba(${pal.c}, ${(op * 0.35).toFixed(3)})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 2.2, 0, 6.2832); ctx.fill();
        }
      }
    };
    const frame = (now) => {
      raf = 0;
      const dt = Math.min(1 / 30, last ? (now - last) / 1000 : 1 / 60);   // clamped, so a background tab does not jump
      last = now; t += dt;
      const idle = (now - lastMove) / 1000;
      const want = inside ? 1 : 0;
      glow += (want - glow) * (1 - Math.exp(-dt * (want > glow ? 9 : 2.4)));
      if (inside && now - lumAt > 110) { lumAt = now; sense(); }
      ring += ((dark ? 0 : 1) - ring) * (1 - Math.exp(-dt * 10));
      // the emitter lags a touch behind the pointer
      const k = still ? 1 : 1 - Math.exp(-22 * dt);
      E.x += (ptr.x - E.x) * k; E.y += (ptr.y - E.y) * k;
      if (!still && inside) {
        const dx = E.x - E.lx, dy = E.y - E.ly, moved = Math.hypot(dx, dy);
        const ux = moved > 1e-6 ? dx / moved : 0, uy = moved > 1e-6 ? dy / moved : 0;
        const speed = moved / dt;
        E.acc += moved;
        let n = 0;
        // spend the distance in fixed steps, each spark at its own place along this frame's segment
        while (E.acc >= STEP && n < CAP) {
          E.acc -= STEP; n++;
          const f = moved > 1e-6 ? Math.min(1, 1 - E.acc / moved) : 0;
          spawn(E.lx + dx * f, E.ly + dy * f, ux, uy, speed, false);
        }
        if (n === CAP) E.acc = 0;
        if (idle > 0.2 && t - idleAt > IDLE) { idleAt = t; spawn(E.x, E.y, 0, 0, 0, true); }   // a faint glint while resting
      }
      E.lx = E.x; E.ly = E.y;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      live = 0;
      if (still) {
        const pal = dark ? GLOW : INK;
        ctx.globalCompositeOperation = pal.blend;
        for (let j = 0; j < 9; j++) {
          const a = j * 0.698 + 0.4, r = 9 + (j % 3) * 5;
          ctx.fillStyle = `rgba(${j % 3 ? pal.a : pal.c}, ${(0.55 * glow * pal.gain).toFixed(3)})`;
          ctx.beginPath(); ctx.arc(E.x + Math.cos(a) * r, E.y + Math.sin(a) * r * 0.8, 1.1, 0, 6.2832); ctx.fill();
        }
      } else {
        const drag = Math.exp(-6.5 * dt);
        for (const p of P) {
          if (p.age >= p.life) continue;
          p.age += dt;
          if (p.age >= p.life) continue;
          live++;
          p.vx *= drag; p.vy = p.vy * drag + 30 * dt;   // slowed hard, and falling a little
          p.x += p.vx * dt; p.y += p.vy * dt;
        }
        draw(INK, true); draw(GLOW, false);
      }
      if (glow > 0.01) {
        ctx.globalCompositeOperation = 'source-over';
        const a = 0.75 * glow;
        ctx.lineWidth = 1.1;
        if (ring < 0.99) { ctx.strokeStyle = `rgba(${GLOW.ring}, ${(a * (1 - ring)).toFixed(3)})`; ctx.beginPath(); ctx.arc(E.x, E.y, 7.5, 0, 6.2832); ctx.stroke(); }
        if (ring > 0.01) { ctx.strokeStyle = `rgba(${INK.ring}, ${(a * ring).toFixed(3)})`; ctx.beginPath(); ctx.arc(E.x, E.y, 7.5, 0, 6.2832); ctx.stroke(); }
      }
      const moving = Math.hypot(ptr.x - E.x, ptr.y - E.y) > 0.3;
      // keep running while sparks live, the ring is catching up, the glow is changing, or the pointer rests inside (the glint)
      if (!still && (live || moving || Math.abs(want - glow) > 0.01 || (inside && idle < 20))) raf = requestAnimationFrame(frame);
      else if (still && Math.abs(want - glow) > 0.01) raf = requestAnimationFrame(frame);
      else { last = 0; if (glow <= 0.012) ctx.clearRect(0, 0, w, h); }
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const move = (e) => {
      if (e.pointerType === 'touch') return;
      ptr.x = e.clientX; ptr.y = e.clientY;
      if (!seen) { seen = true; E.x = E.lx = ptr.x; E.y = E.ly = ptr.y; sense(); }
      inside = true; lastMove = performance.now();
      kick();
    };
    const out = () => { inside = false; kick(); };
    const vis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; last = 0; } else kick(); };
    const scrolled = () => { lumAt = -1; if (inside) kick(); };   // the page moved under a resting pointer
    fit();
    addEventListener('resize', fit);
    addEventListener('pointermove', move, { passive: true });
    addEventListener('scroll', scrolled, { passive: true });
    document.documentElement.addEventListener('pointerleave', out);
    addEventListener('blur', out);
    document.addEventListener('visibilitychange', vis);
    window.__cursorLight = { get glow() { return glow; }, get ring() { return { x: E.x, y: E.y }; }, get running() { return !!raf; }, get sparks() { return live; }, get spawned() { return spawned; }, get still() { return still; },
      get lum() { return lum; }, get tone() { return dark ? 'glow' : 'ink'; }, maxAge: () => Math.max(0, ...P.filter((p) => p.age < p.life).map((p) => p.life)) };   // read by the automated tests
    return () => {
      removeEventListener('resize', fit); removeEventListener('pointermove', move); removeEventListener('scroll', scrolled); document.documentElement.removeEventListener('pointerleave', out);
      removeEventListener('blur', out); document.removeEventListener('visibilitychange', vis); cancelAnimationFrame(raf); delete window.__cursorLight;
    };
  }, []);
  return <canvas ref={ref} className="cursor-light" aria-hidden="true" />;
}
