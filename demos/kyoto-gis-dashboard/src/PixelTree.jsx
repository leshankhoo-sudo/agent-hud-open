import { useEffect, useMemo, useRef } from 'react';
import { buildTree, BARK, CELL, windSide, windStrength, weatherFx } from './lib/pixelTree.js';

// A small pixel tree that lives in a weather panel (see lib/pixelTree.js for the tree itself).
// - The season picks the tree: cherry in blossom, green maple, maple in autumn colour, bare tree with snow.
// - The forecast moves it: it leans and sways with the wind speed and direction of the chosen hour, gusts
//   come as sudden pushes, strong wind blows leaves (or snow) off; rain, snow, fog and thunder show round it.
//   With no wind value in the forecast it stands still.
// - The pointer is a breeze: passing over it shakes the leaves and knocks some loose; they flutter down
//   and lie on the ground, and grow back on the tree after a while. No buttons.
// It only runs while it is on screen; with "reduce motion" it is drawn once, still.
const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function PixelTree({ season = 'autumn', wind = null, windDir = null, gust = null, code = null, precip = null, night = false, theme = 'dark', width = 150, height = 116, label = '' }) {
  const ref = useRef(null);
  const tree = useMemo(() => buildTree(season, width, height, 11), [season, width, height]);
  const live = useRef({});
  live.current = { wind, windDir, gust, code, precip, night, theme };
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return undefined;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(width * dpr); cv.height = Math.round(height * dpr);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const P = CELL;
    const L = tree.leaves.map((l) => ({ ...l, ox: 0, oy: 0, vx: 0, vy: 0, on: true, back: 0, a: 1 }));
    const fall = [], ground = [], drops = [];
    const flies = Array.from({ length: 5 }, (_, i) => ({ x: (0.2 + i * 0.15) * width, y: height * (0.3 + (i % 3) * 0.15), p: i * 1.7 }));
    let raf = 0, last = 0, t = 0, gustV = 0, nextGust = 2, flash = 0, visible = true;
    const ptr = { x: -999, y: -999, vx: 0, vy: 0, t: 0 };
    const gY = tree.ground * P;
    const step = (dt) => {
      const w = live.current, side = windSide(w.windDir), s = windStrength(w.wind);
      t += dt;
      // gusts: sudden pushes, more often when the gusts are well above the mean wind
      const gx = w.gust != null && w.wind != null ? Math.max(0, (w.gust - w.wind) / 30) : 0;
      nextGust -= dt;
      if (nextGust <= 0 && s > 0.05) { gustV = Math.min(1.2, 0.35 + gx + Math.random() * 0.4) * s; nextGust = 2.5 + Math.random() * (6 - Math.min(4, gx * 6)); }
      gustV *= Math.exp(-dt * 1.6);
      const bend = side * (s * (0.55 + 0.25 * Math.sin(t * 1.1) + 0.1 * Math.sin(t * 2.7)) + gustV) * 9;   // px at the top of the tree
      const nearR = 34;
      const pv = Math.hypot(ptr.vx, ptr.vy), pAge = t - ptr.t;
      for (const l of L) {
        if (!l.on) { if (t > l.back) { l.on = true; l.a = 0; l.ox = l.oy = l.vx = l.vy = 0; } else continue; }
        if (l.a < 1) l.a = Math.min(1, l.a + dt * 0.8);
        const tx = bend * l.h ** 1.6 + Math.sin(t * (2 + l.h * 2) + l.ph) * (0.4 + s * 1.6) * l.h;
        const ty = Math.abs(bend) * 0.12 * l.h ** 2;
        l.vx += ((tx - l.ox) * 55 - l.vx * 7) * dt; l.vy += ((ty - l.oy) * 55 - l.vy * 7) * dt;
        // the pointer: a breeze where it passes
        if (pAge < 0.12 && pv > 40) {
          const lx = l.x * P + l.ox, ly = l.y * P + l.oy, d = Math.hypot(lx - ptr.x, ly - ptr.y);
          if (d < nearR) {
            const f = (1 - d / nearR) * Math.min(1, pv / 900);
            l.vx += ptr.vx * f * 0.35; l.vy += ptr.vy * f * 0.35 - 20 * f;
            if (Math.random() < f * 0.09 * dt * 60) { l.on = false; l.back = t + 14 + Math.random() * 18; fall.push({ x: lx, y: ly, vx: ptr.vx * 0.08 * f + side * 10, vy: -12 * f, c: l.c, ph: l.ph, s: 0 }); }
          }
        }
        // strong wind blows leaves off by itself
        if (s > 0.38 && Math.random() < (s - 0.38) ** 2 * 0.05 * dt * (1 + gustV * 3) * l.h) { l.on = false; l.back = t + 16 + Math.random() * 20; fall.push({ x: l.x * P + l.ox, y: l.y * P + l.oy, vx: side * 18 * s, vy: 0, c: l.c, ph: l.ph, s: 0 }); }
        l.ox += l.vx * dt; l.oy += l.vy * dt;
      }
      // a few petals or leaves drift down even on a calm day in spring and autumn
      if ((tree.season === 'spring' || tree.season === 'autumn') && Math.random() < dt * 0.25) {
        const l = L[(Math.random() * L.length) | 0];
        if (l?.on) { l.on = false; l.back = t + 20 + Math.random() * 20; fall.push({ x: l.x * P + l.ox, y: l.y * P + l.oy, vx: side * 6, vy: 0, c: l.c, ph: l.ph, s: 0 }); }
      }
      for (let i = fall.length - 1; i >= 0; i--) {
        const f = fall[i];
        f.vy = Math.min(26, f.vy + 34 * dt); f.vx += (side * s * 34 + gustV * side * 30 - f.vx) * dt * 0.8;
        f.x += (f.vx + Math.sin(t * 3.2 + f.ph) * 9) * dt; f.y += f.vy * dt;
        if (f.y >= gY - 1) { fall.splice(i, 1); if (f.x > 0 && f.x < width) { ground.push({ x: f.x, c: f.c, a: 1 }); if (ground.length > 140) ground.shift(); } }
        else if (f.x < -6 || f.x > width + 6) fall.splice(i, 1);
      }
      for (const g of ground) g.a = Math.max(0.35, g.a - dt * 0.004);
      // rain, snow, thunder
      const fx = weatherFx(w.code, w.precip);
      while (drops.length < fx.drops) drops.push({ x: Math.random() * width, y: Math.random() * height, v: fx.snow ? 14 + Math.random() * 10 : 120 + Math.random() * 60, ph: Math.random() * 6 });
      if (drops.length > fx.drops) drops.length = fx.drops;
      for (const d of drops) {
        d.y += d.v * dt; d.x += (side * (s * (fx.snow ? 20 : 50)) + (fx.snow ? Math.sin(t * 1.5 + d.ph) * 6 : 0)) * dt;
        if (d.y > gY) { d.y = -4; d.x = Math.random() * width; }
        if (d.x > width + 4) d.x -= width + 8; else if (d.x < -4) d.x += width + 8;
      }
      if (fx.storm && Math.random() < dt * 0.08) flash = 1;
      flash = Math.max(0, flash - dt * 3);
      ptr.vx *= Math.exp(-dt * 8); ptr.vy *= Math.exp(-dt * 8);
      return fx;
    };
    const draw = (fx) => {
      const w = live.current, dark = w.theme !== 'light', B = BARK[dark ? 'dark' : 'light'];
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const side = windSide(w.windDir), s = windStrength(w.wind);
      const bend = side * (s * (0.55 + 0.25 * Math.sin(t * 1.1) + 0.1 * Math.sin(t * 2.7)) + gustV) * 9;
      const sx = (x, h) => Math.round((x * P + bend * h ** 1.6 * 0.8) / P) * P;
      // ground: a soft line of moss and earth
      ctx.globalAlpha = dark ? 0.55 : 0.7;
      ctx.fillStyle = dark ? '#3b4a3a' : '#9bb27d';
      for (let x = Math.round(width * 0.18 / P) * P; x < width * 0.82; x += P) ctx.fillRect(x, gY, P, P);
      ctx.globalAlpha = 1;
      for (const g of ground) { ctx.globalAlpha = g.a; ctx.fillStyle = tree.palette[g.c]; ctx.fillRect(Math.round(g.x / P) * P, gY - P, P, P); }
      ctx.globalAlpha = 1;
      for (const b of tree.bark) { ctx.fillStyle = B[b.tone]; ctx.fillRect(sx(b.x, b.h), b.y * P, P, P); }
      const dim = w.night && !dark ? 0.85 : 1;
      for (let ci = 0; ci < tree.palette.length; ci++) {
        ctx.fillStyle = tree.palette[ci];
        for (const l of L) {
          if (!l.on || l.c !== ci) continue;
          ctx.globalAlpha = l.a * dim;
          ctx.fillRect(Math.round((l.x * P + l.ox) / P) * P, Math.round((l.y * P + l.oy) / P) * P, P, P);
        }
      }
      ctx.globalAlpha = 1;
      for (const f of fall) { ctx.fillStyle = tree.palette[f.c]; ctx.fillRect(Math.round(f.x / P) * P, Math.round(f.y / P) * P, P, P); }
      if (fx.drops) {
        ctx.fillStyle = fx.snow ? (dark ? '#e9f1f6' : '#ffffff') : (dark ? 'rgba(170,205,235,.75)' : 'rgba(80,120,170,.6)');
        for (const d of drops) { const x = Math.round(d.x / P) * P, y = Math.round(d.y / P) * P; ctx.fillRect(x, y, P, fx.snow ? P : P * 2); }
      }
      if (w.night && tree.season === 'summer' && !fx.rain) {   // a few fireflies on summer nights
        for (const f of flies) { const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * 1.7 + f.p)); ctx.globalAlpha = a; ctx.fillStyle = '#f6f3a0'; ctx.fillRect(Math.round((f.x + Math.sin(t * 0.6 + f.p) * 10) / P) * P, Math.round((f.y + Math.cos(t * 0.5 + f.p) * 6) / P) * P, P, P); }
        ctx.globalAlpha = 1;
      }
      if (fx.fog) { ctx.fillStyle = dark ? 'rgba(200,215,220,.16)' : 'rgba(255,255,255,.35)'; ctx.fillRect(0, height * 0.35, width, height * 0.6); }
      if (flash > 0) { ctx.globalAlpha = flash * 0.45; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.globalAlpha = 1; }
    };
    if (reduce()) { draw(weatherFx(live.current.code, live.current.precip)); return undefined; }
    const frame = (now) => {
      raf = 0;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      draw(step(dt));
      if (visible && !document.hidden) raf = requestAnimationFrame(frame); else last = 0;
    };
    const kick = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); });
    io.observe(cv);
    const vis = () => kick();
    document.addEventListener('visibilitychange', vis);
    let lastMv = 0;
    const mv2 = (e) => {   // pointer speed in px/s; ptr.t is in the tree's own clock
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, now = performance.now() / 1000;
      if (lastMv && now - lastMv < 0.2) { const dtp = Math.max(0.008, now - lastMv); ptr.vx = (x - ptr.x) / dtp; ptr.vy = (y - ptr.y) / dtp; }
      ptr.x = x; ptr.y = y; ptr.t = t; lastMv = now;
      kick();
    };
    cv.addEventListener('pointermove', mv2);
    cv.addEventListener('pointerleave', () => { ptr.x = ptr.y = -999; });
    kick();
    return () => { cancelAnimationFrame(raf); io.disconnect(); document.removeEventListener('visibilitychange', vis); cv.removeEventListener('pointermove', mv2); };
  }, [tree, width, height]);
  return <canvas ref={ref} className="pixel-tree" style={{ width, height }} role="img" aria-label={label || `Pixel ${tree.name}`} />;
}
