// Colours that depend on the light / dark theme. Category hues keep their meaning in both themes;
// the light theme only uses deeper shades of the same hues so they stay readable on a pale map.
export const MAP_THEME = {
  dark: {
    cat: { attraction: '#ff8a4c', viewpoint: '#3fe0c5', museum: '#b18cff', castle: '#f2c86b' },
    transit: { bus: '#6f93d6', rail: '#e6eefc', tram: '#ff6fae' },
    stroke: '#071027',
    outline: { line: '#9fd0ff', glow: '#3d8bff', fill: '#2e6bff' },
    muni: '#7fb3ff', pilot: '#f2c86b',
    walk: { bus: '#4fc3ff', rail: '#f2c86b' },
    kde: ['#163a7a', '#1f5bbf', '#2e8cf0', '#3fc4f0', '#9ee8d6', '#f2e28b'],
    heat: ['#1f4fae', '#2e9bf0', '#7fe3e0', '#fff2a8'],
    offlineBg: '#071027',
    base: {
      bg: '#05080f', rasterBg: '#071027',
      // real raster tiles are inverted, desaturated and tinted blue; only colours change
      raster: { 'raster-brightness-min': 1, 'raster-brightness-max': 0.06, 'raster-saturation': -0.85, 'raster-contrast': 0.18, 'raster-hue-rotate': 200 },
      landuse: '#0d121c', wood: '#0c2418', grass: '#123020', coverOp: 0.75, park: '#1d4a2a', parkOp: 0.55,
      ocean: '#0a0f16', water: '#2bb3c8', waterOp: 0.85, waterway: '#36bfd6', riverOp: 0.6, streamOp: 0.35,
      building: '#161e2c', roadMinor: '#7d98c0', roadMinorOp: 0.14, road: '#7d98c0', roadOp: [0.28, 0.1, 0.38, 0.22],
      rail: '#e6eefc', railOp: 0.5, label: '#e8eefc', labelOp: 0.78, halo: '#04060b',
    },
  },
  light: {
    cat: { attraction: '#e2622b', viewpoint: '#0f9d86', museum: '#7a55d6', castle: '#c08a12' },
    transit: { bus: '#4a6db0', rail: '#4d4038', tram: '#d2447c' },
    stroke: '#fffaf1',
    outline: { line: '#8a5f45', glow: '#c98a5e', fill: '#c9a27c' },
    muni: '#9c8873', pilot: '#a8721a',
    walk: { bus: '#1f78c8', rail: '#b0721c' },
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
