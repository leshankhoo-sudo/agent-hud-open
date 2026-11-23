// The atlas house: a small Japanese house in the bottom-left corner of the map (and, in the trip planner, in
// the slot the Support button had; nowhere else), and the girl in a
// kimono who lives in it and opens the assistant. An original cartoon drawing (SVG) in the style of the
// references the team chose: thick brown outlines, flat colours, a round face, dot eyes and pink cheeks.
//   double-click the house  -> a knock (the doors shake, "kon kon"), the doors slide open, she steps out,
//                              bows, waves "How can I help?" and the chat opens beside her
//   drag her                -> she is lifted (legs swing, surprised face) and put down wherever you drop her
//   stroke her head         -> she smiles, blushes, hearts rise
//   close the chat          -> she walks back home and the doors close
// Her kimono and the branch over the roof follow the season of the site; nothing here talks to the network.
import { useEffect, useRef, useState } from 'react';
import './atlasHouse.css';

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, reduce() ? Math.min(ms, 60) : ms));

// colours by season: kimono, its shade, the obi, the pattern; the branch over the roof
const SEASON = {
  spring: { kim: '#f7a8bb', kim2: '#e3869d', obi: '#f6c552', flower: '#fffaf1', mid: '#f38fa6', branch: 'blossom' },
  summer: { kim: '#8fd3da', kim2: '#6bb7c0', obi: '#f7a0b4', flower: '#fffaf1', mid: '#f7a0b4', branch: 'leaves' },
  autumn: { kim: '#ec6d4f', kim2: '#cd543a', obi: '#f6c552', flower: '#fff3e2', mid: '#f39a7a', branch: 'momiji' },
  winter: { kim: '#a796d2', kim2: '#8a78b8', obi: '#f7a0b4', flower: '#fffaf1', mid: '#c7b8ea', branch: 'snow' },
};
const BRANCH = [[262, 8], [244, 0], [228, 14], [204, 6], [188, 20], [170, 14], [156, 30], [140, 24], [124, 36], [106, 34], [94, 46], [250, 34], [236, 40], [150, 50], [162, 62], [214, 24], [276, 14], [196, 30], [132, 44], [116, 44]];

function knockSound() {
  try {
    const A = window.__atlasAudio || (window.__atlasAudio = new (window.AudioContext || window.webkitAudioContext)());
    for (const at of [0, 0.22]) {
      const t = A.currentTime + at, o = A.createOscillator(), g = A.createGain(), f = A.createBiquadFilter();
      o.type = 'triangle'; o.frequency.setValueAtTime(230, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.09);
      f.type = 'lowpass'; f.frequency.value = 900;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(f).connect(g).connect(A.destination); o.start(t); o.stop(t + 0.15);
    }
  } catch { /* no sound */ }
}

