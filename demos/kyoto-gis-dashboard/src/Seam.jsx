import { useRef } from 'react';
import { useScene } from './lib/depth.js';

// The join between two sections. It has its own height, so nothing here sits on top of the
// neighbouring text: a seal with one kanji for what comes next, two fine lines that draw outwards
// as the join reaches the middle of the window, and flat mist bars (suyari-gasumi, the stylised
// mist of yamato-e painting) that slide past each other with the scroll and the pointer.
// All edges are sharp; there is no blur and no fade laid over content. Decorative only.
const BARS_A = [[2, 34, 26, 9], [38, 58, 34, 7], [70, 28, 24, 8]];
const BARS_B = [[14, 70, 22, 6], [52, 22, 20, 6], [80, 62, 26, 8]];
const Bars = ({ items, className }) => (
  <svg className={className} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    {items.map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} rx={h / 2} ry={h / 2} />)}
  </svg>
);

export default function Seam({ mark, ja, en }) {
  const ref = useRef(null);
  useScene(ref);
  return (
    <div className="seam" ref={ref} aria-hidden="true">
      <Bars items={BARS_A} className="seam-mist a" />
      <Bars items={BARS_B} className="seam-mist b" />
      <span className="seam-line l" />
      <span className="seam-mid">
        <span className="seam-mark" lang="ja">{mark}</span>
        <span className="seam-t"><span lang="ja">{ja}</span> · {en}</span>
      </span>
      <span className="seam-line r" />
    </div>
  );
}
