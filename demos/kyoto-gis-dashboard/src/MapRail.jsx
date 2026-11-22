import { useRef } from 'react';

// Map tools as a slim liquid-glass rail on the map's left edge (not a row across the top of the map).
// Collapsed it shows icons only; on hover or keyboard focus it unfolds and the labels slide out one after
// another. The icon nearest the pointer swells a little (like a dock). Toggles show a small light when on.
// Class names (.map-tools, .cine, .d3t) are the ones the tests use.
const ICONS = {
  study: <path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  legend: <><circle cx="5" cy="5" r="2" fill="currentColor" /><circle cx="5" cy="10" r="2" fill="currentColor" opacity=".6" /><circle cx="5" cy="15" r="2" fill="currentColor" opacity=".35" /><path d="M10 5h7M10 10h7M10 15h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></>,
  cine: <><path d="M2.5 15.5 6 8h8l3.5 7.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M10 3.5v3M7.8 5.2 10 3.2l2.2 2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></>,
  d3: <><path d="M2.5 16.5h15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M3.5 16 7.5 7l3 5 2-3.5 4 7.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" /></>,
  top: <><path d="M3 14.5h14l-2.5 3h-9z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M10 2.5v8M7 7.8l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></>,
};
const Ico = ({ k }) => <i className="ri" aria-hidden="true"><svg viewBox="0 0 20 20" width="16" height="16">{ICONS[k]}</svg></i>;

export default function MapRail({ legend, setLegend, cinematic, setCinematic, d3, toggle3d, tilted, topDown, resetView }) {
  const rail = useRef(null);
  const move = (e) => {
    const el = rail.current;
    if (!el || e.pointerType === 'touch') return;
    for (const b of el.querySelectorAll('button')) {
      const r = b.getBoundingClientRect(), d = Math.abs(e.clientY - (r.top + r.height / 2));
      const k = Math.max(0, 1 - d / 64);
      b.style.setProperty('--m', (1 + 0.24 * k * k).toFixed(3));
    }
  };
  const leave = () => {
    rail.current?.querySelectorAll('button').forEach((b) => b.style.removeProperty('--m'));
  };
  let i = 0;
  return (
    <nav className="map-tools rail" aria-label="Map tools" ref={rail} onPointerMove={move} onPointerLeave={leave}>
      <svg className="rail-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <filter id="rail-glass" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="14" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <button type="button" style={{ '--i': i++ }} onClick={resetView} title="Back to the whole study area"><Ico k="study" /><span>Study area</span></button>
      <button type="button" style={{ '--i': i++ }} className={legend ? 'on' : ''} onClick={() => setLegend(!legend)} aria-expanded={legend} aria-controls="map-legend"><Ico k="legend" /><span>Legend</span></button>
      <button type="button" style={{ '--i': i++ }} className={'cine' + (cinematic ? ' on' : '')} aria-pressed={cinematic} onClick={() => setCinematic(!cinematic)} title="Cinematic view: routes are framed with a gentle tilt. Off: top-down, no tilt or turn.">
        <Ico k="cine" /><span>Cinematic view</span><i className="tg" aria-hidden="true" />
      </button>
      <button type="button" style={{ '--i': i++ }} className={'cine d3t' + (d3 ? ' on' : '')} aria-pressed={d3} onClick={toggle3d} title="3D density: raise the attraction kernel density out of the map. Click the surface to read a spot. Hold the middle mouse button and drag to turn it.">
        <Ico k="d3" /><span>3D density</span><i className="tg" aria-hidden="true" />
      </button>
      {tilted && <button type="button" style={{ '--i': i++ }} className="arrive" onClick={topDown} title="Back to a top-down view"><Ico k="top" /><span>Top-down</span></button>}
    </nav>
  );
}