function House({ season, open, knocking }) {
  const S = SEASON[season] || SEASON.spring;
  const leaf = S.branch;
  return (
    <svg viewBox="-6 -10 290 300" className={'ah-svg' + (open ? ' open' : '') + (knocking ? ' knocking' : '')} aria-hidden="true">
      <defs>
        <g id="ah-blossom"><g fill="#ffc4d2" stroke="#e98aa3" strokeWidth="1"><circle cx="0" cy="-4" r="3.6" /><circle cx="3.8" cy="-1.2" r="3.6" /><circle cx="2.4" cy="3.3" r="3.6" /><circle cx="-2.4" cy="3.3" r="3.6" /><circle cx="-3.8" cy="-1.2" r="3.6" /></g><circle r="1.6" fill="#e0587a" /></g>
        <g id="ah-leaves"><ellipse cx="-2" cy="0" rx="6" ry="3.4" fill="#86c46c" stroke="#4a2f24" strokeWidth="1.2" transform="rotate(-30)" /><ellipse cx="3" cy="2" rx="6" ry="3.4" fill="#6fae5a" stroke="#4a2f24" strokeWidth="1.2" transform="rotate(25)" /></g>
        <g id="ah-momiji"><path d="M0 -6 L1.6 -2 L5.6 -3.2 L3 0.4 L5.4 4 L1 2.6 L0 6.4 L-1 2.6 L-5.4 4 L-3 0.4 L-5.6 -3.2 L-1.6 -2 Z" fill="#f06a3a" stroke="#4a2f24" strokeWidth="1" /></g>
        <g id="ah-snow"><circle r="4" fill="#ffffff" stroke="#cfd8e6" strokeWidth="1" /></g>
        <clipPath id="ah-doorway"><rect x="80" y="172" width="110" height="90" /></clipPath>
        <radialGradient id="ah-warm" cx="50%" cy="40%" r="70%"><stop offset="0" stopColor="#ffe2a6" /><stop offset="1" stopColor="#e79a52" /></radialGradient>
        <radialGradient id="ah-glow"><stop offset="0" stopColor="#ffd98a" stopOpacity=".9" /><stop offset="1" stopColor="#ffd98a" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse cx="135" cy="276" rx="146" ry="14" fill="rgba(74,47,36,.16)" />
      {/* upper floor */}
      <rect x="40" y="66" width="190" height="78" fill="#f8ecd8" className="ol" />
      <rect x="54" y="80" width="62" height="48" rx="3" fill="#fff6e4" className="ol2" />
      <path d="M85 80V128M54 96H116M54 112H116M70 80V128M100 80V128" stroke="#c89a6a" strokeWidth="2" />
      <rect x="148" y="78" width="72" height="50" rx="3" fill="url(#ah-warm)" className="ol2" />
      <path d="M172 78V128M196 78V128M148 96H220" stroke="#b9773f" strokeWidth="2" />
      <rect x="140" y="112" width="88" height="8" rx="2" fill="#b5653d" className="ol2" />
      <path d="M148 120V142M158 120V142M168 120V142M178 120V142M188 120V142M198 120V142M208 120V142M218 120V142" className="ol2" fill="none" />
      <path d="M40 66H230M40 142H230M134 66V142" stroke="#9a6a45" strokeWidth="4" />
      {/* main roof */}
      <path d="M2 74Q16 72 30 62L78 22H192L240 62Q254 72 268 74L262 82H8Z" fill="#a9a3ad" className="ol" />
      <path d="M44 58L84 26M60 62L96 26M76 64L108 26M92 66L120 26M108 66L132 26M124 66L144 26M140 66L156 26M156 66L168 26M172 66L180 26M188 64L190 26M204 62L200 28M220 60L210 34" stroke="#8d8794" strokeWidth="2.5" />
      <path d="M8 82H262" stroke="#7d7684" strokeWidth="5" />
      <rect x="74" y="15" width="122" height="10" rx="4" fill="#7d7684" className="ol2" />
      <circle cx="74" cy="20" r="7" fill="#7d7684" className="ol2" /><circle cx="196" cy="20" r="7" fill="#7d7684" className="ol2" />
      {leaf === 'snow' && <path d="M14 72Q30 60 40 52L80 22H190L230 52Q242 62 258 72Q236 66 222 60L190 34H82L52 60Q34 68 14 72Z" fill="#fff" opacity=".92" />}
      {/* ground floor */}
      <rect x="20" y="160" width="230" height="104" fill="#f8ecd8" className="ol" />
      <rect x="20" y="236" width="230" height="28" fill="#d9a877" className="ol2" />
      <path d="M40 236V264M60 236V264M210 236V264M230 236V264" stroke="#b3804f" strokeWidth="2" />
      <g className="ah-inside">
        <rect x="80" y="172" width="110" height="90" fill="#6a4535" />
        <rect x="86" y="176" width="98" height="86" fill="url(#ah-warm)" opacity=".85" />
        <path d="M96 190H128M96 206H128M150 196H178" stroke="#a5683e" strokeWidth="3" />
        <circle cx="112" cy="185" r="4" fill="#8f5a3a" /><rect x="156" y="186" width="10" height="9" fill="#8f5a3a" />
      </g>
      <g clipPath="url(#ah-doorway)">
        <g className="ah-door l"><rect x="80" y="172" width="55" height="90" fill="#e8a65e" className="ol2" /><rect x="86" y="178" width="43" height="44" fill="#fff6e4" className="ol2" /><path d="M100 178V222M114 178V222M86 192H129M86 207H129" stroke="#c89a6a" strokeWidth="2" /><circle cx="130" cy="240" r="2.6" fill="#7a4a2d" /></g>
        <g className="ah-door r"><rect x="135" y="172" width="55" height="90" fill="#e8a65e" className="ol2" /><rect x="141" y="178" width="43" height="44" fill="#fff6e4" className="ol2" /><path d="M155 178V222M169 178V222M141 192H184M141 207H184" stroke="#c89a6a" strokeWidth="2" /><circle cx="140" cy="240" r="2.6" fill="#7a4a2d" /></g>
      </g>
      <rect x="80" y="172" width="110" height="90" fill="none" className="ol2" />
      <path d="M20 160H250M76 160V264M194 160V264" stroke="#9a6a45" strokeWidth="5" />
      {/* lower roof */}
      <path d="M-4 168Q8 166 18 152L30 140H240L252 152Q262 166 274 168L268 174H2Z" fill="#a9a3ad" className="ol" />
      <path d="M40 166L50 142M62 168L68 142M84 168L88 142M106 168L108 142M128 168L128 142M150 168L148 142M172 168L168 142M194 168L188 142M216 168L208 142M234 166L226 142" stroke="#8d8794" strokeWidth="2.5" />
      <path d="M2 174H268" stroke="#7d7684" strokeWidth="4" />
      {leaf === 'snow' && <path d="M0 166Q12 160 22 150L32 142H238L248 150Q258 160 270 166Q250 162 240 152H30Q20 162 0 166Z" fill="#fff" opacity=".92" />}
      {/* lanterns */}
      <circle cx="50" cy="196" r="24" fill="url(#ah-glow)" className="ah-halo" /><circle cx="220" cy="196" r="24" fill="url(#ah-glow)" className="ah-halo" />
      <path d="M50 174V182M220 174V182" className="ol2" />
      <rect x="40" y="182" width="20" height="26" rx="9" fill="#ffd36e" className="ol2" /><path d="M41 190H59M41 199H59" stroke="#e7a23c" strokeWidth="2" />
      <rect x="210" y="182" width="20" height="26" rx="9" fill="#ffd36e" className="ol2" /><path d="M211 190H229M211 199H229" stroke="#e7a23c" strokeWidth="2" />
      {/* step and plants */}
      <rect x="96" y="262" width="78" height="12" rx="3" fill="#cfc6b8" className="ol2" />
      <path d="M24 270L30 246H58L64 270Z" fill="#d98a5c" className="ol2" /><ellipse cx="44" cy="232" rx="20" ry="13" fill="#7cae64" className="ol2" /><ellipse cx="34" cy="226" rx="11" ry="8" fill="#94c477" className="ol2" /><path d="M44 245V236" className="ol2" />
      <path d="M206 274Q196 248 212 236H246Q262 248 252 274Z" fill="#d9573f" className="ol2" /><ellipse cx="229" cy="230" rx="24" ry="12" fill="#5f8f55" className="ol2" />
      <circle cx="216" cy="226" r="4" fill="#ff8aa0" className="ol2" /><circle cx="230" cy="221" r="4" fill="#ffd36e" className="ol2" /><circle cx="243" cy="227" r="4" fill="#ff8aa0" className="ol2" />
      {/* the branch over the roof, by season */}
      <path d="M284 -6C250 10 210 0 170 20C140 34 110 30 86 46" fill="none" stroke="#7a4e36" strokeWidth="7" strokeLinecap="round" />
      <path d="M214 8C224 26 236 34 250 38M150 28C146 40 150 52 160 60" fill="none" stroke="#7a4e36" strokeWidth="4" strokeLinecap="round" />
      {BRANCH.map(([x, y], i) => (leaf === 'snow' && i % 2 ? null : <use key={i} href={`#ah-${leaf}`} transform={`translate(${x} ${y}) scale(${0.9 + (i % 3) * 0.25})`} />))}
    </svg>
  );
}

