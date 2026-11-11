import { useEffect, useRef, useState } from 'react';

// Light / dark switch that stays in the top-right corner of the viewport.
// The knob inside can be dragged; a click or the keyboard also works. Moving it lets a few
// cherry petals drift down from the switch (none when the user prefers reduced motion).

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const TRAVEL = 30;          // px the knob moves between the two ends
const MAX_PER_GESTURE = 5;  // petals per drag / click
const MAX_LIVE = 8;         // petals on screen at once
const GAP_MS = 260;         // minimum time between petals while dragging

// Dot-matrix icons, as in the reference switch.
const MOON = ['..###..', '.###...', '###....', '###....', '###...#', '.#####.', '..###..'];
const SUN = ['...#...', '.#...#.', '..###..', '#.###.#', '..###..', '.#...#.', '...#...'];
function Dots({ rows }) {
  return (
    <svg viewBox="0 0 7 7" width="14" height="14" aria-hidden="true">
      {rows.flatMap((r, y) => [...r].map((ch, x) => (ch === '#' ? <rect key={`${x}-${y}`} x={x + 0.12} y={y + 0.12} width="0.76" height="0.76" rx="0.2" fill="currentColor" /> : null)))}
    </svg>
  );
}

export default function ThemeToggle({ theme, onChange }) {
  const btn = useRef(null);
  const layer = useRef(null);
  const drag = useRef(null);       // { x0, pos0, moved, petals, last }
  const skipClick = useRef(false);
  const [pos, setPos] = useState(null); // 0..1 while dragging, else null
  const light = theme === 'light';

  useEffect(() => () => layer.current?.replaceChildren(), []);

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
    return [r.left + 17 + TRAVEL * p, r.top + r.height / 2 + 6];
  };
  // a small, staggered handful for a click or key press
  const burst = (p) => {
    const n = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) setTimeout(() => { if (btn.current) petal(...knobPoint(p).map((v, k) => v + (k ? 0 : (Math.random() - 0.5) * 16))); }, i * 130);
  };

  const commit = (toLight, withPetals) => {
    if (toLight !== light) onChange(toLight ? 'light' : 'dark');
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
      setPos(null);
      commit(p > 0.5, false);
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

  const p = pos ?? (light ? 1 : 0);
  return (
    <>
      <div className="petal-layer" ref={layer} aria-hidden="true" />
      <button
        ref={btn} type="button" role="switch" aria-checked={light} aria-label="Light theme"
        title={light ? 'Light theme is on. Drag or press to switch to dark.' : 'Dark theme is on. Drag or press to switch to light.'}
        className={'theme-toggle' + (pos != null ? ' dragging' : '') + (p > 0.5 ? ' to-light' : ' to-dark')}
        style={{ '--k': p }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClick={click} onKeyDown={key}
      >
        <span className="tt-track" />
        <span className="tt-knob">
          <span className="tt-ico moon"><Dots rows={MOON} /></span>
          <span className="tt-ico sun"><Dots rows={SUN} /></span>
        </span>
        <span className="tt-state" aria-hidden="true">{light ? 'Light' : 'Dark'}</span>
      </button>
    </>
  );
}
