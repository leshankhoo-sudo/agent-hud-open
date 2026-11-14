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

const scenes = new Map(); // el -> { p, seen, top, h, out: {} }
let io = null, ro = null, raf = 0, started = false, stale = true;
// Where each section sits on the page is measured only when something changes size, never inside
// the animation frame: reading layout there would force the browser to finish any pending style
// work first (for example the whole page restyling during a theme switch), every frame.
function measure() {
  stale = false;
  const y = (sy = scrollY); vh = innerHeight || 1;
  for (const [el, s] of scenes) { const r = el.getBoundingClientRect(); s.top = r.top + y; s.h = r.height; }
}
// write a variable only when its text changes: each write restyles the section
const put = (el, s, k, v) => { if (s.out[k] !== v) { s.out[k] = v; el.style.setProperty(k, v); } };
let mx = 0, my = 0, tx = 0, ty = 0, last = 0, dirty = false;
// the scroll position, read when the page scrolls, not in the frame: reading it there would make the
// browser lay the page out early whenever anything else had just changed (a drag of the volume, say)
let sy = 0, vh = 1;
const onScroll = () => { sy = scrollY; kick(); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function frame(now) {
  raf = 0;
  const dt = Math.min(0.2, (now - (last || now)) / 1000) || 0.016; last = now;
  const km = 1 - Math.exp(-dt * 4.2), kp = 1 - Math.exp(-dt * 12);
  mx += (tx - mx) * km; my += (ty - my) * km;
  let moving = Math.abs(tx - mx) > 0.0008 || Math.abs(ty - my) > 0.0008;
  // nothing on screen to move (the map page, for example): only the pointer is eased
  let any = false; for (const s of scenes.values()) if (s.seen) { any = true; break; }
  if (!any) { if (moving) raf = requestAnimationFrame(frame); else last = 0; dirty = false; return; }
  if (stale) measure();
  const y = sy;
  for (const [el, s] of scenes) {
    if (!s.seen) continue;
    const top = s.top - y;
    const target = clamp((top + s.h / 2 - vh / 2) / ((vh + s.h) / 2), -1, 1);
    if (s.p == null) s.p = target;
    s.p += (target - s.p) * kp;
    if (Math.abs(target - s.p) > 0.0005) moving = true; else s.p = target;
    // the observer wakes sections a little before they scroll in; write only to those really on screen
    if (top >= vh || top + s.h <= 0) continue;
    put(el, s, '--p', s.p.toFixed(4));
    put(el, s, '--mx', mx.toFixed(4));
    put(el, s, '--my', my.toFixed(4));
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
  sy = scrollY; vh = innerHeight || 1;
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', () => { stale = true; kick(); }, { passive: true });
  // any section changing height moves the ones below it
  ro = new ResizeObserver(() => { stale = true; kick(); });
  ro.observe(document.body);
  document.documentElement.addEventListener('pointerleave', onLeave);
}

export function watchScene(el) {
  if (!el || typeof IntersectionObserver !== 'function' || reduce()) return () => {};
  start();
  scenes.set(el, { p: null, seen: false, top: 0, h: 0, out: {} });
  stale = true;
  io.observe(el); ro.observe(el);
  return () => { io.unobserve(el); ro.unobserve(el); scenes.delete(el); };
}

// React: const ref = useRef(null); useScene(ref);
export function useScene(ref) {
  useEffect(() => watchScene(ref.current), [ref]);
}

// The eased pointer, for canvas scenes that draw their own layers.
export const pointer = () => [mx, my];
