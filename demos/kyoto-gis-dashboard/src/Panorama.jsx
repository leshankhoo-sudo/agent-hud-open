import { useMemo, useRef } from 'react';
import { useScene } from './lib/depth.js';
import { buildPanorama } from './lib/panoramaArt.js';
import { SeasonDrift } from './Season.jsx';

// Between the season story and Explore: a layered view across Kyoto that answers the pointer.
// Flat layers (sky, stars, moon, two ridges, mist, town, near hill, mist, foreground) slide by
// different amounts as the pointer moves, so looking left and right feels like turning the head,
// and they rise at different speeds as the page scrolls. The sky starts in the dark of the story
// above and the floor is the colour of the page below, so this scene is also the join between them.
// The drawing is an illustration made for this project (see lib/panoramaArt.js): not to scale,
// not map data, landmarks drawn as symbols.
const Layer = ({ k, html, className = '', fit = 'xMidYMax slice' }) => (
  <svg className={`pano-l pano-${k} ${className}`} viewBox="0 0 1600 720" preserveAspectRatio={fit} aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: html }} />
);

export default function Panorama({ onNext }) {
  const root = useRef(null);
  useScene(root);
  const art = useMemo(buildPanorama, []);
  return (
    <section className="pano" ref={root} id="panorama" aria-labelledby="pano-title">
      <div className="pano-art" aria-hidden="true">
      <div className="pano-sky" />
      <Layer k="stars" html={art.stars} />
      <div className="pano-moon" aria-hidden="true"><i /></div>
      <Layer k="far" html={art.far} />
      <Layer k="mid" html={art.mid} />
      <Layer k="mist-a" html={art.mistA} className="pano-mist" />
      <Layer k="city" html={art.city} />
      <Layer k="hill" html={`${art.hill}<g class="trees">${art.trees}</g><g class="gates">${art.gates}</g>`} />
      <Layer k="mist-b" html={art.mistB} className="pano-mist" />
      <SeasonDrift count={9} />
      <Layer k="fore" html={art.lantern} />
      <Layer k="branch" html={art.branch} fit="xMaxYMin slice" />
      </div>
      <div className="pano-copy">
        <p className="pano-kicker"><span lang="ja">見渡す</span> · Look around</p>
        <h2 id="pano-title">Look across Kyoto</h2>
        <p className="pano-lead">Mountains on the skyline, a town of tiled roofs below, and a row of gates climbing the hill.</p>
        <p className="pano-hint"><span className="pano-mouse" aria-hidden="true"><i /></span>Move the pointer to look left and right. Scroll to walk on.</p>
        <button type="button" className="pano-next" onClick={onNext}>Seven places to start <i aria-hidden="true">↓</i></button>
      </div>
      <p className="pano-note">Illustration drawn for this project · not to scale · landmarks are symbols, not map data</p>
    </section>
  );
}
