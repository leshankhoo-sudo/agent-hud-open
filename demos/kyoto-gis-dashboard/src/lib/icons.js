// Transit pictograms drawn on a canvas: a white disc with a coloured ring and a dark symbol.
// Used as map icons (ImageData, pixelRatio 2) and in the filter legend (data URL).
import { TRANSPORT_TYPES } from './data.js';

const S = 64; // px; shown at 32 css px with pixelRatio 2
const INK = '#0b1220';

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function pictogram(g, kind) {
  g.fillStyle = INK;
  g.strokeStyle = INK;
  g.lineCap = 'round';
  if (kind === 'bus') {
    rr(g, 20, 15, 24, 29, 5); g.fill();
    g.fillStyle = '#f4f7fb';
    rr(g, 23, 19, 18, 11, 2); g.fill();          // windscreen
    g.beginPath(); g.arc(25.5, 37.5, 2, 0, 7); g.arc(38.5, 37.5, 2, 0, 7); g.fill(); // lights
    g.fillStyle = INK;
    g.fillRect(22, 43, 5, 5); g.fillRect(37, 43, 5, 5); // wheels
    g.fillRect(17, 21, 3, 7); g.fillRect(44, 21, 3, 7); // mirrors
    return;
  }
  if (kind === 'tram') {
    g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(32, 15); g.lineTo(32, 10); g.moveTo(26, 9.5); g.lineTo(38, 9.5); g.stroke(); // pantograph
  }
  const top = kind === 'tram' ? 15 : 14;
  rr(g, 21, top, 22, 28, kind === 'tram' ? 4 : 8); g.fill();
  g.fillStyle = '#f4f7fb';
  rr(g, 25, top + 5, 14, 9, 2); g.fill();          // window
  g.beginPath(); g.arc(26.5, top + 21, 2, 0, 7); g.arc(37.5, top + 21, 2, 0, 7); g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 2.6;
  g.beginPath(); g.moveTo(25, 44); g.lineTo(21, 50); g.moveTo(39, 44); g.lineTo(43, 50); g.stroke(); // rails
}

function draw(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const col = (TRANSPORT_TYPES.find((t) => t.key === kind) || {}).color || '#ffffff';
  g.shadowColor = 'rgba(0,0,0,.6)';
  g.shadowBlur = 4;
  g.fillStyle = '#f4f7fb';
  g.beginPath(); g.arc(S / 2, S / 2, 27, 0, 7); g.fill();
  g.shadowBlur = 0;
  g.lineWidth = 3.5;
  g.strokeStyle = kind === 'rail' ? '#f2c86b' : col;
  g.beginPath(); g.arc(S / 2, S / 2, 27, 0, 7); g.stroke();
  pictogram(g, kind);
  return c;
}

const cache = {};
const canvasFor = (kind) => (cache[kind] ||= draw(kind));

export const ICON_KINDS = ['bus', 'rail', 'tram'];
export function addTransitIcons(map) {
  for (const k of ICON_KINDS) {
    const id = `ic-${k}`;
    if (map.hasImage(id)) continue;
    const c = canvasFor(k);
    map.addImage(id, c.getContext('2d').getImageData(0, 0, S, S), { pixelRatio: 2 });
  }
}
export const iconURL = (kind) => (typeof document === 'undefined' ? '' : canvasFor(kind).toDataURL());
