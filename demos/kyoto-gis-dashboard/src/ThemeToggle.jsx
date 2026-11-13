import { startTransition, useEffect, useLayoutEffect, useRef } from 'react';
import { createGlassSwitch, DESIGN, pageColor } from './lib/glassSwitch.js';
import { rgba } from './lib/oklab.js';

// Day / night switch, fixed in the top-right corner. It is a small physical object drawn on a
// canvas (lib/glassSwitch.js): a recessed glass track and a frosted soft-glass key with a dot-matrix
// moon that turns into a sun, an edge light that travels round the key, and silicone-like give
// when it is pressed, flung or pushed against an end. A transparent button on top takes the
// pointer, keyboard and screen reader; the canvas takes no events.
//
// The theme itself changes once, when the end is decided (on release, click or key), through the
// same wave, water rings and petals as before; dragging only moves the key. Nothing here renders
// React per frame: the drag and the springs live inside the canvas object.
// For screenshots: ?t=0.35 in the URL shows the key held at that point (0 night .. 1 day).

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const MAX_PER_GESTURE = 5;  // petals per drag / click
const MAX_LIVE = 8;         // petals on screen at once
const GAP_MS = 260;         // minimum time between petals while dragging
const debugT = () => { try { const v = new URLSearchParams(location.search).get('t'); const n = v == null ? NaN : Number(v); return n >= 0 && n <= 1 ? n : null; } catch { return null; } };

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

export default function ThemeToggle({ theme, onChange }) {
  const btn = useRef(null);
  const cv = useRef(null);
  const layer = useRef(null);
  const eng = useRef(null);
  const drag = useRef(null);       // { x0, moved, petals, last }
  const skipClick = useRef(false);
  const light = theme === 'light';
  const lightRef = useRef(light); // the theme the switch is heading to (may lead the prop by a frame)

  // the canvas object lives as long as the button
  useLayoutEffect(() => {
    const fixed = debugT();
    const e = createGlassSwitch(cv.current, {
      reduceMotion: reduceMotion(),
      // a light CSS colour variable on the switch itself (not the page: writing a variable on <html>
      // every frame would restyle every element of the dashboard)
      onFrame: (t) => btn.current?.style.setProperty('--tt-page', rgba(pageColor(t))),
    });
    eng.current = e;
    cv.current.__glass = e; // for timing tests
    e.set(fixed ?? (light ? 1 : 0));
    if (fixed != null) e.freeze();
    const ro = new ResizeObserver(() => e.resize(btn.current.clientHeight));
    ro.observe(btn.current);
    e.resize(btn.current.clientHeight);
    return () => { ro.disconnect(); e.destroy(); eng.current = null; layer.current?.replaceChildren(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // a theme set from elsewhere (first load, keyboard, another tab) moves the key too
  useEffect(() => {
    lightRef.current = light;
    const e = eng.current;
    if (e && Math.abs(e.t - (light ? 1 : 0)) > 0.001 && !drag.current) e.animateTo(light ? 1 : 0);
  }, [light]);

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
  // the key's centre on screen, in CSS pixels
  const knobPoint = () => {
    const r = btn.current.getBoundingClientRect(), s = r.height / DESIGN.TH;
    const [x, y] = eng.current ? eng.current.knobCenter() : [DESIGN.M + DESIGN.K / 2, DESIGN.TH / 2];
    return [r.left + x * s, r.top + y * s];
  };
  // a small, staggered handful for a click or key press
  const burst = () => {
    const n = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) setTimeout(() => { if (btn.current) { const [x, y] = knobPoint(); petal(x + (Math.random() - 0.5) * 16, y + 6); } }, 120 + i * 130);
  };

  // the end has been decided: change the theme once, with the wave, rings and petals
  const commit = (toLight, withPetals) => {
    const was = lightRef.current;
    lightRef.current = toLight;
    if (toLight !== was) {
      const next = toLight ? 'light' : 'dark';
      const motion = !reduceMotion();
      const [x, y] = knobPoint();
      if (motion) rings(x, y, toLight); // water rings spreading from the key
      const root = document.documentElement;
      const apply = () => {
        root.dataset.theme = next;
        btn.current?.setAttribute('aria-checked', String(toLight));
        btn.current?.dispatchEvent(new Event('change', { bubbles: true }));
        startTransition(() => onChange(next));
      };
      // The new theme spreads over the page like a wave rolling out from the key. Its centre and
      // radius live only on the transition layer. Starting a view transition pauses drawing while
      // the page is captured, so the key is given one frame to set off first.
      if (document.startViewTransition && motion) {
        requestAnimationFrame(() => setTimeout(() => {
          const vt = document.startViewTransition(apply);
          const at = { '--vt-x': `${x}px`, '--vt-y': `${y}px` };
          vt.ready.then(() => root.animate(
            [{ ...at, '--vt-r': '0px' }, { ...at, '--vt-r': `${Math.round(1.75 * Math.max(innerWidth, innerHeight))}px` }],
            { duration: 700, easing: 'cubic-bezier(.22, .7, .25, 1)', fill: 'both', pseudoElement: '::view-transition-new(root)' },
          )).catch(() => {});
        }, 0));
      } else apply();
    }
    if (withPetals) burst();
  };
  const go = (toLight, withPetals) => { eng.current?.animateTo(toLight ? 1 : 0); commit(toLight, withPetals && toLight !== lightRef.current); };

  const down = (e) => {
    if (e.button != null && e.button !== 0) return;
    drag.current = { x0: e.clientX, moved: false, petals: 0, last: 0 };
    btn.current.setPointerCapture?.(e.pointerId);
    eng.current?.down(e.clientX);
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return; // under 4 px it is still a click
    d.moved = true;
    eng.current?.move(e.clientX);
    const now = performance.now();
    if (d.petals < MAX_PER_GESTURE && now - d.last > GAP_MS) {
      const [x, y] = knobPoint();
      if (petal(x + (Math.random() - 0.5) * 10, y + 6)) { d.petals++; d.last = now; }
    }
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      skipClick.current = true; // the click that follows a drag must not toggle again
      setTimeout(() => { skipClick.current = false; }, 0);
      const end = eng.current?.up();
      if (end != null) commit(end === 1, false);
    } else {
      eng.current?.up({ toggle: true }); // let go of the press; the click handler toggles
    }
  };
  const click = () => {
    if (skipClick.current) { skipClick.current = false; return; }
    go(!lightRef.current, true);
  };
  const key = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(true, true); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(false, true); }
    // Space and Enter reach `click` through the button itself
  };

  return (
    <>
      <div className="petal-layer" ref={layer} aria-hidden="true" />
      <button
        ref={btn} type="button" role="switch" aria-checked={light} aria-label="Light theme"
        title={light ? 'Light theme is on. Drag or press to switch to dark.' : 'Dark theme is on. Drag or press to switch to light.'}
        className="theme-toggle"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClick={click} onKeyDown={key}
      >
        <canvas ref={cv} className="tt-canvas" aria-hidden="true" />
      </button>
    </>
  );
}
