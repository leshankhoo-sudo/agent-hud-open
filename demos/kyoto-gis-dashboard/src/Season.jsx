import { useEffect, useRef } from 'react';
import { SEASONS, HIGHLIGHTS, mdLabel } from './lib/season.js';

// Season badge in the top bar: what season it is in Kyoto today, why, and a manual override for demos.
// The season changes colours and the falling petals / leaves only; no map data change.
export function SeasonBadge({ auto, mode, onMode, info: seasonRef }) {
  const box = useRef(null);
  useEffect(() => {
    const close = (e) => { if (box.current?.open && !box.current.contains(e.target)) box.current.open = false; };
    addEventListener('pointerdown', close);
    return () => removeEventListener('pointerdown', close);
  }, []);
  const shown = mode === 'auto' ? auto.visual : mode;
  const s = SEASONS.find((x) => x.key === shown);
  const cal = SEASONS.find((x) => x.key === auto.calendar);
  const hl = mode === 'auto' && auto.highlight ? HIGHLIGHTS[auto.highlight] : null;
  const w = auto.highlight && seasonRef?.windows?.[auto.highlight];
  const n = seasonRef?.normals || {};
  const obs = seasonRef?.observed?.[auto.y] || {};
  const src = seasonRef?.meta?.phenology_source;
  return (
    <details className="season-badge" ref={box}>
      <summary aria-label={`Season theme: ${s.en}${mode === 'auto' ? ' (Kyoto date)' : ' (chosen)'}`}>
        <span className="s-ja" lang="ja" aria-hidden="true">{s.ja}</span>
        <span className="s-txt"><b>{mode === 'auto' ? `${s.en} in Kyoto` : `${s.en} theme`}</b>{hl && <small><span lang="ja">{hl.ja}</span> {hl.romaji}</small>}</span>
      </summary>
      <div className="season-pop" role="group" aria-label="Season theme">
        <p className="xs"><b>Kyoto today:</b> {mdLabel(auto.md)} (Japan time). Season by the JMA calendar: <b>{cal.en}</b> <span lang="ja">{cal.ja}</span> ({cal.romaji}).</p>
        {auto.highlight && w && (
          <p className="xs"><b>{HIGHLIGHTS[auto.highlight].en}</b> <span lang="ja">{HIGHLIGHTS[auto.highlight].ja}</span> ({HIGHLIGHTS[auto.highlight].romaji}): about {mdLabel(w.from)} – {mdLabel(w.to)}, set around Kyoto's normal dates
            {auto.highlight === 'sakura' ? ` (flowering ${mdLabel(n.sakura_flowering)}, full bloom ${mdLabel(n.sakura_full_bloom)})` : ` (ginkgo yellow ${mdLabel(n.ginkgo_yellow)}, maple red ${mdLabel(n.maple_red)})`}.
            {auto.highlight === 'sakura' && obs.sakura_flowering && ` Observed ${auto.y}: flowering ${mdLabel(obs.sakura_flowering)}${obs.sakura_full_bloom ? `, full bloom ${mdLabel(obs.sakura_full_bloom)}` : ''}.`}
            {auto.highlight === 'koyo' && (obs.maple_red ? ` Observed ${auto.y}: maple red ${mdLabel(obs.maple_red)}.` : ` Maple reddening not yet observed in ${auto.y}.`)}
          </p>
        )}
        <label className="xs season-pick">Theme season
          <select value={mode} onChange={(e) => onMode(e.target.value)}>
            <option value="auto">Auto · Kyoto date</option>
            {SEASONS.map((x) => <option key={x.key} value={x.key}>{x.en} · {x.ja}</option>)}
          </select>
        </label>
        <p className="xs muted">Changes colours and the falling petals or leaves only; map data stay the same. Normals: mean of 1991–2020 at the Kyoto Local Meteorological Office; the windows are approximate and are this project's choice. {src && <a href={src.url} target="_blank" rel="noreferrer">JMA source</a>}</p>
      </div>
    </details>
  );
}

// A few petals / leaves / snowflakes drifting through a section. Shape and colour come from CSS
// (data-season and data-theme on <html>); hidden when the viewer prefers reduced motion.
export function SeasonDrift({ count = 10 }) {
  const items = useRef(Array.from({ length: count }, (_, i) => ({
    x: Math.round((i + Math.random() * 0.8) * (100 / count)),
    d: (12 + Math.random() * 10).toFixed(1),
    delay: (-Math.random() * 20).toFixed(1),
    s: (0.7 + Math.random() * 0.6).toFixed(2),
    sway: Math.round(18 + Math.random() * 30) * (Math.random() < 0.5 ? -1 : 1),
  })));
  return (
    <div className="season-drift" aria-hidden="true">
      {items.current.map((p, i) => <i key={i} style={{ '--x': `${p.x}%`, '--dur': `${p.d}s`, '--delay': `${p.delay}s`, '--s': p.s, '--sway': `${p.sway}px` }} />)}
    </div>
  );
}
