import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

// Light / dark switch that stays in the top-right corner of the viewport.
// The knob inside can be dragged; a click or the keyboard also works. Moving it lets a few
// cherry petals drift down from the switch (none when the user prefers reduced motion).

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const TRAVEL = 32;          // px the knob moves between the two ends
const MAX_PER_GESTURE = 5;  // petals per drag / click
const MAX_LIVE = 8;         // petals on screen at once
const GAP_MS = 260;         // minimum time between petals while dragging

// Dot-matrix icons, as in the reference switch. While the knob travels, the dots scatter into
// loose particles and gather again as the other icon.
const MOON = ['...........', '...###...#.', '..###...###', '.###.....#.', '.###.......', '.###.......', '.####......', '..####..#..', '..#######..', '...#####...', '...........'];
const SUN = ['.....#.....', '.....#.....', '..#.....#..', '...........', '....###....', '##..###..##', '....###....', '...........', '..#.....#..', '.....#.....', '.....#.....'];
function Dots({ rows, seed }) {
  const dots = useMemo(() => {
    let r = seed;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280 - 0.5);
    return rows.flatMap((row, y) => [...row].map((ch, x) => (ch === '#' ? { x, y, dx: rnd() * 9, dy: rnd() * 9 } : null)).filter(Boolean));
  }, [rows, seed]);
  return (
    <svg viewBox="-2 -2 15 15" width="20" height="20" aria-hidden="true">
      {dots.map((d) => <rect key={`${d.x}-${d.y}`} x={d.x + 0.1} y={d.y + 0.1} width="0.8" height="0.8" rx="0.25" fill="currentColor" style={{ transform: `translate(calc(${d.dx.toFixed(2)}px * var(--s, 0)), calc(${d.dy.toFixed(2)}px * var(--s, 0)))` }} />)}
    </svg>
  );
}

