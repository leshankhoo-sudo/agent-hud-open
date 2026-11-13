import { useEffect, useRef, useState } from 'react';
import { SeasonDrift } from './Season.jsx';
import { useScene } from './lib/depth.js';

// "Explore Kyoto": one screen between the scroll intro and the dashboard.
// Layout after a spatial-UI reference: title on top, a cover flow of tall photo cards in the middle
// (the chosen one large, neighbours smaller and tucked behind), fact pills and a frosted bar below.
// The backdrop is a soft, blurred copy of the chosen photo and cross-fades when the card changes.
// Cards change by dragging, clicking a side card, the arrows, the dots or the arrow keys; the page
// scroll is left alone. The middle card flips to show the photo credit. "Explore Kyoto" scrolls to
// the dashboard and moves the map to that place.

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function Explore({ places, attractions, stops, near, onEnter }) {
  const root = useRef(null);
  useScene(root);
  const deck = useRef(null);
  const cards = useRef([]);
  const anim = useRef({ shown: 0, target: 0, raf: 0, drag: null, skipClick: false });
  const [sel, setSel] = useState(0);
  const [seen, setSeen] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [failed, setFailed] = useState({});
  const [loaded, setLoaded] = useState({});
  const base = import.meta.env.BASE_URL;
  const n = places.length;
  const p = places[sel];
  const stat = near ? near(p) : null;

  // r is a fractional card index; --o is each card's signed offset from the middle
  const place = (r) => {
    cards.current.forEach((el, i) => {
      if (!el) return;
      const o = i - r;
      el.style.setProperty('--o', o.toFixed(3));
      el.style.setProperty('--d', Math.abs(o).toFixed(3));
      el.style.zIndex = String(20 - Math.round(Math.abs(o) * 2));
    });
  };
  // critically damped glide towards the target: no overshoot, no steps
  const run = () => {
    const a = anim.current;
    cancelAnimationFrame(a.raf);
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.25, (now - last) / 1000); // real elapsed time, so the glide is not slower on a slow machine
      last = now;
      const diff = a.target - a.shown;
      if (reduceMotion() || Math.abs(diff) < 0.0015) { a.shown = a.target; place(a.shown); return; }
      a.shown += diff * (1 - Math.exp(-dt * (a.drag ? 26 : 8.5))); // time-based, so it feels the same at any frame rate
      place(a.shown);
      a.raf = requestAnimationFrame(step);
    };
    a.raf = requestAnimationFrame(step);
  };
  useEffect(() => { place(0); return () => cancelAnimationFrame(anim.current.raf); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(root.current);
    return () => io.disconnect();
  }, []);

  const choose = (i) => {
    const k = Math.max(0, Math.min(n - 1, i));
    setSel(k);
    setFlipped(false);
    anim.current.target = k;
    run();
  };
  // drag the deck sideways; a short press is still a click
  const down = (e) => {
    if (e.button != null && e.button !== 0) return;
    const w = cards.current[0]?.offsetWidth || 240;
    anim.current.drag = { x: e.clientX, from: anim.current.target, step: w * 0.6, moved: false, id: e.pointerId };
  };
  const move = (e) => {
    const a = anim.current, d = a.drag;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) < 7) return;
      d.moved = true;
      setDragging(true);
      deck.current.setPointerCapture?.(d.id);
    }
    a.target = Math.max(-0.35, Math.min(n - 0.65, d.from - dx / d.step));
    const k = Math.max(0, Math.min(n - 1, Math.round(a.target)));
    setSel((o) => (o === k ? o : k));
    run();
  };
  const up = () => {
    const a = anim.current, d = a.drag;
    a.drag = null;
    if (!d || !d.moved) return;
    setDragging(false);
    a.skipClick = true;
    setTimeout(() => { a.skipClick = false; }, 0);
    choose(Math.round(a.target));
  };
  const key = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); choose(sel + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); choose(sel - 1); }
  };

  return (
    <section className={'explore' + (seen ? ' on' : '')} ref={root} id="explore" aria-labelledby="ex-title">
      <SeasonDrift count={12} />
      <div className="ex-bg" aria-hidden="true">
        {places.map((q, i) => <i key={q.key} className={i === sel ? 'on' : ''} style={{ backgroundColor: q.color, backgroundImage: `url(${base}${q.thumb})` }} />)}
      </div>
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
        <clipPath id="ex-notch" clipPathUnits="objectBoundingBox"><path transform="scale(0.0055556 0.004)" d="M0 32Q0 18 14 18L98 18Q106 18 108 10Q110 0 122 0L166 0Q180 0 180 14L180 236Q180 250 166 250L14 250Q0 250 0 236Z" /></clipPath>
      </svg>

      <div className="ex-inner">
        <header className="ex-head">
          <div className="ex-headline">
            <p className="ex-eyebrow">EXPLORE KYOTO · 京都府</p>
            <h2 id="ex-title">Seven places.<br />One <em>prefecture.</em></h2>
          </div>
          <div className="ex-stage-h">
            <button type="button" className="ex-arrow" onClick={() => choose(sel - 1)} disabled={sel === 0} aria-label="Previous place">‹</button>
            <div><b>Kyoto Prefecture</b><small>{String(sel + 1).padStart(2, '0')} / {String(n).padStart(2, '0')} · choose where to begin</small></div>
            <button type="button" className="ex-arrow" onClick={() => choose(sel + 1)} disabled={sel === n - 1} aria-label="Next place">›</button>
          </div>
          <span />
        </header>

        <div className={'ex-deck' + (dragging ? ' dragging' : '')} ref={deck} role="group" aria-label="Photo cards of the places. Drag sideways or use the arrow keys." tabIndex={-1}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
          {places.map((q, i) => {
            const front = i === sel;
            const close = Math.abs(i - sel) <= 2;
            return (
              <figure key={q.key} ref={(el) => (cards.current[i] = el)} className={'ex-card' + (front ? ' front' : '') + (loaded[q.key] ? ' ready' : '')} style={{ '--c': q.color }} aria-hidden={!front}>
                <button type="button" className={'ex-flip' + (front && flipped ? ' flipped' : '')} tabIndex={front ? 0 : -1} draggable={false}
                  aria-label={front ? (flipped ? `Show the photo of ${q.en}` : `Flip the card: photo credit for ${q.en}`) : `Show ${q.en}`}
                  onClick={() => { if (anim.current.skipClick) return; if (front) setFlipped(!flipped); else choose(i); }}>
                  <span className="ex-face ex-front">
                    {(close || loaded[q.key]) && !failed[q.key] && (
                      <img src={`${base}${q.src}`} width={q.width} height={q.height} decoding="async" draggable={false} alt={front ? `${q.en}, ${q.municipality.en}` : ''}
                        onLoad={() => setLoaded((o) => ({ ...o, [q.key]: true }))} onError={() => setFailed((o) => ({ ...o, [q.key]: true }))} />
                    )}
                    <span className="ex-tab">{i + 1} / {n}</span>
                    {failed[q.key] && <span className="ex-fallback">Photo could not be loaded</span>}
                    <span className="ex-cap"><strong lang="ja">{q.ja}</strong><span>{q.en}</span></span>
                    <span className="ex-turn" aria-hidden="true">↻ credit</span>
                  </span>
                  <span className="ex-face ex-back">
                    <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect x="3" y="7" width="26" height="3.4" rx="1.4" fill="currentColor" /><rect x="6" y="12.5" width="20" height="2.4" rx="1" fill="currentColor" /><rect x="8.4" y="10" width="2.6" height="18" rx="1" fill="currentColor" /><rect x="21" y="10" width="2.6" height="18" rx="1" fill="currentColor" /></svg>
                    <span className="ex-back-k">PHOTO CREDIT · {String(i + 1).padStart(2, '0')}</span>
                    <strong lang="ja">{q.ja} <span lang="en">({q.en})</span></strong>
                    <span>Photo by {q.credit.artist}{q.credit.taken ? `, ${q.credit.taken.slice(0, 4)}` : ''}</span>
                    <span>{q.credit.license} · Wikimedia Commons · resized</span>
                    <span className="ex-back-v">Location check: {q.verified.method}. {q.municipality.ja} ({q.municipality.en}).</span>
                  </span>
                </button>
              </figure>
            );
          })}
        </div>

        <ul className="ex-pills" aria-label={`Facts about ${p.en}`}>
          <li><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 14.5s4.5-4.2 4.5-8a4.5 4.5 0 0 0-9 0c0 3.8 4.5 8 4.5 8z" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>{p.municipality.en}</li>
          {stat && <li><i className="pd a" />{stat.a} attraction{stat.a === 1 ? '' : 's'} within 1 km</li>}
          {stat && <li><i className="pd s" />{stat.s} transit stop{stat.s === 1 ? '' : 's'} within 1 km</li>}
          {stat?.pilot && <li><i className="pd w" />Walking pilot area</li>}
        </ul>
        <div className="ex-dots" role="group" aria-label="Places to start from" onKeyDown={key}>
          {places.map((q, i) => <button key={q.key} type="button" className={'ex-dot' + (i === sel ? ' on' : '')} aria-pressed={i === sel} aria-label={`${q.en}, ${q.municipality.en}`} tabIndex={i === sel ? 0 : -1} onClick={() => choose(i)} />)}
        </div>

        <div className="ex-bar">
          <div className="ex-place" key={p.key} aria-live="polite">
            <span className="ex-tag">{p.tag}</span>
            <h3 lang="ja">{p.ja} <span lang="en">({p.en})</span></h3>
            <p className="ex-where" lang="ja">{p.municipality.ja} ({p.municipality.en})</p>
            <p className="ex-text">{p.text}</p>
          </div>
          <div className="ex-actions">
            <button type="button" className="ex-cta" onClick={() => onEnter(p)}>
              <span className="ex-cta-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M12 21s6.5-6 6.5-11.2A6.5 6.5 0 0 0 5.5 9.8C5.5 15 12 21 12 21z" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="9.8" r="2.3" fill="currentColor" /></svg></span>
              <span className="ex-cta-label"><small>Open the map at {p.en}</small><strong>Explore Kyoto</strong></span>
              <span className="ex-cta-badge" aria-hidden="true">{attractions.toLocaleString('en-US')} places</span>
            </button>
            <button type="button" className="ex-all" onClick={() => onEnter(null)}>or see the whole prefecture ↓</button>
          </div>
        </div>
        <p className="ex-credit">
          Photo: {p.credit.artist} · <a href={p.credit.license_url} target="_blank" rel="noreferrer">{p.credit.license}</a> · <a href={p.credit.page} target="_blank" rel="noreferrer">Wikimedia Commons</a> · resized.
          Location checked against the prefecture boundary. An area photo, not linked to a map record. {attractions.toLocaleString('en-US')} attraction and {stops.toLocaleString('en-US')} stop records are in the dashboard below.
        </p>
      </div>
    </section>
  );
}
