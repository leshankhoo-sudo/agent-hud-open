import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

// Light / dark switch that stays in the top-right corner of the viewport.
// The knob inside can be dragged; a click or the keyboard also works. Moving it lets a few
// cherry petals drift down from the switch (none when the user prefers reduced motion).
//
// Speed: a click must answer in the very next frame. So the knob is moved by writing CSS
// variables straight onto the button (no React render per frame); inside the view transition only
// the <html data-theme> attribute changes; React, the map and the other canvases then follow as a
// non-urgent update while the wave is already running (the new side of a view transition is live).

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const TRAVEL = 32;          // px the knob moves between the two ends
const MAX_PER_GESTURE = 5;  // petals per drag / click
const MAX_LIVE = 8;         // petals on screen at once
const GAP_MS = 260;         // minimum time between petals while dragging

// Three water rings spreading from the knob, drawn on one short-lived canvas. They used to be three
// elements whose width and height grew to 260vmax with blurred shadows, which made the browser lay
// out and repaint the whole screen every frame. Same timing, size, colours and soft glow.
const bez = (x1, y1, x2, y2) => (x) => {
  let t = x;
  for (let i = 0; i < 8; i++) {
    const fx = 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3 - x;
    const d = 3 * x1 * (1 - t) ** 2 + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t * t;
    if (Math.abs(d) < 1e-6) break;
    t = Math.min(1, Math.max(0, t - fx / d));
  }
  return 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
};
const ringEase = bez(0.2, 0.6, 0.3, 1);
function rings(x, y, light) {
  document.querySelectorAll('canvas.tt-ripples').forEach((old) => old.remove());
  const c = document.createElement('canvas');
  const dpr = Math.min(devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
  c.className = 'tt-ripples';
  c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
  document.body.appendChild(c);
  const g = c.getContext('2d');
  const rgb = light ? '120,95,70' : '255,255,255', line = light ? 0.4 : 0.55, glow = light ? 0.12 : 0.18;
  const maxR = 1.3 * Math.max(W, H), t0 = performance.now();
  const step = (now) => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    let alive = false;
    for (let i = 0; i < 3; i++) {
      const t = (now - t0 - i * 160) / 1500;
      if (t < 0) { alive = true; continue; }
      if (t >= 1) continue;
      alive = true;
      const e = ringEase(t), r = 12 + (maxR - 12) * e, a = 0.85 * (1 - e);
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
      g.lineWidth = 16; g.strokeStyle = `rgba(${rgb},${(glow * 0.32 * a).toFixed(3)})`; g.stroke();
      g.lineWidth = 6; g.strokeStyle = `rgba(${rgb},${(glow * 0.6 * a).toFixed(3)})`; g.stroke();
      g.lineWidth = 1.5; g.strokeStyle = `rgba(${rgb},${(line * a).toFixed(3)})`; g.stroke();
    }
    if (alive && c.isConnected) requestAnimationFrame(step); else c.remove();
  };
  requestAnimationFrame(step);
}

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
  const kRef = useRef(theme === 'light' ? 1 : 0); // knob position shown, 0 dark .. 1 light
  const tween = useRef(0);
  const tweenTo = useRef(null);
  const [shown, setShown] = useState(theme); // the theme the switch shows; changes at once on a click
  useEffect(() => { setShown(theme); }, [theme]);
  const light = shown === 'light';

  // The knob's place drives its colours through --k and --s, written straight to the element.
  const paint = (p) => {
    kRef.current = p;
    const el = btn.current;
    if (!el) return;
    el.style.setProperty('--k', p.toFixed(3));
    el.style.setProperty('--s', Math.sin(Math.PI * p).toFixed(3));
    el.classList.toggle('to-light', p > 0.5);
    el.classList.toggle('to-dark', p <= 0.5);
  };
  useLayoutEffect(() => { paint(pos ?? kRef.current); }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { layer.current?.replaceChildren(); cancelAnimationFrame(tween.current); }, []);
  // The knob glides to its end; dots scatter on the way (instant with reduced motion).
  const glide = (to, lead = 0) => {
    if (tweenTo.current === to) return; // already on its way there
    cancelAnimationFrame(tween.current);
    if (reduceMotion() || kRef.current === to) { tweenTo.current = null; paint(to); return; }
    tweenTo.current = to;
    const from = kRef.current, t0 = performance.now() - lead, dur = 260 + 260 * Math.abs(to - from);
    const step = (now) => {
      const t = Math.min(1, Math.max(0, now - t0) / dur);
      paint(from + (to - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) tween.current = requestAnimationFrame(step); else tweenTo.current = null;
    };
    tween.current = requestAnimationFrame(step);
  };
  useEffect(() => { if (pos == null) glide(light ? 1 : 0); }, [light, pos]); // eslint-disable-line react-hooks/exhaustive-deps

  const petal = (x, y) => {
    const host = layer.current;
    if (!host || reduceMotion() || host.childElementCount >= MAX_LIVE) return false;
    const el = document.createElement('i');
    // Shape and colour follow the season theme in CSS. Summer nights get fireflies that rise; snow barely turns.
    const root = document.documentElement.dataset;
    const firefly = root.season === 'summer' && root.theme !== 'light';
    const snow = root.season === 'winter';
    const size = firefly ? 4 + Math.random() * 2 : snow ? 4 + Math.random() * 4 : 7 + Math.random() * 5;
    el.style.cssText = `left:${x - size / 2}px;top:${y}px;width:${size}px;height:${size * (firefly || snow ? 1 : 1.15)}px`;
    host.appendChild(el);
    const dx = (Math.random() - 0.5) * 70, sway = 14 + Math.random() * 12, r0 = Math.random() * 360;
    const fall = (firefly ? -1 : 1) * (130 + Math.random() * 90);
    const spin = (snow || firefly ? 0.15 : 1) * (Math.random() < 0.5 ? -1 : 1) * (140 + Math.random() * 160);
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
      const motion = !reduceMotion();
      const [x, y] = knobPoint(pos ?? kRef.current);
      setShown(next);
      glide(toLight ? 1 : 0, 40); // the knob sets off in the very next frame, already a visible step along
      if (motion) rings(x, y - 6, toLight); // water rings spreading from the knob
      const root = document.documentElement;
      const apply = () => { root.dataset.theme = next; startTransition(() => onChange(next)); };
      // The new theme spreads over the page like a wave rolling out from the knob. Its centre and
      // radius live only on the transition layer (setting them on <html> made the browser restyle
      // every element before it could even take the snapshot).
      if (document.startViewTransition && motion) {
        // Starting a view transition pauses drawing while the page is captured. Waiting one frame
        // first lets the knob and the rings show their first step right away.
        requestAnimationFrame(() => setTimeout(() => {
        const vt = document.startViewTransition(apply);
        const at = { '--vt-x': `${x}px`, '--vt-y': `${y - 6}px` };
        vt.ready.then(() => root.animate(
          [{ ...at, '--vt-r': '0px' }, { ...at, '--vt-r': `${Math.round(1.75 * Math.max(innerWidth, innerHeight))}px` }],
          { duration: 700, easing: 'cubic-bezier(.22, .7, .25, 1)', fill: 'both', pseudoElement: '::view-transition-new(root)' },
        )).catch(() => {});
        }, 0));
      } else apply();
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
    paint(p);
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
      paint(p);
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

  return (
    <>
      <div className="petal-layer" ref={layer} aria-hidden="true" />
      <button
        ref={btn} type="button" role="switch" aria-checked={light} aria-label="Light theme"
        title={light ? 'Light theme is on. Drag or press to switch to dark.' : 'Dark theme is on. Drag or press to switch to light.'}
        className={'theme-toggle' + (pos != null ? ' dragging' : '')}
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
