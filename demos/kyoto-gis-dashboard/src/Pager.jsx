import { useEffect, useRef, useState } from 'react';

// Page counter on the right edge, after the travel-site reference: the number of the part of the
// page you are in, large, with the previous and next numbers faint above and below, joined by a
// thin line that fills as you scroll through the current part. The faint numbers are buttons.
// Hidden over the map (the dashboard has its own panels on that side) and on phones.
// Positions are measured only when something changes size, never inside the scroll frame.
export const PAGES = [['top', 'Cover'], ['seasons', 'Seasons'], ['panorama', 'Look around'], ['explore', 'Places'], ['features', 'Features'], ['dashboard', 'Map'], ['credits', 'Team']];
const pad = (i) => String(i + 1).padStart(2, '0');
// parts whose background is light in the light theme
const PALE = new Set(['explore', 'features', 'credits']);

export default function Pager({ theme }) {
  const root = useRef(null);
  const [cur, setCur] = useState(0);
  useEffect(() => {
    let raf = 0, stale = true, tops = [];
    const measure = () => {
      stale = false;
      const y = scrollY;
      tops = PAGES.map(([id]) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return [r.top + y, Math.max(1, r.height)]; });
    };
    const update = () => {
      raf = 0;
      if (stale) measure();
      const mid = scrollY + innerHeight / 2;
      let i = 0;
      tops.forEach((t, k) => { if (t && mid >= t[0]) i = k; });
      const t = tops[i];
      const f = t ? Math.min(1, Math.max(0, (mid - t[0]) / t[1])) : 0;
      root.current?.style.setProperty('--f', f.toFixed(3));
      setCur((c) => (c === i ? c : i));
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(update); };
    const remeasure = () => { stale = true; kick(); };
    const ro = new ResizeObserver(remeasure);
    ro.observe(document.body);
    addEventListener('scroll', kick, { passive: true });
    addEventListener('resize', remeasure, { passive: true });
    kick();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); removeEventListener('scroll', kick); removeEventListener('resize', remeasure); };
  }, []);
  const go = (i) => {
    const e = document.getElementById(PAGES[i]?.[0]);
    if (e) e.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  const id = PAGES[cur][0];
  const tone = theme === 'light' && PALE.has(id) ? ' ink' : '';
  return (
    <nav className={'pager' + tone + (id === 'dashboard' ? ' off' : '')} ref={root} aria-label="Page">
      <button type="button" className="pg-step" onClick={() => go(cur - 1)} disabled={cur === 0} aria-label={cur > 0 ? `Back to ${PAGES[cur - 1][1]}` : 'First part'}>{cur > 0 ? pad(cur - 1) : ''}</button>
      <span className="pg-line" aria-hidden="true" />
      <p className="pg-now" aria-current="step">
        <b key={cur}>{pad(cur)}</b>
        <small>/ {String(PAGES.length).padStart(2, '0')}</small>
        <span>{PAGES[cur][1]}</span>
      </p>
      <span className="pg-line fill" aria-hidden="true"><i /></span>
      <button type="button" className="pg-step" onClick={() => go(cur + 1)} disabled={cur === PAGES.length - 1} aria-label={cur < PAGES.length - 1 ? `On to ${PAGES[cur + 1][1]}` : 'Last part'}>{cur < PAGES.length - 1 ? pad(cur + 1) : ''}</button>
    </nav>
  );
}
