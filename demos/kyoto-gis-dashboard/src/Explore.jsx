import { useEffect, useRef, useState } from 'react';

// "Explore Kyoto": a short section between the scroll intro and the dashboard.
// The layout ideas come from a game landing page (chapter bar, a row of cards to pick from, a fanned
// stack of three cards, one round call-to-action); the content is ours: verified photos of places in
// Kyoto Prefecture. The photo cards form a cover flow of tall cards: the chosen one large in the
// middle, its neighbours smaller and tucked behind on both sides. On a desktop the deck slides as
// the page scrolls through this section, bringing one place after another to the middle; on phones
// (or with reduced motion) it slides when a place is picked. The middle card flips over to
// show the photo credit. "Explore Kyoto" scrolls to the dashboard and moves the map to that place.
// Scrolling is never blocked: the section is simply taller, and its content stays pinned meanwhile.

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function Explore({ places, attractions, stops, near, onEnter }) {
  const root = useRef(null);
  const row = useRef(null);
  const [sel, setSel] = useState(0);
  const [seen, setSeen] = useState(false);
  const [failed, setFailed] = useState({});
  const [loaded, setLoaded] = useState({});
  const ring = useRef(null);
  const cards = useRef([]);
  const [flipped, setFlipped] = useState(false);
  const [scrub, setScrub] = useState(false); // true: the ring follows the scroll position
  const base = import.meta.env.BASE_URL;
  const n = places.length;
  const p = places[sel];
  // place the deck: r is a fractional card index (0 .. n-1); --o is each card's signed offset from the middle
  const place = (r) => {
    cards.current.forEach((el, i) => {
      if (!el) return;
      const o = i - r;
      el.style.setProperty('--o', o.toFixed(3));
      el.style.setProperty('--d', Math.abs(o).toFixed(3));
      el.style.zIndex = String(20 - Math.round(Math.abs(o) * 2));
    });
  };
  useEffect(() => {
    const mq = [matchMedia('(min-width: 901px) and (min-height: 620px)'), matchMedia('(prefers-reduced-motion: reduce)')];
    const upd = () => setScrub(mq[0].matches && !mq[1].matches);
    upd();
    mq.forEach((m) => m.addEventListener('change', upd));
    return () => mq.forEach((m) => m.removeEventListener('change', upd));
  }, []);
  useEffect(() => {
    if (!scrub) { place(sel); return; }
    let raf, shown = -1;
    const frame = () => {
      const r = root.current.getBoundingClientRect();
      const span = r.height - innerHeight;
      const t = span > 0 ? Math.max(0, Math.min(1, -r.top / span)) : 0;
      const target = t * (n - 1);
      shown = shown < 0 ? target : shown + (target - shown) * 0.16;
      if (Math.abs(target - shown) < 0.002) shown = target;
      place(shown);
      const k = Math.round(shown);
      setSel((o) => (o === k ? o : k));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrub, n]);
  useEffect(() => { if (!scrub) place(sel); setFlipped(false); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(root.current);
    return () => io.disconnect();
  }, []);

  const choose = (i) => {
    const k = (i + n) % n;
    if (scrub) { // move the page to that card's place in the scroll
      const r = root.current.getBoundingClientRect();
      scrollTo({ top: scrollY + r.top + (k / (n - 1)) * (r.height - innerHeight), behavior: 'smooth' });
    } else setSel(k);
  };
  const stat = near ? near(p) : null;
  const key = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); choose(sel + 1); row.current?.children[(sel + 1) % n]?.focus(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); choose(sel - 1); row.current?.children[(sel - 1 + n) % n]?.focus(); }
  };

  return (
    <section className={'explore' + (seen ? ' on' : '') + (scrub ? ' scrub' : '')} ref={root} id="explore" aria-labelledby="ex-title">
     <div className="ex-sticky">
      <div className="ex-chapter">
        <span><i aria-hidden="true" />KYOTO PREFECTURE · 京都府</span>
        <span>PLACE {String(sel + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}</span>
      </div>

      <div className="ex-main">
        <div className="ex-copy">
          <p className="ex-eyebrow">CHOOSE WHERE TO BEGIN</p>
          <h2 id="ex-title">Seven places.<br />One <em>prefecture.</em></h2>
          <p className="ex-lead">From hillside temples in Kyoto City to boat houses on the Sea of Japan coast. Pick a place, then open the map there.</p>

          <div className="ex-place" key={p.key} aria-live="polite">
            <span className="ex-tag">{p.tag}</span>
            <h3 lang="ja">{p.ja} <span lang="en">({p.en})</span></h3>
            <p className="ex-where" lang="ja">
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 14.5s4.5-4.2 4.5-8a4.5 4.5 0 0 0-9 0c0 3.8 4.5 8 4.5 8z" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="8" cy="6.4" r="1.6" fill="currentColor" /></svg>
              {p.municipality.ja} ({p.municipality.en})
            </p>
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
          <p className="ex-note">{attractions.toLocaleString('en-US')} attraction records and {stops.toLocaleString('en-US')} transit stops, with density, walking access, weather and sample fares in the dashboard below.</p>
        </div>

        {/* cover flow of tall photo cards; the middle one can be flipped */}
        <div className="ex-stage">
          <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
            <clipPath id="ex-notch" clipPathUnits="objectBoundingBox"><path transform="scale(0.0055556 0.004)" d="M0 32Q0 18 14 18L98 18Q106 18 108 10Q110 0 122 0L166 0Q180 0 180 14L180 236Q180 250 166 250L14 250Q0 250 0 236Z" /></clipPath>
          </svg>
          <div className="ex-stage-h">
            <button type="button" className="ex-arrow" onClick={() => choose(sel - 1)} aria-label="Previous place">‹</button>
            <div><b>Kyoto Prefecture</b><small lang="ja">京都府 · {String(sel + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}</small></div>
            <button type="button" className="ex-arrow" onClick={() => choose(sel + 1)} aria-label="Next place">›</button>
          </div>
          <div className="ex-persp">
            <div className="ex-ring" ref={ring} role="group" aria-label="Photo cards of the places">
              {places.map((q, i) => {
                const front = i === sel;
                const near = Math.abs(i - sel) <= 2;
                return (
                  <figure key={q.key} ref={(el) => (cards.current[i] = el)} className={'ex-card' + (front ? ' front' : '') + (failed[q.key] ? ' noimg' : '') + (loaded[q.key] ? ' ready' : '')} style={{ '--c': q.color }} aria-hidden={!front}>
                    <button type="button" className={'ex-flip' + (front && flipped ? ' flipped' : '')} tabIndex={front ? 0 : -1}
                      aria-label={front ? (flipped ? `Show the photo of ${q.en}` : `Flip the card: photo credit for ${q.en}`) : `Show ${q.en}`}
                      onClick={() => (front ? setFlipped(!flipped) : choose(i))}>
                      <span className="ex-face ex-front">
                        {(near || loaded[q.key]) && !failed[q.key] && (
                          <img src={`${base}${q.src}`} width={q.width} height={q.height} decoding="async" alt={front ? `${q.en}, ${q.municipality.en}` : ''}
                            onLoad={() => setLoaded((o) => ({ ...o, [q.key]: true }))} onError={() => setFailed((o) => ({ ...o, [q.key]: true }))} />
                        )}
                        <span className="ex-tab">{i + 1} / {n}</span>
                        {failed[q.key] && <span className="ex-fallback">Photo could not be loaded</span>}
                        <span className="ex-cap"><strong lang="ja">{q.ja}</strong><span>{q.en} · {q.municipality.en}</span></span>
                        <span className="ex-turn" aria-hidden="true">↻ credit</span>
                      </span>
                      <span className="ex-face ex-back">
                        <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true"><rect x="3" y="7" width="26" height="3.4" rx="1.4" fill="currentColor" /><rect x="6" y="12.5" width="20" height="2.4" rx="1" fill="currentColor" /><rect x="8.4" y="10" width="2.6" height="18" rx="1" fill="currentColor" /><rect x="21" y="10" width="2.6" height="18" rx="1" fill="currentColor" /></svg>
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
          </div>
          <ul className="ex-pills" aria-label={`Facts about ${p.en}`}>
            <li><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 14.5s4.5-4.2 4.5-8a4.5 4.5 0 0 0-9 0c0 3.8 4.5 8 4.5 8z" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>{p.municipality.en}</li>
            {stat && <li><i className="pd a" />{stat.a} attraction{stat.a === 1 ? '' : 's'} within 1 km</li>}
            {stat && <li><i className="pd s" />{stat.s} transit stop{stat.s === 1 ? '' : 's'} within 1 km</li>}
            {stat?.pilot && <li><i className="pd w" />Walking pilot area</li>}
          </ul>
          <div className="ex-dots" role="group" aria-label="Places to start from" ref={row} onKeyDown={key}>
            {places.map((q, i) => <button key={q.key} type="button" className={'ex-dot' + (i === sel ? ' on' : '')} aria-pressed={i === sel} aria-label={`${q.en}, ${q.municipality.en}`} tabIndex={i === sel ? 0 : -1} onClick={() => choose(i)} />)}
          </div>
        </div>
      </div>

      <p className="ex-credit">
        Photo: {p.credit.artist} · <a href={p.credit.license_url} target="_blank" rel="noreferrer">{p.credit.license}</a> · <a href={p.credit.page} target="_blank" rel="noreferrer">Wikimedia Commons</a> · resized.
        Location checked against the prefecture boundary. An area photo, not linked to a map record.
      </p>

     </div>
    </section>
  );
}
