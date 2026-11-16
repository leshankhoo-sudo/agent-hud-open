// Colours that depend on the light / dark theme. Category hues keep their meaning in both themes;
// the light theme only uses deeper shades of the same hues so they stay readable on a pale map.
export const MAP_THEME = {
  dark: {
    cat: { attraction: '#ff8a4c', viewpoint: '#3fe0c5', museum: '#b18cff', castle: '#f2c86b', temple: '#f78fb3', shrine: '#ff5b4a', garden: '#9bd36a' },
    geo: { land: '#c9b98a', water: '#7cc4ff', area: '#e8e2ff' },
    // transit types: different hue AND different icon shape (lib/icons.js); low saturation on the dark map
    transit: { bus: '#4f8fc0', rail: '#c9953e', tram: '#b7679c' },
    stroke: '#0b0f11',
    // ordinary attraction dots: a white core, the category shows in the ring (light theme keeps filled dots)
    ptCore: '#eef4f6',
    // study area (Kyoto Prefecture): the accent colour, solid, with the slow breathing glow
    outline: { line: '#79d7da', glow: '#3fa7ab', fill: '#2c6d70', glowW: 8, glowOp: 0.3, breathe: 0.08 },
    muni: '#7d8b92', pilot: '#e0b35c',
    // municipal boundaries drawn by "Show coverage": thin white line, faint white glow
    coverage: { line: '#f2f6f7', glow: '#ffffff', glowOp: 0.16, fill: '#ffffff', fillOp: 0.03 },
    // point-to-point route: bright thin core, wide faint glow
    route: { core: '#e6fbfb', glow: '#79d7da', start: '#79d7da', end: '#f2f6f7' },
    walk: { bus: '#6fd3ff', rail: '#f2c86b' },
    busLine: '#7df0b4', busPale: '#7df0b4', landmark: '#ff6348',
    kde: ['#27255f', '#433da6', '#6c61e6', '#9e92ff', '#d2c9ff', '#fff1c2'],
    heat: ['#3d37a0', '#7a6ff0', '#c3b8ff', '#fff1c2'],
    offlineBg: '#0c1012',
    base: {
      bg: '#0c1012', rasterBg: '#0c1012',
      // real raster tiles are inverted, desaturated and tinted; only colours change
      raster: { 'raster-brightness-min': 1, 'raster-brightness-max': 0.05, 'raster-saturation': -0.9, 'raster-contrast': 0.16, 'raster-hue-rotate': 230 },
      landuse: '#111618', wood: '#0f1817', grass: '#121c1b', coverOp: 0.8, park: '#162624', parkOp: 0.5,
      ocean: '#0a0e10', water: '#1a3138', waterOp: 0.9, waterway: '#2f5964', riverOp: 0.6, streamOp: 0.35,
      building: '#182023', roadMinor: '#9fb0b7', roadMinorOp: 0.12, road: '#a3b1b8', roadOp: [0.26, 0.1, 0.34, 0.2],
      rail: '#c9d3d7', railOp: 0.35, label: '#dfe7ea', labelOp: 0.78, halo: '#0a0d0f',
    },
  },
  light: {
    cat: { attraction: '#e2622b', viewpoint: '#0f9d86', museum: '#7a55d6', castle: '#c08a12', temple: '#c4457a', shrine: '#cf3123', garden: '#4f8f25' },
    geo: { land: '#7a6533', water: '#2b6fb3', area: '#5a4f8a' },
    transit: { bus: '#4a6db0', rail: '#4d4038', tram: '#d2447c' },
    stroke: '#fffaf1',
    ptCore: null,
    outline: { line: '#8a5f45', glow: '#c98a5e', fill: '#c9a27c', glowW: 14, glowOp: 0.42, breathe: 0.16 },
    muni: '#9c8873', pilot: '#a8721a',
    // municipal boundaries in the light theme: dark ink line, no glow (the study area keeps its brown)
    coverage: { line: '#2f2924', glow: '#2f2924', glowOp: 0.08, fill: '#5a4f45', fillOp: 0.04 },
    route: { core: '#0f6f78', glow: '#2aa3a9', start: '#0f6f78', end: '#2f2924' },
    walk: { bus: '#1f78c8', rail: '#b0721c' },
    busLine: '#0c8f5c', busPale: '#0c8f5c', landmark: '#de4a33',
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
