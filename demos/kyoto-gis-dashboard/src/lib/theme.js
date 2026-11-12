// Colours that depend on the light / dark theme. Category hues keep their meaning in both themes;
// the light theme only uses deeper shades of the same hues so they stay readable on a pale map.
export const MAP_THEME = {
  dark: {
    cat: { attraction: '#ff8a4c', viewpoint: '#3fe0c5', museum: '#b18cff', castle: '#f2c86b' },
    transit: { bus: '#7f93d8', rail: '#eeeefa', tram: '#ff6fae' },
    stroke: '#07080f',
    // boundary: soft white-violet light instead of the earlier bright blue; it still glows and breathes
    outline: { line: '#ebe8ff', glow: '#9d94ff', fill: '#6f66e0' },
    muni: '#9a97c8', pilot: '#f2c86b',
    walk: { bus: '#6fd3ff', rail: '#f2c86b' },
    busLine: '#7df0b4', busPale: '#7df0b4',
    kde: ['#27255f', '#433da6', '#6c61e6', '#9e92ff', '#d2c9ff', '#fff1c2'],
    heat: ['#3d37a0', '#7a6ff0', '#c3b8ff', '#fff1c2'],
    offlineBg: '#07080f',
    base: {
      bg: '#06070d', rasterBg: '#07080f',
      // real raster tiles are inverted, desaturated and tinted; only colours change
      raster: { 'raster-brightness-min': 1, 'raster-brightness-max': 0.05, 'raster-saturation': -0.9, 'raster-contrast': 0.16, 'raster-hue-rotate': 230 },
      landuse: '#0c0d16', wood: '#0c1618', grass: '#101c1d', coverOp: 0.8, park: '#15292a', parkOp: 0.5,
      ocean: '#090b14', water: '#2a3f7a', waterOp: 0.85, waterway: '#3c58a6', riverOp: 0.6, streamOp: 0.35,
      building: '#151726', roadMinor: '#8b8fb4', roadMinorOp: 0.14, road: '#8b8fb4', roadOp: [0.28, 0.1, 0.38, 0.22],
      rail: '#eeeefa', railOp: 0.45, label: '#e9e9f5', labelOp: 0.78, halo: '#04050a',
    },
  },
  light: {
    cat: { attraction: '#e2622b', viewpoint: '#0f9d86', museum: '#7a55d6', castle: '#c08a12' },
    transit: { bus: '#4a6db0', rail: '#4d4038', tram: '#d2447c' },
    stroke: '#fffaf1',
    outline: { line: '#8a5f45', glow: '#c98a5e', fill: '#c9a27c' },
    muni: '#9c8873', pilot: '#a8721a',
    walk: { bus: '#1f78c8', rail: '#b0721c' },
    busLine: '#0c8f5c', busPale: '#0c8f5c',
    kde: ['#f6dfb8', '#f2c084', '#ec9b5a', '#dd6f3f', '#bf4630', '#8c2622'],
    heat: ['#f2c084', '#ec9b5a', '#d4583a', '#8c2622'],
    offlineBg: '#f3eee4',
    base: {
      bg: '#f3eee4', rasterBg: '#f3eee4',
      raster: { 'raster-saturation': -0.4, 'raster-contrast': -0.04, 'raster-brightness-min': 0.06 },
      landuse: '#ebe4d6', wood: '#dce3cc', grass: '#e2e8d2', coverOp: 0.9, park: '#cddbbb', parkOp: 0.8,
      ocean: '#c7d9dc', water: '#b3cfd6', waterOp: 1, waterway: '#98bdc6', riverOp: 0.9, streamOp: 0.7,
      building: '#dfd6c5', roadMinor: '#b8a995', roadMinorOp: 0.55, road: '#a59079', roadOp: [0.6, 0.4, 0.85, 0.6],
      rail: '#7b7067', railOp: 0.7, label: '#4a3f36', labelOp: 0.92, halo: '#fbf7ef',
    },
  },
};
export const themeOf = (t) => MAP_THEME[t] || MAP_THEME.dark;
export const pointColor = (p, theme) => {
  const T = themeOf(theme);
  return T.cat[p.category] || T.transit[p.transport_type] || '#888';
};

const KEY = 'kyoto-gis-theme';
// First visit follows the system setting; a manual choice is remembered.
export function initialTheme() {
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'light' || s === 'dark') return s;
  } catch { /* storage blocked */ }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
export function rememberTheme(t) {
  try { localStorage.setItem(KEY, t); } catch { /* storage blocked */ }
}