export default function ThemeToggle({ theme, onChange }) {
  const btn = useRef(null);
  const layer = useRef(null);
  const drag = useRef(null);       // { x0, pos0, moved, petals, last }
  const skipClick = useRef(false);
  const [pos, setPos] = useState(null); // 0..1 while dragging, else null
  const [k, setK] = useState(theme === 'light' ? 1 : 0); // knob position shown, 0 dark .. 1 light
  const tween = useRef(0);
  const light = theme === 'light';

  useEffect(() => () => { layer.current?.replaceChildren(); cancelAnimationFrame(tween.current); }, []);
  // The knob glides to its end; dots scatter on the way (instant with reduced motion).
  useEffect(() => {
    if (pos != null) return;
    const to = light ? 1 : 0;
    cancelAnimationFrame(tween.current);
    if (reduceMotion()) { setK(to); return; }
    let from = null, t0 = 0;
    const step = (now) => {
      setK((cur) => {
        if (from == null) { from = cur; t0 = now; }
        const t = Math.min(1, (now - t0) / (260 + 260 * Math.abs(to - from)));
        const e = 1 - Math.pow(1 - t, 3);
        if (t < 1) tween.current = requestAnimationFrame(step);
        return from + (to - from) * e;
      });
    };
    tween.current = requestAnimationFrame(step);
  }, [light, pos]);

  const petal = (x, y) => {
    const host = layer.current;
    if (!host || reduceMotion() || host.childElementCount >= MAX_LIVE) return false;
    const el = document.createElement('i');
    const size = 7 + Math.random() * 5;
    el.style.cssText = `left:${x - size / 2}px;top:${y}px;width:${size}px;height:${size * 1.15}px`;
    host.appendChild(el);
    const dx = (Math.random() - 0.5) * 70, fall = 130 + Math.random() * 90, sway = 14 + Math.random() * 12, r0 = Math.random() * 360, spin = (Math.random() < 0.5 ? -1 : 1) * (140 + Math.random() * 160);
    const a = el.animate([
      { transform: `translate(0,0) rotate(${r0}deg) scale(.5)`, opacity: 0 },
      { transform: `translate(${dx * 0.25 + sway}px,${fall * 0.22}px) rotate(${r0 + spin * 0.25}deg) scale(1)`, opacity: 0.95, offset: 0.18 },
      { transform: `translate(${dx * 0.55 - sway}px,${fall * 0.55}px) rotate(${r0 + spin * 0.6}deg) scale(1)`, opacity: 0.8, offset: 0.55 },
      { transform: `translate(${dx}px,${fall}px) rotate(${r0 + spin}deg) scale(.9)`, opacity: 0 },
    ], { duration: 2400 + Math.random() * 1000, easing: 'cubic-bezier(.3,.1,.5,1)' });
    const done = () => el.remove();
    a.onfinish = done;
    a.oncancel = done;
    return true;
  };
  const knobPoint = (p) => {
    const r = btn.current.getBoundingClientRect();
    return [r.left + 18 + TRAVEL * p, r.top + r.height / 2 + 6];
  };
  // a small, staggered handful for a click or key press
  const burst = (p) => {
    const n = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) setTimeout(() => { if (btn.current) petal(...knobPoint(p).map((v, k) => v + (k ? 0 : (Math.random() - 0.5) * 16))); }, i * 130);
  };

  const commit = (toLight, withPetals) => {
    if (toLight !== light) {
      const next = toLight ? 'light' : 'dark';
      // the new theme spreads over the page like a wave rolling out from the knob
      const motion = !reduceMotion();
      const [x, y] = knobPoint(pos ?? k);
      if (motion) { // water rings spreading from the knob
        const rip = document.createElement('div');
        rip.className = 'tt-ripples';
        rip.style.cssText = `left:${x}px;top:${y - 6}px`;
        rip.innerHTML = '<i></i><i></i><i></i>';
        document.body.appendChild(rip);
        setTimeout(() => rip.remove(), 1900);
      }
      if (document.startViewTransition && motion) {
        document.documentElement.style.setProperty('--vt-x', `${x}px`);
        document.documentElement.style.setProperty('--vt-y', `${y - 6}px`);
        document.startViewTransition(() => flushSync(() => onChange(next)));
      } else onChange(next);
    }
    if (withPetals) burst(toLight ? 1 : 0);
  };

  const down = (e) => {
    if (e.button != null && e.button !== 0) return;
    drag.current = { x0: e.clientX, pos0: light ? 1 : 0, moved: false, petals: 0, last: 0 };
    btn.current.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 4) return;
    d.moved = true;
    const p = Math.max(0, Math.min(1, d.pos0 + dx / TRAVEL));
    setPos(p);
    const now = performance.now();
    if (d.petals < MAX_PER_GESTURE && now - d.last > GAP_MS) {
      const [x, y] = knobPoint(p);
      if (petal(x + (Math.random() - 0.5) * 10, y)) { d.petals++; d.last = now; }
    }
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      skipClick.current = true; // the click that follows a drag must not toggle again
      setTimeout(() => { skipClick.current = false; }, 0);
      const p = pos ?? d.pos0;
      setK(p);
      commit(p > 0.5, false);
      setPos(null);
    }
  };
  const click = () => {
    if (skipClick.current) { skipClick.current = false; return; }
    commit(!light, true);
  };
  const key = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); commit(true, !light); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); commit(false, light); }
  };

  const p = pos ?? k;
  return (
    <>
      <div className="petal-layer" ref={layer} aria-hidden="true" />
      <button
        ref={btn} type="button" role="switch" aria-checked={light} aria-label="Light theme"
        title={light ? 'Light theme is on. Drag or press to switch to dark.' : 'Dark theme is on. Drag or press to switch to light.'}
        className={'theme-toggle' + (pos != null ? ' dragging' : '') + (p > 0.5 ? ' to-light' : ' to-dark')}
        style={{ '--k': p.toFixed(3), '--s': Math.sin(Math.PI * p).toFixed(3) }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClick={click} onKeyDown={key}
      >
        <span className="tt-track" />
        <span className="tt-knob">
          <span className="tt-arc" />
          <span className="tt-ico moon"><Dots rows={MOON} seed={7} /></span>
          <span className="tt-ico sun"><Dots rows={SUN} seed={23} /></span>
        </span>
        <span className="tt-state" aria-hidden="true">{light ? 'Light' : 'Dark'}</span>
      </button>
    </>
  );
}
