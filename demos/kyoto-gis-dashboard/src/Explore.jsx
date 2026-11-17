import { useEffect, useRef, useState } from 'react';
import { SeasonDrift } from './Season.jsx';
import { useScene } from './lib/depth.js';

// "Explore Kyoto": one screen between the scroll intro and the dashboard.
// Layout after a spatial-UI reference: title on top, tall photo cards in depth on the section's backdrop
// (Orbit: the chosen one low in the middle facing the viewer, the others spread out behind it, each
// leaning its own way; Fan: held like a hand of cards; choosing a place gathers them into one stack and
// spreads them out again; the row is endless), fact pills and a frosted bar below.
// The backdrop is a soft, blurred copy of the chosen photo and cross-fades when the card changes.
// Cards change by dragging, clicking a side card, the arrows, the dots or the arrow keys; the page
// scroll is left alone. The middle card flips to show the photo credit. "Explore Kyoto" scrolls to
// the dashboard and moves the map to that place.

const LEAN = [-11, 8, -6, 13, -9, 6, -13];   // how far each card leans when it is not the chosen one (degrees)
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function Explore({ places, attractions, stops, near, onEnter }) {
  const root = useRef(null);
  useScene(root);
  const deck = useRef(null);
  const cards = useRef([]);
  const anim = useRef({ shown: 0, target: 0, raf: 0, drag: null, skipClick: false, mix: 0, mixTo: 0, vel: 0 });
  const [mode, setMode] = useState('orbit');
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

  // Where each card stands (after the spatial reference). r is a fractional card index (the row is endless);
  // v is how fast it is turning, in cards per second; mix runs from 0 (Orbit) to 1 (Fan).
  // Orbit: the cards stand on a ring seen from a little above; the chosen card is nearest.
  // Fan: the cards are held like a hand of cards, turning about a point below them.
  // Choosing a place turns the ring until that card is nearest.
  const place = (r, v = 0, mix = anim.current.mix) => {
    const W = deck.current?.clientWidth || 900, H = deck.current?.clientHeight || 420;
    const g = Math.min(1, Math.abs(v) / 4.2), dir = Math.sign(v) || 1;
    cards.current.forEach((el, i) => {
      if (!el) return;
      let o = (i - r) % n;
      if (o > n / 2) o -= n; else if (o < -n / 2) o += n;
      const d = Math.abs(o), d1 = Math.min(d, 1), sg = Math.sign(o);
      const lean = LEAN[i % LEAN.length];
      // orbit: a real ring in depth, seen from a little above. The chosen card is nearest, low in the middle;
      // the others go round behind it, further away (so smaller, by perspective), higher and darker.
      const th = o * ((Math.PI * 2) / n), co = Math.cos(th), si = Math.sin(th);
      const R = W * 0.4 * (1 - 0.2 * g);
      const ox = si * R, oz = (co - 1) * R * 1.1, oy = H * 0.06 - (1 - co) * H * 0.17;
      const orz = lean * 0.55 * Math.min(1, d), ory = -si * 46, os = 1, obr = 0.5 + 0.5 * ((co + 1) / 2) ** 1.3;
      // fan
      const fx = o * W * 0.105, fy = H * (0.03 + d * d * 0.014), fz = -d * 46, frz = o * 10.5, fs = 0.86 - d1 * 0.05, fbr = 1 - Math.min(d, 2) * 0.2;
      const L = (p, q) => p + (q - p) * mix;
      let x = L(ox, fx), y = L(oy, fy), z = L(oz, fz), rz = L(orz, frz), ry = L(ory, 0), sc = L(os, fs), br = L(obr, fbr);
      // while the ring turns fast it draws in a little and the cards blur
      rz += g * dir * 9 * (0.4 + 0.6 * Math.abs(si)); ry += g * dir * 14 * co; sc *= 1 - 0.05 * g;   // cards lean and turn into the direction of travel
      const st = el.style;
      st.setProperty('--o', o.toFixed(3));
      st.setProperty('--d', d.toFixed(3));
      st.setProperty('--x', `${x.toFixed(1)}px`);
      st.setProperty('--y', `${y.toFixed(1)}px`);
      st.setProperty('--z', `${z.toFixed(1)}px`);
      st.setProperty('--ry', `${ry.toFixed(2)}deg`);
      st.setProperty('--rz', `${rz.toFixed(2)}deg`);
      st.setProperty('--s', sc.toFixed(3));
      st.setProperty('--br', br.toFixed(3));
      st.setProperty('--bl', `${(g * (d < 0.5 ? 1.4 : 3.2)).toFixed(2)}px`);
      st.setProperty('--op', '1');   // a card changing sides at the far end does so unseen
      st.setProperty('--fy', `${(60 + 58 * mix).toFixed(0)}%`);
      st.zIndex = String(Math.round(40 - d * 6 * (1 - mix) - d * 6 * mix));
      el.classList.toggle('near', true);
    });
  };
  // one loop however fast places are chosen; the turn is a spring, so it never queues or steps
  const run = () => {
    const a = anim.current;
    cancelAnimationFrame(a.raf);
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.25, (now - last) / 1000); // real elapsed time, so the turn is not slower on a slow machine
      last = now;
      const diff = a.target - a.shown, dm = a.mixTo - a.mix;
      if (reduceMotion() || (Math.abs(diff) < 0.0012 && Math.abs(a.vel) < 0.012 && Math.abs(dm) < 0.002)) { a.shown = a.target; a.vel = 0; a.mix = a.mixTo; place(a.shown, 0); return; }
      let vel;
      if (a.drag) { const mv = diff * (1 - Math.exp(-dt * 26)); a.shown += mv; a.vel = 0; vel = 0; }
      else {
        // a slightly underdamped spring: the ring swings a touch past the card and settles back (the stopping pose)
        const K = 46, C = 2 * Math.sqrt(K) * 0.6;
        for (let left = dt; left > 0; left -= 0.012) { const h = Math.min(0.012, left); a.vel += ((a.target - a.shown) * K - a.vel * C) * h; a.shown += a.vel * h; }
        vel = a.vel;
      }
      a.mix += dm * (1 - Math.exp(-dt * 6));
      place(a.shown, vel);
      a.raf = requestAnimationFrame(step);
    };
    a.raf = requestAnimationFrame(step);
  };
  const layout = (m) => { setMode(m); anim.current.mixTo = m === 'fan' ? 1 : 0; run(); };
  useEffect(() => { place(0); return () => cancelAnimationFrame(anim.current.raf); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      setSeen(true); io.disconnect();
      // entrance: the ring turns in from two places away and settles on the first card
      const a = anim.current;
      if (!reduceMotion() && a.shown === a.target) { a.shown = a.target - 2; run(); }
    }, { threshold: 0.15 });
    const fit = () => place(anim.current.shown, 0);
    addEventListener('resize', fit);
    io.observe(root.current);
    return () => { io.disconnect(); removeEventListener('resize', fit); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mod = (k) => ((k % n) + n) % n;
  const choose = (i) => {
    const k = mod(i), a = anim.current;
    setSel(k);
    setFlipped(false);
    // go the short way round the ring from wherever the turn is aimed now
    const base = Math.round(a.target);
    let d = k - mod(base);
    if (d > n / 2) d -= n; else if (d < -n / 2) d += n;
    a.target = base + d;
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
    a.target = d.from - dx / d.step;
    const k = mod(Math.round(a.target));
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
    a.target = Math.round(a.target);
    setSel(mod(a.target));
    setFlipped(false);
    run();
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
          <span />
        </header>

        <div className={'ex-deck' + (dragging ? ' dragging' : '')} ref={deck} role="group" aria-label="Photo cards of the places. Drag sideways or use the arrow keys." tabIndex={-1}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
          <p className="ex-hint">{String(sel + 1).padStart(2, '0')} / {String(n).padStart(2, '0')} · Pick a card from the {mode}. Choose it to open the map there.</p>
          <div className="ex-ctl" onPointerDown={(e) => e.stopPropagation()}>
            <div className="ex-seg" role="group" aria-label="Card layout">
              <button type="button" aria-pressed={mode === 'fan'} className={mode === 'fan' ? 'on' : ''} onClick={() => layout('fan')}>Fan</button>
              <button type="button" aria-pressed={mode === 'orbit'} className={mode === 'orbit' ? 'on' : ''} onClick={() => layout('orbit')}>Orbit</button>
            </div>
            <button type="button" className="ex-arrow" onClick={() => choose(sel - 1)} aria-label="Previous place">←</button>
            <button type="button" className="ex-arrow" onClick={() => choose(sel + 1)} aria-label="Next place">→</button>
          </div>
          {places.map((q, i) => {
            const front = i === sel;
            const close = true;   // every card is in view on the ring
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
                    <span className="ex-tab">{String(i + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}</span>
                    <span className="ex-kind">{q.tag}</span>
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