// the girl: 100 x 140 drawing units; pose: stand | bow | wave; face: open | blink | shut | happy | wide
function Girl({ season, pose, face, look }) {
  const S = SEASON[season] || SEASON.spring;
  const fl = (x, y, s = 1) => (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <g fill={S.flower} stroke="#4a2f24" strokeWidth="0.9"><circle cx="0" cy="-3.4" r="2.9" /><circle cx="3.2" cy="-1.1" r="2.9" /><circle cx="2" cy="2.8" r="2.9" /><circle cx="-2" cy="2.8" r="2.9" /><circle cx="-3.2" cy="-1.1" r="2.9" /></g><circle r="1.4" fill={S.mid} />
    </g>
  );
  const lx = (look?.x || 0) * 1.6, ly = (look?.y || 0) * 1.2;
  return (
    <svg viewBox="0 0 100 142" className="ah-girl-svg" aria-hidden="true">
      <defs>
        <clipPath id="ah-kim"><path d="M30 78Q25 106 28 128L72 128Q75 106 70 78Z M32 80Q12 84 12 106Q12 118 25 118L36 115Z M68 80Q88 84 88 106Q88 118 75 118L64 115Z" /></clipPath>
      </defs>
      <ellipse cx="50" cy="138" rx="24" ry="3.6" fill="rgba(74,47,36,.18)" />
      <g className="ah-body">
        <g className="ah-feet"><ellipse cx="42" cy="131" rx="6.5" ry="4" fill="#fffaf1" className="ol2" /><ellipse cx="58" cy="131" rx="6.5" ry="4" fill="#fffaf1" className="ol2" /><rect x="35" y="134" width="14" height="4" rx="2" fill="#7a4e36" /><rect x="51" y="134" width="14" height="4" rx="2" fill="#7a4e36" /></g>
        <path d="M30 78Q25 106 28 128L72 128Q75 106 70 78Z" fill={S.kim} className="ol" />
        <path d="M32 80Q12 84 12 106Q12 118 25 118L36 115Z" fill={S.kim} className="ol" />
        <g className={'ah-arm' + (pose === 'wave' ? ' up' : '')}>
          <path d="M68 80Q88 84 88 106Q88 118 75 118L64 115Z" fill={S.kim} className="ol" />
          {pose === 'wave' && <circle cx="80" cy="120" r="6" fill="#ffe5d2" className="ol2" />}
        </g>
        <g clipPath="url(#ah-kim)">{fl(35, 117, 1.05)}{fl(63, 119, 0.95)}{fl(20, 103, 1.05)}{fl(80, 106, 1.05)}{fl(64, 84, 0.8)}{fl(16, 92, 0.7)}{fl(86, 94, 0.7)}</g>
        <path d="M29 122Q50 125 71 122L72 128L28 128Z" fill={S.kim2} />
        <path d="M40 78L50 92L60 78" fill="none" stroke="#fffaf1" strokeWidth="5" /><path d="M43 78L50 88L57 78" fill="none" stroke="#d64545" strokeWidth="2" />
        <rect x="29" y="90" width="42" height="13" rx="3" fill={S.obi} className="ol2" /><path d="M30 96.5H70" stroke="#d64545" strokeWidth="2.4" /><circle cx="50" cy="96.5" r="2.6" fill="#7cc7b8" className="ol2" />
        {pose !== 'wave' && <g><circle cx="45" cy="104" r="5.4" fill="#ffe5d2" className="ol2" /><circle cx="55" cy="104" r="5.4" fill="#ffe5d2" className="ol2" /></g>}
      </g>
      <g className={'ah-head' + (pose === 'bow' ? ' bow' : '')}>
        <ellipse cx="50" cy="47" rx="39" ry="35" fill="#4a3328" className="ol" />
        <circle cx="50" cy="13" r="12" fill="#4a3328" className="ol" />
        <ellipse cx="50" cy="23" rx="11.5" ry="3.4" fill="#e0503a" className="ol2" />
        {fl(67, 18, 2)}
        <g transform="translate(60 8)"><g fill="#ff9fb4" stroke="#4a2f24" strokeWidth=".9"><circle cx="0" cy="-2.2" r="2" /><circle cx="2.1" cy="-.7" r="2" /><circle cx="1.3" cy="1.8" r="2" /><circle cx="-1.3" cy="1.8" r="2" /><circle cx="-2.1" cy="-.7" r="2" /></g></g>
        <path d="M72 25V35M76 24V31" stroke="#e8b84a" strokeWidth="2" /><circle cx="72" cy="36" r="1.9" fill="#e8b84a" /><circle cx="76" cy="32" r="1.9" fill="#e8b84a" />
        <ellipse cx="50" cy="54" rx="33" ry="28" fill="#ffe5d2" className="ol" />
        <path d="M16 52Q15 22 50 21Q85 22 84 52Q79 41 70 43Q62 35 50 40Q38 35 30 43Q21 41 16 52Z" fill="#4a3328" className="ol" />
        <path d="M16 48Q9 64 17 77Q24 71 21 56Z M84 48Q91 64 83 77Q76 71 79 56Z" fill="#4a3328" className="ol" />
        <path d="M32 28Q41 24 50 25" stroke="#6b5040" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <g transform={`translate(${lx} ${ly})`}>
          {face === 'open' && <g><ellipse cx="38" cy="58" rx="3.5" ry="4.3" fill="#2a1a16" /><ellipse cx="62" cy="58" rx="3.5" ry="4.3" fill="#2a1a16" /><circle cx="36.9" cy="56.4" r="1.3" fill="#fff" /><circle cx="60.9" cy="56.4" r="1.3" fill="#fff" /></g>}
          {face === 'wide' && <g><circle cx="38" cy="58" r="4.8" fill="#fff" className="ol2" /><circle cx="62" cy="58" r="4.8" fill="#fff" className="ol2" /><circle cx="38" cy="58.6" r="2.4" fill="#2a1a16" /><circle cx="62" cy="58.6" r="2.4" fill="#2a1a16" /></g>}
        </g>
        {(face === 'blink' || face === 'shut') && <g fill="none" stroke="#2a1a16" strokeWidth="2.6" strokeLinecap="round"><path d="M34 58Q38 60.5 42 58" /><path d="M58 58Q62 60.5 66 58" /></g>}
        {face === 'happy' && <g fill="none" stroke="#2a1a16" strokeWidth="2.6" strokeLinecap="round"><path d="M33.5 59.5Q38 53.5 42.5 59.5" /><path d="M57.5 59.5Q62 53.5 66.5 59.5" /></g>}
        <ellipse cx="29" cy="65" rx="6.6" ry="4" fill="#ff9e9e" opacity={face === 'happy' ? 1 : 0.75} /><ellipse cx="71" cy="65" rx="6.6" ry="4" fill="#ff9e9e" opacity={face === 'happy' ? 1 : 0.75} />
        {face === 'wide' ? <ellipse cx="50" cy="67" rx="2.4" ry="3" fill="#c9503a" className="ol2" /> : <path d={face === 'happy' ? 'M45 64Q50 70 55 64' : 'M46 65Q50 68.5 54 65'} fill={face === 'happy' ? '#c9503a' : 'none'} stroke="#4a2f24" strokeWidth="2.2" strokeLinecap="round" />}
      </g>
    </svg>
  );
}

