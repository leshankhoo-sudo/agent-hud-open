import { useEffect, useRef, useState } from 'react';
import { useScene } from './lib/depth.js';

// "What the dashboard does": a row of tall glass panels with vertical titles. The panel under the
// pointer (or with keyboard focus) opens sideways and shows a short description and a button that
// goes straight to that feature in the dashboard; the others fold to narrow strips. On phones the
// same panels stack and open downwards. Motion idea from a reference clip; content is ours.

const ICONS = {
  map: <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" />,
  density: <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="6.5" opacity=".6" /><circle cx="12" cy="12" r="10" opacity=".3" /></>,
  walk: <><circle cx="13" cy="4.5" r="1.8" /><path d="M10 21l2-6-2.5-2.500L11 8l3 3 3 1M8 13l1.5-4.5" /></>,
  weather: <><circle cx="8" cy="9" r="3" /><path d="M8 3v1.500M3 9h1.500M4.5 5.500l1 1M7 19h10a4 4 0 0 0 .400-8 5.5 5.5 0 0 0-9.4-1" /></>,
  fares: <><rect x="3" y="6" width="18" height="12" rx="2.5" /><path d="M3 10h18M7 15h3" /></>,
  sources: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>,
};

// A soft light inside the panel follows the pointer closely (about 60 ms behind), and fades when the
// pointer moves to another panel or leaves. Positions are written straight to CSS variables, one frame loop.
function useFollowLight(row) {
  useEffect(() => {
    const el = row.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const lights = new Map();   // panel -> { x, y, o, tx, ty, to }
    let raf = 0, last = 0;
    const frame = (now) => {
      raf = 0;
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      const kp = 1 - Math.exp(-dt / 60), ko = 1 - Math.exp(-dt / 140);
      let moving = false;
      for (const [panel, l] of lights) {
        l.x += (l.tx - l.x) * kp; l.y += (l.ty - l.y) * kp; l.o += (l.to - l.o) * ko;
        panel.style.setProperty('--lx', `${l.x.toFixed(1)}px`);
        panel.style.setProperty('--ly', `${l.y.toFixed(1)}px`);
        panel.style.setProperty('--lo', l.o.toFixed(3));
        if (Math.abs(l.tx - l.x) > 0.3 || Math.abs(l.ty - l.y) > 0.3 || Math.abs(l.to - l.o) > 0.003) moving = true;
        else if (l.to === 0) { lights.delete(panel); panel.style.setProperty('--lo', '0'); }
      }
      if (moving) raf = requestAnimationFrame(frame); else last = 0;
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const move = (e) => {
      if (e.pointerType === 'touch') return;
      const panel = e.target.closest?.('.ft-panel');
      for (const [p, l] of lights) if (p !== panel) l.to = 0;
      if (panel) {
        const r = panel.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        let l = lights.get(panel);
        if (!l) { l = { x, y, o: 0 }; lights.set(panel, l); }
        l.tx = x; l.ty = y; l.to = 1;
      }
      kick();
    };
    const leave = () => { for (const l of lights.values()) l.to = 0; kick(); };
    el.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); cancelAnimationFrame(raf); };
  }, [row]);
}

export default function Features({ items, onOpen }) {
  const root = useRef(null), row = useRef(null);
  useScene(root);
  useFollowLight(row);
  const [open, setOpen] = useState(0);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { threshold: 0.2 });
    io.observe(root.current);
    return () => io.disconnect();
  }, []);
  return (
    <section className={'features' + (seen ? ' on' : '')} ref={root} id="features" aria-labelledby="ft-title">
      <header className="ft-head">
        <p className="ft-eyebrow">INSIDE THE DASHBOARD</p>
        <h2 id="ft-title">Six ways to <em>read</em> the map</h2>
      </header>
      <div className="ft-row" ref={row}>
        {items.map((it, i) => (
          <article key={it.key} className={'ft-panel' + (open === i ? ' open' : '')} style={{ '--i': i, '--hue': it.hue }}
            onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpen(i); }} onFocus={() => setOpen(i)}>
            <span className="ft-blob" aria-hidden="true" />
            <span className="ft-light" aria-hidden="true" />
            <button type="button" className="ft-toggle" aria-expanded={open === i} aria-controls={`ft-body-${it.key}`} onClick={() => setOpen(i)}>
              <span className="ft-title">{it.title}</span>
              <svg className="ft-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[it.key]}</svg>
            </button>
            <div className="ft-body" id={`ft-body-${it.key}`} aria-hidden={open !== i}>
              <span className="ft-num">{String(i + 1).padStart(2, '0')}</span>
              <h3>{it.title}</h3>
              <p>{it.text}</p>
              {it.note && <p className="ft-note">{it.note}</p>}
              <button type="button" className="ft-go" tabIndex={open === i ? 0 : -1} onClick={() => onOpen(it.key)}>{it.action} <span aria-hidden="true">→</span></button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
