// Transit pictograms drawn on a canvas, one shape per type so they differ by more than colour:
//   bus  rounded square · rail  circle · tram  diamond
// Light theme: white plate, coloured rim, dark pictogram (the original look).
// Dark theme: the type colour as the plate, a white pictogram, a faint light rim.
// Used as map icons (ImageData, pixelRatio 2) and in the filter list and legend (data URL).
import { MAP_THEME } from './theme.js';

const S = 64; // px; shown at 32 css px with pixelRatio 2

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function plate(g, kind) {
  const c = S / 2;
  g.beginPath();
  if (kind === 'bus') rr(g, 6, 6, S - 12, S - 12, 13);
  else if (kind === 'tram') { g.moveTo(c, 3); g.lineTo(S - 3, c); g.lineTo(c, S - 3); g.lineTo(3, c); g.closePath(); }
  else g.arc(c, c, 27, 0, 7);
}

function pictogram(g, kind, ink, hole) {
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.lineCap = 'round';
  if (kind === 'bus') {
    rr(g, 20, 16, 24, 27, 5); g.fill();
    g.fillStyle = hole;
    rr(g, 23, 20, 18, 10, 2); g.fill();          // windscreen
    g.beginPath(); g.arc(25.5, 37, 2, 0, 7); g.arc(38.5, 37, 2, 0, 7); g.fill(); // lights
    g.fillStyle = ink;
    g.fillRect(22, 42, 5, 5); g.fillRect(37, 42, 5, 5); // wheels
    return;
  }
  const s = kind === 'tram' ? 0.8 : 1, o = (1 - s) * 32;
  g.save(); g.translate(o, o + (kind === 'tram' ? 1 : 0)); g.scale(s, s);
  if (kind === 'tram') {
    g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(32, 15); g.lineTo(32, 10); g.moveTo(26, 9.5); g.lineTo(38, 9.5); g.stroke(); // pantograph
  }
  const top = kind === 'tram' ? 15 : 14;
  g.fillStyle = ink;
  rr(g, 21, top, 22, 28, kind === 'tram' ? 4 : 8); g.fill();
  g.fillStyle = hole;
  rr(g, 25, top + 5, 14, 9, 2); g.fill();          // window
  g.beginPath(); g.arc(26.5, top + 21, 2, 0, 7); g.arc(37.5, top + 21, 2, 0, 7); g.fill();
  g.strokeStyle = ink;
  g.lineWidth = 2.6;
  g.beginPath(); g.moveTo(25, 44); g.lineTo(21, 50); g.moveTo(39, 44); g.lineTo(43, 50); g.stroke(); // rails
  g.restore();
}

function draw(kind, theme) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const col = MAP_THEME[theme === 'light' ? 'light' : 'dark'].transit[kind] || '#888';
  if (theme === 'light') {
    g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 4;
    g.fillStyle = '#f4f7fb'; plate(g, kind); g.fill();
    g.shadowBlur = 0;
    g.lineWidth = 3.5; g.strokeStyle = kind === 'rail' ? '#b0721c' : col; plate(g, kind); g.stroke();
    pictogram(g, kind, '#0b1220', '#f4f7fb');
  } else {
    g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 5;
    g.fillStyle = col; plate(g, kind); g.fill();
    g.shadowBlur = 0;
    g.lineWidth = 2.2; g.strokeStyle = 'rgba(237,243,245,.75)'; plate(g, kind); g.stroke();
    pictogram(g, kind, '#f6fafb', col);
  }
  return c;
}

const cache = {};
const canvasFor = (kind, theme) => (cache[`${kind}|${theme}`] ||= draw(kind, theme === 'light' ? 'light' : 'dark'));

export const ICON_KINDS = ['bus', 'rail', 'tram'];
// Registers the icons, or repaints them for another theme (same names, so no layer changes).
export function addTransitIcons(map, theme = 'dark') {
  for (const k of ICON_KINDS) {
    const id = `ic-${k}`;
    const img = canvasFor(k, theme).getContext('2d').getImageData(0, 0, S, S);
    if (map.hasImage(id)) map.updateImage(id, img); else map.addImage(id, img, { pixelRatio: 2 });
  }
}
const urls = {};
export const iconURL = (kind, theme = 'dark') => (typeof document === 'undefined' ? '' : urls[`${kind}|${theme}`] || (urls[`${kind}|${theme}`] = canvasFor(kind, theme).toDataURL()));
