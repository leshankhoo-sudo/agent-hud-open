// Meaning of common words inside Japanese place names, for visitors who do not read Japanese.
// This explains a word in the name; it is not a translation of the name and adds no reading.
// Only unambiguous words are listed. 'end' terms count only at the end of a name; 'stop' terms
// only for transit records (bus stop and station names).
export const TERMS = [
  { t: '神社', m: 'Shinto shrine' },
  { t: '大社', m: 'grand Shinto shrine' },
  { t: '天満宮', m: 'Shinto shrine (Tenmangū)' },
  { t: '寺', m: 'Buddhist temple' },
  { t: '城跡', m: 'castle ruins' },
  { t: '城址', m: 'castle ruins' },
  { t: '城', m: 'castle', end: true },
  { t: '御所', m: 'imperial palace' },
  { t: '離宮', m: 'imperial villa' },
  { t: '美術館', m: 'art museum' },
  { t: '博物館', m: 'museum' },
  { t: '資料館', m: 'museum / archive' },
  { t: '記念館', m: 'memorial museum' },
  { t: '庭園', m: 'garden' },
  { t: '公園', m: 'park' },
  { t: '展望台', m: 'lookout' },
  { t: '展望所', m: 'lookout' },
  { t: '茶屋', m: 'teahouse' },
  { t: '小路', m: 'lane' },
  { t: '坂', m: 'slope', end: true },
  { t: '橋', m: 'bridge', end: true },
  { t: '滝', m: 'waterfall', end: true },
  { t: '池', m: 'pond', end: true },
  { t: '駅前', m: 'in front of the station', stop: true, end: true },
  { t: '駅', m: 'station', end: true },
  { t: '前', m: 'in front of', stop: true, end: true },
  { t: '口', m: 'entrance / access', stop: true, end: true },
  { t: '道', m: 'road leading to', stop: true, end: true },
  { t: '通', m: 'street', stop: true, end: true },
];

// Terms found in a name, left to right, longest match first (神社 before 社, 駅前 before 駅 and 前).
export function nameTerms(name, isStop = false, max = 3) {
  if (!name) return [];
  const taken = new Array(name.length).fill(false);
  const found = [];
  const list = [...TERMS].sort((a, b) => b.t.length - a.t.length);
  for (const term of list) {
    if (term.stop && !isStop) continue;
    let from = 0;
    for (;;) {
      const i = name.indexOf(term.t, from);
      if (i < 0) break;
      from = i + 1;
      if (term.end && i + term.t.length !== name.length) continue;
      if (taken.slice(i, i + term.t.length).some(Boolean)) continue;
      for (let k = i; k < i + term.t.length; k++) taken[k] = true;
      found.push({ ...term, at: i });
    }
  }
  const seen = new Set();
  return found.sort((a, b) => a.at - b.at).filter((x) => (seen.has(x.t) ? false : seen.add(x.t))).slice(0, max);
}
