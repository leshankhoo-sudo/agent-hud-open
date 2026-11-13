// One shared driver for depth effects.
// Every element registered with watchScene() gets three CSS variables while it is on screen:
//   --mx, --my : pointer position relative to the middle of the window, -1..1, eased
//   --p        : where the element's middle sits relative to the middle of the window, -1..1
//                (1 = just entering from below, 0 = centred, -1 = just leaving at the top), eased
// Layers inside the element turn these into transforms in CSS, so near things can move more than
// far things with the pointer and with the scroll. Nothing runs while the values are at rest, the
// variables are only written to elements that are on screen, and touch pointers are ignored (a
// finger is already scrolling). With "prefers-reduced-motion" nothing is written at all.
import { useEffect } from 'react';

const scenes = new Map(); // el -> { p, seen }
let io = null, raf = 0, started = false;
let mx = 0, my = 0, tx = 0, ty = 0, last = 0, dirty = false;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function frame(now) {
  raf = 0;
  const dt = Math.min(0.2, (now - (last || now)) / 1000) || 0.016; last = now;
  const km = 1 - Math.exp(-dt * 4.2), kp = 1 - Math.exp(-dt * 12);
  mx += (tx - mx) * km; my += (ty - my) * km;
  let moving = Math.abs(tx - mx) > 0.0008 || Math.abs(ty - my) > 0.0008;
  const vh = innerHeight || 1;
  for (const [el, s] of scenes) {
    if (!s.seen) continue;
    const r = el.getBoundingClientRect();
    const target = clamp((r.top + r.height / 2 - vh / 2) / ((vh + r.height) / 2), -1, 1);
    if (s.p == null) s.p = target;
    s.p += (target - s.p) * kp;
    if (Math.abs(target - s.p) > 0.0005) moving = true; else s.p = target;
    el.style.setProperty('--p', s.p.toFixed(4));
    el.style.setProperty('--mx', mx.toFixed(4));
    el.style.setProperty('--my', my.toFixed(4));
  }
  if (moving || dirty) { dirty = false; raf = requestAnimationFrame(frame); } else last = 0;
}
const kick = () => { dirty = true; if (!raf) raf = requestAnimationFrame(frame); };
const onMove = (e) => {
  if (e.pointerType === 'touch') return;
  tx = clamp((e.clientX / (innerWidth || 1) - 0.5) * 2, -1, 1);
  ty = clamp((e.clientY / (innerHeight || 1) - 0.5) * 2, -1, 1);
  kick();
};
const onLeave = () => { tx = 0; ty = 0; kick(); };

function start() {
  if (started) return;
  started = true;
  io = new IntersectionObserver((es) => {
    for (const e of es) { const s = scenes.get(e.target); if (s) { s.seen = e.isIntersecting; if (s.seen) s.p = null; } }
    kick();
  }, { rootMargin: '10% 0px' });
  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', kick, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
}

export function watchScene(el) {
  if (!el || typeof IntersectionObserver !== 'function' || reduce()) return () => {};
  start();
  scenes.set(el, { p: null, seen: false });
  io.observe(el);
  return () => { io.unobserve(el); scenes.delete(el); };
}

// React: const ref = useRef(null); useScene(ref);
export function useScene(ref) {
  useEffect(() => watchScene(ref.current), [ref]);
}

// The eased pointer, for canvas scenes that draw their own layers.
export const pointer = () => [mx, my];
