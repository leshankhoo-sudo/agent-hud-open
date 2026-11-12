// Season of the dashboard's visual theme, from Kyoto's own date (Asia/Tokyo), never the viewer's location.
// Months follow the JMA definition; the cherry-blossom and autumn-leaves windows come from
// public/data/season_kyoto.json (JMA Kyoto normals, 1991–2020, with the window rule stated there).

export const SEASONS = [
  { key: 'spring', ja: '春', romaji: 'Haru', en: 'Spring' },
  { key: 'summer', ja: '夏', romaji: 'Natsu', en: 'Summer' },
  { key: 'autumn', ja: '秋', romaji: 'Aki', en: 'Autumn' },
  { key: 'winter', ja: '冬', romaji: 'Fuyu', en: 'Winter' },
];
export const HIGHLIGHTS = {
  sakura: { ja: '桜', romaji: 'Sakura', en: 'Cherry blossom season' },
  koyo: { ja: '紅葉', romaji: 'Kōyō', en: 'Autumn leaves season' },
};
// Particle drawn for each visual season (and theme): petals, leaves, fireflies or snow.
export const PARTICLE = { spring: 'sakura', summer: 'leaf-green', autumn: 'momiji', winter: 'snow' };

// Kyoto's calendar date as { y, md: 'MM-DD' }.
export function kyotoDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), md: `${parts.month}-${parts.day}` };
}

export function monthSeason(md) {
  const m = Number(md.slice(0, 2));
  return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter';
}

const inWindow = (md, w) => !!w && md >= w.from && md <= w.to;

// { calendar, highlight, visual, md }: calendar = JMA month season; highlight = 'sakura' | 'koyo' | null;
// visual = the theme shown (a highlight wins over the month, e.g. early December leaves stay autumn).
export function seasonFor(now = new Date(), ref = null) {
  const { y, md } = kyotoDate(now);
  const calendar = monthSeason(md);
  const w = ref?.windows || {};
  const highlight = inWindow(md, w.sakura) ? 'sakura' : inWindow(md, w.koyo) ? 'koyo' : null;
  const visual = highlight === 'sakura' ? 'spring' : highlight === 'koyo' ? 'autumn' : calendar;
  return { y, md, calendar, highlight, visual };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const mdLabel = (md) => (md ? `${MONTHS[Number(md.slice(0, 2)) - 1]} ${Number(md.slice(3))}` : '');

const KEY = 'kyoto-gis-season';
export const SEASON_MODES = ['auto', ...SEASONS.map((s) => s.key)];
export function initialSeasonMode() {
  try { const v = localStorage.getItem(KEY); return SEASON_MODES.includes(v) ? v : 'auto'; } catch { return 'auto'; }
}
export function rememberSeasonMode(v) {
  try { localStorage.setItem(KEY, v); } catch { /* not stored */ }
}