// open: the chat is open; onOpen asks the app to open it; ready: the atlas data has loaded
const TUCK_KEY = 'kyoto-house-tucked';
// where the house sits: in the trip planner the old Support slot, else the map's bottom-left corner, above
// its credit line; null when neither is on screen
function anchor() {
  const phone = innerWidth <= 640, w = phone ? 64 : 96, h = Math.round(w * 1.03);
  const slot = document.querySelector('.trip .tp-support');
  if (slot) {
    const r = slot.getBoundingClientRect();
    if (r.width) return { x: Math.round(r.left + r.width / 2 - w / 2), y: Math.round(r.bottom - h + (phone ? 0 : 6)), w, h, where: 'trip' };
  }
  const m = document.querySelector('#dashboard .center');
  if (!m || document.querySelector('.trip')) return null;
  const r = m.getBoundingClientRect(), bottom = r.bottom - (phone ? 26 : 30), top = bottom - h;
  if (top < Math.max(0, r.top) || bottom > innerHeight || r.width < 200) return null;   // the corner is not on screen
  return { x: Math.round(r.left + (phone ? 8 : 12)), y: Math.round(top), w, h, where: 'map' };
}

export default function AtlasHouse({ open, onOpen, ready = true }) {
  const [season, setSeason] = useState(() => document.documentElement.dataset.season || 'spring');
  const [phase, setPhase] = useState('home');       // home | knock | out | held | returning
  const [doorOpen, setDoorOpen] = useState(false);
  const [pose, setPose] = useState('stand');
  const [face, setFace] = useState('open');
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [pos, setPos] = useState(null);             // the girl's top-left (px, in the window) when she is out
  const [bubble, setBubble] = useState(null);
  const [hearts, setHearts] = useState([]);
  const [drop, setDrop] = useState(0);
  const houseRef = useRef(null), girlRef = useRef(null);
  const run = useRef(0);                            // the current sequence; a newer one cancels it
  const [place, setPlace] = useState(null);         // { x, y, w, h, where } or null: hidden
  const [tucked, setTuckedState] = useState(() => { try { return localStorage.getItem(TUCK_KEY) === '1'; } catch { return false; } });
  const setTucked = (v) => { setTuckedState(v); try { localStorage.setItem(TUCK_KEY, v ? '1' : '0'); } catch { /* not kept */ } };
  const live = useRef({ phase, open, pos });
  live.current = { phase, open, pos, placed: !!place, tucked };
  // follow the slot: on scroll and resize, and now and then for layout changes (the trip planner opening)
  useEffect(() => {
    let raf = 0;
    const upd = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; const a = anchor(); setPlace((p) => (JSON.stringify(p) === JSON.stringify(a) ? p : a)); }); };
    upd();
    addEventListener('scroll', upd, { passive: true }); addEventListener('resize', upd);
    const iv = setInterval(upd, 400);
    return () => { removeEventListener('scroll', upd); removeEventListener('resize', upd); clearInterval(iv); cancelAnimationFrame(raf); };
  }, []);

  useEffect(() => {
    const mo = new MutationObserver(() => setSeason(document.documentElement.dataset.season || 'spring'));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-season'] });
    return () => mo.disconnect();
  }, []);
  // she is a little bigger than the house's door, as if she stepped towards you
  const size = () => { const w = innerWidth <= 640 ? 44 : 60; return { w, h: w * 1.42 }; };
  // where she stands at home: in front of the doors, a little to the right
  const homePos = () => {
    const r = houseRef.current?.getBoundingClientRect(), { w, h } = size();
    if (!r) return { x: 120, y: innerHeight - h - 16 };
    return { x: r.left + r.width * 0.5 - w * 0.42, y: r.bottom - h - r.height * 0.03 };
  };
  // blink now and then
  useEffect(() => {
    if (phase === 'home') return undefined;
    let t;
    const tick = () => { t = setTimeout(() => { setFace((f) => (f === 'open' ? 'blink' : f)); setTimeout(() => setFace((f) => (f === 'blink' ? 'open' : f)), 140); tick(); }, 2600 + Math.random() * 2600); };
    tick();
    return () => clearTimeout(t);
  }, [phase]);
  // her eyes follow the pointer
  useEffect(() => {
    if (phase === 'home') return undefined;
    let raf = 0;
    const mv = (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = girlRef.current?.getBoundingClientRect();
        if (!r) return;
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * 0.4), d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 220);
        setLook({ x: (dx / d) * k, y: (dy / d) * k });
      });
    };
    addEventListener('pointermove', mv, { passive: true });
    return () => { removeEventListener('pointermove', mv); cancelAnimationFrame(raf); };
  }, [phase]);

  const comeOut = async (knock) => {
    const id = ++run.current;
    const ok = () => run.current === id;
    setBubble(null);
    if (knock) {
      setPhase('knock'); knockSound();
      await sleep(950); if (!ok()) return;
    }
    setDoorOpen(true);
    await sleep(520); if (!ok()) return;
    setPos(homePos()); setPose('stand'); setFace('open'); setPhase('out');
    await sleep(480); if (!ok()) return;
    setPose('bow'); setFace('shut');
    await sleep(720); if (!ok()) return;
    setPose('wave'); setFace('open'); setBubble('How can I help?');
    await sleep(1200); if (!ok()) return;
    setPose('stand');
    if (!live.current.open) onOpen?.();
    await sleep(400); if (!ok()) return;
    setBubble(null);
  };
  const goHome = async () => {
    const id = ++run.current;
    const ok = () => run.current === id;
    setBubble(null); setFace('open'); setPose('stand');
    setPhase('returning'); setPos(homePos());
    await sleep(760); if (!ok()) return;
    setPhase('home');
    await sleep(200); if (!ok()) return;
    setDoorOpen(false);
  };
  // the chat opened another way (the map tools): she comes out without knocking; it closed: she goes home
  useEffect(() => {
    const ph = live.current.phase;
    if (open && ph === 'home' && live.current.placed) { if (live.current.tucked) setTucked(false); comeOut(false); }
    if (!open && (ph === 'out' || ph === 'held')) goHome();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // the house left the screen while she was out: she slips back in (the chat, if open, stays); it came back
  // while the chat is open: she comes out again
  useEffect(() => {
    if (!place && live.current.phase !== 'home' && live.current.phase !== 'held') { run.current++; setPhase('home'); setDoorOpen(false); setBubble(null); }
    else if (place && !tucked && live.current.open && live.current.phase === 'home') comeOut(false);
  }, [!!place, place?.where]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const r = () => { if (live.current.phase === 'out' && live.current.pos) setPos((p) => clampPos(p)); }; addEventListener('resize', r); return () => removeEventListener('resize', r); }, []);

  const clampPos = (p) => { const { w, h } = size(); return { x: Math.max(4, Math.min(innerWidth - w - 4, p.x)), y: Math.max(4, Math.min(innerHeight - h - 4, p.y)) }; };
  const knockHouse = () => {
    if (!ready) { setBubble('One moment, the atlas is still loading.'); setTimeout(() => setBubble(null), 1800); return; }
    const ph = live.current.phase;
    if (ph === 'home') comeOut(true);
    else if (!live.current.open) onOpen?.();
  };
  const hint = useRef(0);
  const clickHouse = () => {
    if (live.current.phase !== 'home') return;
    clearTimeout(hint.current);
    setBubble('Double-click to knock');
    hint.current = setTimeout(() => setBubble((b) => (b === 'Double-click to knock' ? null : b)), 1600);
  };

  // drag her by where you hold her; a click without moving opens the chat; stroking her head pleases her
  const grab = useRef(null), stroke = useRef({ d: 0, t: 0, x: 0 });
  const onDown = (e) => {
    if (live.current.phase !== 'out' || e.button > 0) return;
    e.preventDefault();
    const p = live.current.pos;
    grab.current = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: e.clientX - p.x, oy: e.clientY - p.y, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    const g = grab.current;
    if (g && g.id === e.pointerId) {
      if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 5) { g.moved = true; run.current++; setBubble(null); setPhase('held'); setFace('wide'); setPose('stand'); }
      if (g.moved) setPos({ x: e.clientX - g.ox, y: e.clientY - g.oy });
      return;
    }
    // petting: the pointer moving to and fro over her head
    if (live.current.phase !== 'out' || e.buttons) return;
    const r = girlRef.current.getBoundingClientRect();
    if (e.clientY > r.top + r.height * 0.5) return;
    const s = stroke.current, now = performance.now();
    if (now - s.t > 700) s.d = 0;
    s.d += Math.abs(e.clientX - (s.x || e.clientX)); s.x = e.clientX; s.t = now;
    if (s.d > 110) { s.d = -150; pet(); }   // keep stroking: she stays happy, with a few more hearts now and then
  };
  const onUp = (e) => {
    const g = grab.current;
    if (!g || g.id !== e.pointerId) return;
    grab.current = null;
    if (g.moved) {
      setPos((p) => clampPos(p)); setPhase('out'); setFace('open'); setDrop((n) => n + 1);
    } else if (!live.current.open) onOpen?.();
    else pet();
  };
  const petTimer = useRef(0);
  const pet = () => {
    clearTimeout(petTimer.current);
    setFace('happy');
    const n = Date.now();
    setHearts((h) => [...h.slice(-6), ...[0, 1, 2].map((i) => ({ id: n + i, dx: 8 + i * 12, delay: i * 140 }))]);
    petTimer.current = setTimeout(() => { setFace((f) => (f === 'happy' ? 'open' : f)); setHearts([]); }, 1700);
  };

  const { w, h } = size();
  const out = phase !== 'home' && phase !== 'knock' && pos;
  const style = place ? { left: place.x, top: place.y, width: place.w, height: place.h } : undefined;
  return (
    <>
      {place && tucked && (
        <button type="button" className="ah-badge" style={{ left: place.x, top: place.y + place.h - 44 }} onClick={() => setTucked(false)} aria-label="Show the atlas house" title="Show the atlas house">
          <svg viewBox="0 0 40 40" aria-hidden="true"><path d="M5 18L20 7L35 18Z" fill="#a9a3ad" stroke="#4a2f24" strokeWidth="2.4" strokeLinejoin="round" /><rect x="10" y="18" width="20" height="15" fill="#f8ecd8" stroke="#4a2f24" strokeWidth="2.4" /><rect x="16.5" y="23" width="7" height="10" fill="#e8a65e" stroke="#4a2f24" strokeWidth="2" /></svg>
        </button>
      )}
      <button ref={houseRef} type="button" style={style} hidden={!place || tucked} className={'ah-house' + (phase === 'knock' ? ' knock' : '') + (place ? ` in-${place.where}` : '')} onClick={clickHouse} onDoubleClick={knockHouse}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); knockHouse(); } }}
        aria-label="Atlas assistant: double-click the house (or press Enter) to knock" title="Atlas assistant · double-click to knock">
        <House season={season} open={doorOpen} knocking={phase === 'knock'} />
        {phase === 'knock' && <><span className="ah-kon a" aria-hidden="true">コン</span><span className="ah-kon b" aria-hidden="true">コン</span></>}
      </button>
      {place && !tucked && phase === 'home' && (
        <button type="button" className="ah-tuck" style={{ left: place.x + place.w - 16, top: place.y + 2 }} onClick={() => setTucked(true)} aria-label="Tuck the house away" title="Tuck the house away">
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5L6 7.5L9 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      {out && (
        <div ref={girlRef} className={`ah-girl ${phase}` + (drop ? ` drop${drop % 2}` : '')} style={{ left: pos.x, top: pos.y, width: w, height: h }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          role="img" aria-label="The atlas guide in a kimono. Drag her anywhere; stroke her head.">
          <Girl season={season} pose={pose} face={face} look={look} />
          {hearts.map((x) => <span key={x.id} className="ah-heart" style={{ left: `${70 + x.dx}%`, animationDelay: `${x.delay}ms` }} aria-hidden="true">♥</span>)}
        </div>
      )}
      {bubble && (
        <div className="ah-bubble" style={out ? { left: pos.x + w * 0.78, top: pos.y - 14 } : place ? { left: place.x + place.w * 0.3, top: place.y - 30 } : { display: 'none' }} role="status">{bubble}</div>
      )}
    </>
  );
}
