// Soft light inside the glass cards of the information panel that answers to the pointer (dark theme).
// Each card has two faint resting glows that drift slowly (CSS). When the pointer comes near a card, the nearer glow drifts
// toward it and spreads, the far one moves a little away, and the card's edge lights up next to the pointer.
// When the pointer leaves, everything eases back slowly. Only custom properties are written (no layout),
// the loop runs only while something is still moving, and it is not installed with "reduce motion".
const NEAR = 150;              // px from a card's edge at which the light starts to answer
const IN = 110, OUT = 480;     // ms: quick to follow, slow to recover (time based, so the same at any frame rate)
const VARS = ['--gdx', '--gdy', '--hdx', '--hdy', '--px', '--py', '--gp'];

export function installGlassGlow() {   // the panel can be closed and reopened, so its cards are looked up each frame
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const state = new WeakMap();
  let ptr = null, raf = 0, last = 0;
  const dark = () => document.documentElement.dataset.theme !== 'light';
  const clear = (c) => { for (const k of VARS) c.style.removeProperty(k); };
  const frame = (now) => {
    raf = 0;
    const dt = last ? Math.min(100, now - last) : 16;
    last = now;
    const kIn = 1 - Math.exp(-dt / IN), kOut = 1 - Math.exp(-dt / OUT), kPos = 1 - Math.exp(-dt / 90);
    const cards = document.querySelectorAll('#dashboard .right.panel .card');
    if (!dark()) { cards.forEach((c) => { clear(c); state.delete(c); }); return; }
    let moving = false;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      let s = state.get(c);
      if (!s) { s = { p: 0, x: r.width / 2, y: r.height / 2 }; state.set(c, s); }
      let want = 0;
      if (ptr) {
        const dx = Math.max(r.left - ptr.x, 0, ptr.x - r.right), dy = Math.max(r.top - ptr.y, 0, ptr.y - r.bottom);
        want = Math.max(0, 1 - Math.hypot(dx, dy) / NEAR);
        if (want > 0) {
          const tx = ptr.x - r.left, ty = ptr.y - r.top;
          if (s.p < 0.02) { s.x = tx; s.y = ty; } else { s.x += (tx - s.x) * kPos; s.y += (ty - s.y) * kPos; }
        }
      }
      const d = want - s.p;
      if (want === 0 && s.p < 0.004) { if (s.p !== 0) { s.p = 0; clear(c); } continue; }
      s.p += d * (d > 0 ? kIn : kOut);
      moving = true;
      const p = s.p * s.p * (3 - 2 * s.p);   // smooth in and out
      const gx0 = r.width * 0.16, hx0 = r.width * 0.9, hy0 = r.height;   // where the two glows rest (see the CSS)
      c.style.setProperty('--gdx', `${((s.x - gx0) * 0.6 * p).toFixed(1)}px`);
      c.style.setProperty('--gdy', `${(s.y * 0.6 * p).toFixed(1)}px`);
      c.style.setProperty('--hdx', `${((hx0 - s.x) * 0.14 * p).toFixed(1)}px`);
      c.style.setProperty('--hdy', `${((hy0 - s.y) * 0.14 * p).toFixed(1)}px`);
      c.style.setProperty('--px', `${s.x.toFixed(1)}px`);
      c.style.setProperty('--py', `${s.y.toFixed(1)}px`);
      c.style.setProperty('--gp', p.toFixed(3));
    }
    if (moving) raf = requestAnimationFrame(frame); else last = 0;
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  const move = (e) => { if (e.pointerType === 'touch') return; ptr = { x: e.clientX, y: e.clientY }; kick(); };
  const leave = () => { ptr = null; kick(); };
  addEventListener('pointermove', move, { passive: true });
  document.documentElement.addEventListener('pointerleave', leave);
  document.addEventListener('scroll', kick, { passive: true, capture: true });
  return () => {
    removeEventListener('pointermove', move); document.documentElement.removeEventListener('pointerleave', leave);
    document.removeEventListener('scroll', kick, { capture: true }); cancelAnimationFrame(raf);
  };
}
