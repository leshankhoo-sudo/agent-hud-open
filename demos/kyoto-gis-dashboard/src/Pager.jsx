import { useEffect, useRef, useState } from 'react';

// Page counter on the right edge: a column of numbers, the part you are in large with a short
// line beside it, the others small and faint. Each number is a button to that part.
// Hidden over the map (the dashboard has its own panels on that side) and on phones.
// Positions are measured only when something changes size, never inside the scroll frame.
export const PAGES = [['top', 'Cover'], ['seasons', 'Seasons'], ['panorama', 'Look around'], ['explore', 'Places'], ['features', 'Features'], ['dashboard', 'Map'], ['credits', 'Team']];
const pad = (i) => String(i + 1).padStart(2, '0');
// parts whose background is light in the light theme
const PALE = new Set(['explore', 'features', 'credits']);

export default function Pager({ theme }) {
  const [cur, setCur] = useState(0);
  const curRef = useRef(0);
  useEffect(() => {
    let raf = 0, stale = true, tops = [];
    const measure = () => {
      stale = false;
      const y = scrollY;
      tops = PAGES.map(([id]) => { const e = document.getElementById(id); if (!e) return null; return e.getBoundingClientRect().top + y; });
    };
    const update = () => {
      raf = 0;
      if (stale) measure();
      const mid = scrollY + innerHeight / 2;
      let i = 0;
      tops.forEach((t, k) => { if (t != null && mid >= t) i = k; });
      if (i !== curRef.current) { curRef.current = i; setCur(i); }
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
  const go = (i) => document.getElementById(PAGES[i][0])?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const id = PAGES[cur][0];
  return (
    <nav className={'pager' + (theme === 'light' && PALE.has(id) ? ' ink' : '') + (id === 'dashboard' ? ' off' : '')} aria-label="Page">
      {PAGES.map(([pid, label], i) => (
        <button key={pid} type="button" className={i === cur ? 'on' : ''} aria-current={i === cur ? 'step' : undefined} aria-label={`${pad(i)} ${label}`} onClick={() => go(i)}>{pad(i)}</button>
      ))}
    </nav>
  );
}
