import { useEffect, useRef } from 'react';

// Site-wide pointer light (after the reference recording): a small ring that follows the pointer a
// beat late, with a cloud of thin sparks. While the pointer moves the sparks string out behind it as
// short streaks, like a comet tail that swings when the direction changes; when it stops they gather
// and drift round the ring, then dim. One fixed canvas for the whole page: it takes no pointer events,
// uses client coordinates (so scrolling never offsets it), sleeps when nothing moves, and is not
// started on touch-only devices or with "reduce motion". Written for this project; no third-party code.
// A 'cursor-burst' window event ({ detail: { x, y } }) throws a handful of small squares from a point.
const N = 44;

export default function CursorLight() {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(hover: hover) and (pointer: fine)').matches) return undefined;
    const ctx = cv.getContext('2d');
    let w = 0, h = 0, dpr = 1, raf = 0, last = 0, seen = false, inside = false, lastMove = 0, glow = 0;
    const ptr = { x: 0, y: 0 }, ring = { x: 0, y: 0, vx: 0, vy: 0 };
    // every spark is a small spring that chases a point near the ring; stiffness differs, so they string out
    const sp = Array.from({ length: N }, (_, i) => {
      const r = (k) => { const x = Math.sin((i + 1) * 12.9898 * k) * 43758.5453; return x - Math.floor(x); };
      return { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, k: 26 + r(1) * 150, c: 7 + r(2) * 9, a: r(3) * 6.283, rad: 5 + r(4) * 17, spin: (r(5) - 0.5) * 3.2, w: 0.6 + r(6) * 0.9, hot: r(7) > 0.72 };
    });
    const bits = [];   // squares thrown by a burst
    const fit = () => {
      dpr = Math.min(2, devicePixelRatio || 1);
      w = innerWidth; h = innerHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    };
    const colours = () => (document.documentElement.dataset.theme === 'light'
      ? { ring: '180, 84, 58', spark: '196, 92, 60', hot: '120, 52, 34', blend: 'source-over', gain: 0.85 }
      : { ring: '214, 246, 247', spark: '138, 226, 229', hot: '255, 255, 255', blend: 'lighter', gain: 1 });
    const frame = (now) => {
      raf = 0;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;
      const idle = (now - lastMove) / 1000;
      const want = inside ? (idle < 2.2 ? 1 : 0.38) : 0;
      glow += (want - glow) * (1 - Math.exp(-dt * (want > glow ? 9 : 2.2)));
      // the ring follows a beat late
      const k = 170, c = 22;
      ring.vx += ((ptr.x - ring.x) * k - ring.vx * c) * dt; ring.vy += ((ptr.y - ring.y) * k - ring.vy * c) * dt;
      ring.x += ring.vx * dt; ring.y += ring.vy * dt;
      const C = colours();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = C.blend;
      ctx.lineCap = 'round';
      let energy = Math.hypot(ring.vx, ring.vy);
      for (const s of sp) {
        s.a += s.spin * dt;
        const tx = ring.x + Math.cos(s.a) * s.rad, ty = ring.y + Math.sin(s.a) * s.rad * 0.8;
        s.vx += ((tx - s.x) * s.k - s.vx * s.c) * dt; s.vy += ((ty - s.y) * s.k - s.vy * s.c) * dt;
        s.px = s.x; s.py = s.y;
        s.x += s.vx * dt; s.y += s.vy * dt;
        const v = Math.hypot(s.vx, s.vy);
        energy += v / N;
        if (glow < 0.01) continue;
        // a streak along the direction of travel: long when fast, a dot when resting
        const len = Math.min(26, 1.2 + v * 0.03), ux = v > 1 ? s.vx / v : 1, uy = v > 1 ? s.vy / v : 0;
        const al = glow * C.gain * Math.min(1, 0.28 + v * 0.0022) * (s.hot ? 1 : 0.7);
        ctx.strokeStyle = `rgba(${s.hot ? C.hot : C.spark}, ${al.toFixed(3)})`;
        ctx.lineWidth = s.w;
        ctx.beginPath(); ctx.moveTo(s.x - ux * len, s.y - uy * len); ctx.lineTo(s.x, s.y); ctx.stroke();
      }
      if (glow > 0.01) {
        ctx.strokeStyle = `rgba(${C.ring}, ${(0.75 * glow * C.gain).toFixed(3)})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.arc(ring.x, ring.y, 7.5, 0, 6.2832); ctx.stroke();
      }
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i];
        b.t += dt;
        if (b.t >= b.life) { bits.splice(i, 1); continue; }
        b.vy += 260 * dt; b.vx *= 1 - 1.6 * dt; b.vy *= 1 - 1.2 * dt;
        b.x += b.vx * dt; b.y += b.vy * dt;
        const f = 1 - b.t / b.life;
        ctx.fillStyle = `rgba(${b.hot ? C.hot : C.spark}, ${(f * 0.9 * C.gain).toFixed(3)})`;
        ctx.fillRect(b.x - b.s / 2, b.y - b.s / 2, b.s, b.s);
      }
      // sleep once everything has settled or faded; the next pointer move wakes it
      if (bits.length || glow > 0.012 && (energy > 6 || idle < 6) || Math.abs(want - glow) > 0.01) raf = requestAnimationFrame(frame);
      else { last = 0; if (glow <= 0.012) ctx.clearRect(0, 0, w, h); }
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const move = (e) => {
      if (e.pointerType === 'touch') return;
      ptr.x = e.clientX; ptr.y = e.clientY;
      if (!seen) { seen = true; ring.x = ptr.x; ring.y = ptr.y; for (const s of sp) { s.x = s.px = ptr.x; s.y = s.py = ptr.y; } }
      inside = true; lastMove = performance.now();
      kick();
    };
    const out = () => { inside = false; kick(); };
    const burst = (e) => {
      const { x, y } = e.detail || {};
      if (typeof x !== 'number') return;
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * 6.283, v = 90 + Math.random() * 330;
        bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.8 - 70, s: 1.6 + Math.random() * 2.6, t: 0, life: 0.7 + Math.random() * 0.8, hot: Math.random() > 0.6 });
      }
      kick();
    };
    fit();
    addEventListener('resize', fit);
    addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', out);
    addEventListener('blur', out);
    addEventListener('cursor-burst', burst);
    window.__cursorLight = { get glow() { return glow; }, get ring() { return { x: ring.x, y: ring.y }; }, get running() { return !!raf; }, get bits() { return bits.length; } };   // read by the automated tests
    return () => {
      removeEventListener('resize', fit); removeEventListener('pointermove', move); document.documentElement.removeEventListener('pointerleave', out);
      removeEventListener('blur', out); removeEventListener('cursor-burst', burst); cancelAnimationFrame(raf); delete window.__cursorLight;
    };
  }, []);
  return <canvas ref={ref} className="cursor-light" aria-hidden="true" />;
}
