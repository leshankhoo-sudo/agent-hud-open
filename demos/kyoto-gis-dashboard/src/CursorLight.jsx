import { useEffect, useRef } from 'react';

// Site-wide pointer light (after the reference recording): a small ring a beat behind the pointer, and a
// trail of fine sparks behind it like a comet tail.
// The trail follows the pointer-trail-emitter guide (MengTo, MIT): sparks are laid per distance travelled,
// not per frame, so a flick and a crawl draw the same continuous ribbon; each frame's sparks are spread
// along the segment the emitter covered; the emitter lags the pointer; sparks coast, curl and rise a
// little before fading; a resting pointer keeps a faint breath (one spark about every 0.4 s).
// One fixed canvas for the whole page: no pointer events, client coordinates (so scrolling never offsets
// it), sleeps when nothing is left to draw. Not started on touch-only devices. With "reduce motion" the
// ring and a small still cluster of sparks sit at the pointer, with no trail and nothing moving on its own.
const N = 220;            // ring buffer of sparks
const STEP = 7;           // px of travel per spark
const CAP = 14;           // most sparks per frame (a jumping pointer must not spawn thousands)
const IDLE = 0.42;        // s between sparks while the pointer rests

export default function CursorLight() {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !matchMedia('(hover: hover) and (pointer: fine)').matches) return undefined;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ctx = cv.getContext('2d');
    let w = 0, h = 0, dpr = 1, raf = 0, last = 0, seen = false, inside = false, lastMove = 0, glow = 0, t = 0, idleAt = 0, live = 0, spawned = 0;
    const ptr = { x: 0, y: 0 }, E = { x: 0, y: 0, lx: 0, ly: 0, acc: 0, i: 0 };
    const P = Array.from({ length: N }, () => ({ x: 0, y: 0, vx: 0, vy: 0, age: 1, life: 1, s: 1, ph: 0, hot: false }));
    const fit = () => {
      dpr = Math.min(2, devicePixelRatio || 1);
      w = innerWidth; h = innerHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    };
    const colours = () => (document.documentElement.dataset.theme === 'light'
      ? { ring: '180, 84, 58', spark: '200, 96, 62', hot: '128, 54, 34', blend: 'source-over', gain: 0.85 }
      : { ring: '214, 246, 247', spark: '138, 226, 229', hot: '255, 255, 255', blend: 'lighter', gain: 1 });
    const rnd = () => Math.random();
    // take the slot before advancing the index, so a spark is born where it is owed
    const spawn = (x, y, ux, uy, idle) => {
      const i = E.i; E.i = (i + 1) % N; spawned++;
      const p = P[i];
      const lat = (rnd() - 0.5) * 2;
      p.x = x + (rnd() - 0.5) * 5; p.y = y + (rnd() - 0.5) * 5;
      // launched a little against the direction of travel, with a sideways spread
      p.vx = -ux * 14 + -uy * lat * 30; p.vy = -uy * 14 + ux * lat * 30;
      p.age = 0; p.life = idle ? 2.1 + rnd() * 1.3 : 0.9 + rnd() * 1.1;
      p.s = 0.7 + rnd() * 1.1; p.ph = rnd() * 6.283; p.hot = rnd() > 0.72;
    };
    const frame = (now) => {
      raf = 0;
      const dt = Math.min(1 / 30, last ? (now - last) / 1000 : 1 / 60);   // clamped, so a background tab does not jump
      last = now; t += dt;
      const idle = (now - lastMove) / 1000;
      const want = inside ? 1 : 0;
      glow += (want - glow) * (1 - Math.exp(-dt * (want > glow ? 9 : 2.4)));
      // the emitter lags behind the pointer: that slack is what lets the trail open out
      const k = still ? 1 : 1 - Math.exp(-16 * dt);
      E.x += (ptr.x - E.x) * k; E.y += (ptr.y - E.y) * k;
      if (!still && inside) {
        const dx = E.x - E.lx, dy = E.y - E.ly, moved = Math.hypot(dx, dy);
        const ux = moved > 1e-6 ? dx / moved : 0, uy = moved > 1e-6 ? dy / moved : 0;
        E.acc += moved;
        let n = 0;
        // spend the distance in fixed steps, each spark at its own place along this frame's segment
        while (E.acc >= STEP && n < CAP) {
          E.acc -= STEP; n++;
          const f = moved > 1e-6 ? Math.min(1, 1 - E.acc / moved) : 0;
          spawn(E.lx + dx * f, E.ly + dy * f, ux, uy, false);
        }
        if (n === CAP) E.acc = 0;
        if (idle > 0.15 && t - idleAt > IDLE) { idleAt = t; spawn(E.x, E.y, 0, -1, true); }   // a breath while resting
      }
      E.lx = E.x; E.ly = E.y;
      const C = colours();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = C.blend;
      live = 0;
      if (still) {
        // a designed still: a few sparks resting round the ring, nothing moving on its own
        for (let j = 0; j < 9; j++) {
          const a = j * 0.698 + 0.4, r = 9 + (j % 3) * 5;
          ctx.fillStyle = `rgba(${j % 3 ? C.spark : C.hot}, ${(0.55 * glow * C.gain).toFixed(3)})`;
          ctx.beginPath(); ctx.arc(E.x + Math.cos(a) * r, E.y + Math.sin(a) * r * 0.8, 1.1, 0, 6.2832); ctx.fill();
        }
      } else {
        for (const p of P) {
          if (p.age >= p.life) continue;
          p.age += dt;
          if (p.age >= p.life) continue;
          live++;
          // coast (slow damping), curl and a small rise
          const damp = 1 - 0.5 * dt;
          p.vx = p.vx * damp + Math.sin(t * 1.3 + p.ph) * 22 * dt;
          p.vy = p.vy * damp + Math.cos(t * 1.1 + p.ph * 1.7) * 18 * dt - 9 * dt;
          p.x += p.vx * dt; p.y += p.vy * dt;
          const u = p.age / p.life;
          const op = (u < 0.12 ? u / 0.12 : u > 0.22 ? 1 - (u - 0.22) / 0.78 : 1) * 0.9 * C.gain;
          const r = p.s * (1 + 0.55 * u);
          ctx.fillStyle = `rgba(${p.hot ? C.hot : C.spark}, ${op.toFixed(3)})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.fill();
        }
      }
      if (glow > 0.01) {
        ctx.strokeStyle = `rgba(${C.ring}, ${(0.75 * glow * C.gain).toFixed(3)})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.arc(E.x, E.y, 7.5, 0, 6.2832); ctx.stroke();
      }
      const moving = Math.hypot(ptr.x - E.x, ptr.y - E.y) > 0.3;
      // keep running while sparks live, the ring is catching up, the glow is changing, or the pointer rests inside (the breath)
      if (!still && (live || moving || Math.abs(want - glow) > 0.01 || (inside && idle < 20))) raf = requestAnimationFrame(frame);
      else if (still && Math.abs(want - glow) > 0.01) raf = requestAnimationFrame(frame);
      else { last = 0; if (glow <= 0.012) ctx.clearRect(0, 0, w, h); }
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const move = (e) => {
      if (e.pointerType === 'touch') return;
      ptr.x = e.clientX; ptr.y = e.clientY;
      if (!seen) { seen = true; E.x = E.lx = ptr.x; E.y = E.ly = ptr.y; }
      inside = true; lastMove = performance.now();
      kick();
    };
    const out = () => { inside = false; kick(); };
    const vis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; last = 0; } else kick(); };
    fit();
    addEventListener('resize', fit);
    addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', out);
    addEventListener('blur', out);
    document.addEventListener('visibilitychange', vis);
    window.__cursorLight = { get glow() { return glow; }, get ring() { return { x: E.x, y: E.y }; }, get running() { return !!raf; }, get sparks() { return live; }, get spawned() { return spawned; }, get still() { return still; } };   // read by the automated tests
    return () => {
      removeEventListener('resize', fit); removeEventListener('pointermove', move); document.documentElement.removeEventListener('pointerleave', out);
      removeEventListener('blur', out); document.removeEventListener('visibilitychange', vis); cancelAnimationFrame(raf); delete window.__cursorLight;
    };
  }, []);
  return <canvas ref={ref} className="cursor-light" aria-hidden="true" />;
}
