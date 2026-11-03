// 主角是我自己 — a 64-second one-take drawn entirely by this file.
//
// drawScene(ctx, t) paints the whole desktop at time t in world pixels
// (1920 x 1080). Nothing in it keeps state between frames, so any moment can
// be drawn again at will: the film strip's frames are earlier moments drawn
// small, and the player's screen is this very moment drawn inside itself.
// The camera sits outside the scene; frame(t) puts the two together.
(() => {
  "use strict";
  const D = window.FILM_DATA;
  const TL = D.timeline;
  const C = TL.cues;
  const W = 1920;
  const H = 1080;
  const DUR = TL.duration;
  const MONO = '"JetBrains Mono", "SF Mono", Menlo, monospace';
  const CJK =
    '"PingFang SC", "Hiragino Sans GB", "WenQuanYi Zen Hei", "Noto Sans CJK SC", sans-serif';
  const UI = `${MONO.replace(", monospace", "")}, ${CJK}`;

  // ---- small math -----------------------------------------------------------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, u) => a + (b - a) * u;
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const smooth = (u) => u * u * (3 - 2 * u);
  const inOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
  const out3 = (u) => 1 - (1 - u) ** 3;
  const back = (u) => 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2;
  const arc = (a, b, u, h) => ({
    x: lerp(a.x, b.x, u),
    y: lerp(a.y, b.y, u) - h * 4 * u * (1 - u),
  });
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const mix = (a, b, u) => {
    const x = hex(a),
      y = hex(b);
    return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], u))).join(",")})`;
  };
  const rgbMix = (a, b, u) => {
    const x = typeof a === "string" ? hex(a) : a,
      y = typeof b === "string" ? hex(b) : b;
    return x.map((v, i) => lerp(v, y[i], u));
  };
  const css = (v) => `rgb(${v.map(Math.round).join(",")})`;

  // ---- palette ----------------------------------------------------------------
  const K = {
    clawd: "#d97757",
    ink: "#141413",
    ivory: "#faf9f5",
    paper: "#f0eee6",
    line: "#dedbd0",
    mid: "#b0aea5",
    slate: "#3d3d3a",
    term: "#1f1e1d",
    agent: ["#6a9bcc", "#788c5d", "#d4a24c", "#d97757"],
  };

  // ---- sprites ------------------------------------------------------------------
  const SPR = {};
  for (const [name, raw] of Object.entries(D.sprites)) {
    const v = (c) => (c === "." ? 255 : parseInt(c, 36));
    let px = Array.from(raw.base, v);
    const frames = [px];
    for (const delta of raw.deltas) {
      px = px.slice();
      for (const ch of delta.split(","))
        if (ch.length >= 2) px[parseInt(ch.slice(0, -1), 36)] = v(ch.slice(-1));
      frames.push(px);
    }
    const box = raw.a0?.length === 4 ? raw.a0 : [0, 0, raw.w, raw.h];
    SPR[name] = {
      w: raw.w,
      h: raw.h,
      ax: box[0] + Math.floor(box[2] / 2),
      ay: box[1] + box[3],
      frames: frames.map((f) => {
        const cv = document.createElement("canvas");
        cv.width = raw.w;
        cv.height = raw.h;
        const g = cv.getContext("2d");
        const img = g.createImageData(raw.w, raw.h);
        f.forEach((c, i) => {
          if (c === 255) return;
          const [r, gg, b] = hex(raw.palette[c].slice(0, 7));
          img.data.set([r, gg, b, 255], i * 4);
        });
        g.putImageData(img, 0, 0);
        return cv;
      }),
    };
  }
  const seq = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const CLIPS = {
    look: ["LookingAround", seq(0, 30)],
    walk: ["Walking", seq(4, 23)],
    stand: ["Walking", [0]],
    excited: ["Excited", seq(0, 22)],
    cheer: ["Excited", seq(5, 20)],
    point: ["Pointing", seq(29, 42)],
    laptop: ["Laptop", seq(26, 41)],
    dance: ["DancingHappy", seq(0, 39)],
    think: ["Thinking", seq(4, 19)],
    spark: ["Spark", seq(5, 33)],
    wave: ["Waving", seq(5, 16)],
  };
  /** Frame `clip` shows `dt` seconds after it started, at the HUD's 12 fps. */
  function frameOf(clip, dt, loop = true, fps = 12) {
    const [name, list] = CLIPS[clip];
    let i = Math.floor(Math.max(0, dt) * fps);
    i = loop ? i % list.length : Math.min(i, list.length - 1);
    return { name, i: list[i] };
  }

  function drawClawd(g, p) {
    if (!p || p.hidden) return;
    const s = SPR[p.name];
    const img = s.frames[p.i] ?? s.frames[0];
    g.save();
    g.translate(p.x, p.y);
    if (p.alpha != null) g.globalAlpha *= p.alpha;
    if (p.rot) g.rotate(p.rot);
    g.scale((p.flip ? -1 : 1) * p.P * (p.sx ?? 1), p.P * (p.sy ?? 1));
    g.drawImage(img, -s.ax, -s.ay);
    g.restore();
  }
  const pose = (x, y, P, clip, dt = 0, extra = {}) => ({
    x,
    y,
    P,
    ...frameOf(clip, dt, extra.loop ?? true),
    ...extra,
  });

  // The pointer Clawd kicks away and brings back: 12 x 19, drawn at 4x.
  const ARROW = [
    "X...........",
    "XX..........",
    "XWX.........",
    "XWWX........",
    "XWWWX.......",
    "XWWWWX......",
    "XWWWWWX.....",
    "XWWWWWWX....",
    "XWWWWWWWX...",
    "XWWWWWWWWX..",
    "XWWWWWWWWWX.",
    "XWWWWWWXXXXX",
    "XWWWXWWX....",
    "XWWXXWWX....",
    "XWX..XWWX...",
    "XX...XWWX...",
    "X.....XWWX..",
    "......XWWX..",
    ".......XX...",
  ];
  const arrowImg = (() => {
    const cv = document.createElement("canvas");
    cv.width = 12;
    cv.height = 19;
    const g = cv.getContext("2d");
    ARROW.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c === ".") return;
        g.fillStyle = c === "X" ? K.ink : "#ffffff";
        g.fillRect(x, y, 1, 1);
      }),
    );
    return cv;
  })();

  // ---- the set ------------------------------------------------------------------
  const DOCK_TOP = 976;
  const DOCK = { x: 650, y: DOCK_TOP, w: 620, h: 80 };
  const ICON_X = (i) => 702 + i * 103;
  const HOME = { x: 800, y: DOCK_TOP };
  const PTR_REST = { x: 964, y: DOCK_TOP - 38, rot: 0 }; // pointer centre
  const PTR_TIP_STUCK = { x: 1560, y: 20 };
  const PTR_ROT_STUCK = 0.38;
  const rotV = (x, y, a) => ({
    x: x * Math.cos(a) - y * Math.sin(a),
    y: x * Math.sin(a) + y * Math.cos(a),
  });
  const stuckCentre = (rot) => {
    const o = rotV(24, 38, rot);
    return { x: PTR_TIP_STUCK.x + o.x, y: PTR_TIP_STUCK.y + o.y };
  };

  const TERM = { x: 400, y: 140, w: 1120, h: 650 };
  const INPUT_TOP = 600; // top border of the input box, where Clawd stands
  const charX = (i) => 520 + 46 * i + 23;
  const ENTER_X = 1440;
  const PROMPT = [...TL.prompt];

  const WINS = [
    { x: 40, y: 60, w: 900, h: 440 },
    { x: 980, y: 60, w: 900, h: 440 },
    { x: 40, y: 530, w: 900, h: 440 },
    { x: 980, y: 530, w: 900, h: 440 },
  ];
  const WIN_TITLE = ["建模 · clawd.vox", "写代码 · film.js", "配乐 · score.wav", "剪辑 · 主角是我自己"];
  const AGENT_SPOT = [
    { x: 150, y: 470 },
    { x: 1070, y: 470 },
    { x: 150, y: 940 },
    { x: 1070, y: 940 },
  ];
  const WORK_CLIP = ["point", "laptop", "dance", "think"];

  const ED = { x: 100, y: 60, w: 1720, h: 900 };
  const TILE = (k) => ({ x: 140, y: 150 + 90 * k, w: 330, h: 70 });
  const PREVIEW = { x: 520, y: 120, w: 480, h: 270 };
  const BTN = { x: 1560, y: 130, w: 220, h: 100 };
  const WAVE = { x0: 140, x1: 1780, cy: 520, amp: 95, t0: 24.6, t1: 31.4 };
  const WX = (t) => lerp(WAVE.x0, WAVE.x1, (t - WAVE.t0) / (WAVE.t1 - WAVE.t0));
  const LANE_Y = [640, 712, 784];
  const LANE_H = 58;
  const LANE_NAME = ["V1 建模", "V2 代码", "A1 配乐"];
  const TILE_NAME = ["clawd.vox", "film.js", "score.wav"];

  // Player window, before (P1) and after (P2) it moves aside for the title.
  const P1 = { x: 440, y: 100, w: 1040, h: 670 };
  const P2 = { x: 960, y: 196, w: 880, h: 584 };
  const screenOf = (p) => {
    const w = p.w - 80;
    return { x: p.x + 40, y: p.y + 50, w, h: (w * 9) / 16 };
  };

  // ---- audio-derived data ---------------------------------------------------------
  const S = D.score;
  const peakAt = (t) => {
    const i = Math.floor(t * S.peakRate) % (S.peaks.length / 2);
    return [S.peaks[2 * i], S.peaks[2 * i + 1]];
  };
  const peakMax = (t0, t1) => {
    let m = 0;
    for (let t = t0; t <= t1; t += 1 / S.peakRate) {
      const [a, b] = peakAt(t);
      m = Math.max(m, -a, b);
    }
    return m;
  };
  const STOMPS = S.onsets.filter((o) => o >= C.stompFrom - 0.02 && o <= C.stompTo);
  const waveTop = (o) => WAVE.cy - (WAVE.amp * peakMax(o - 0.01, o + 0.03)) / 127;

  // ---- the coaster -------------------------------------------------------------------
  const TRACK = (() => {
    const pts = [
      [150, 870], [320, 875], [470, 760], [590, 470], [690, 300], [800, 268],
      [900, 360], [1000, 690], [1110, 860], [1250, 880],
    ];
    const r = 215;
    for (let k = 0; k <= 8; k++) {
      const a = (k * Math.PI) / 4;
      const cx = lerp(1360, 1470, k / 8);
      pts.push([cx + r * Math.sin(a), 640 + r * Math.cos(a)]);
    }
    pts.push([1590, 872], [1700, 858], [1780, 846]);
    const cr = (p0, p1, p2, p3, u) =>
      0.5 *
      (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
    const dense = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let j = 0; j < 40; j++) {
        const u = j / 40;
        dense.push([cr(p0[0], p1[0], p2[0], p3[0], u), cr(p0[1], p1[1], p2[1], p3[1], u)]);
      }
    }
    dense.push(pts[pts.length - 1]);
    const len = [0];
    for (let i = 1; i < dense.length; i++)
      len.push(len[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    const L = len[len.length - 1];
    function at(s) {
      s = clamp(s, 0, L);
      let lo = 0, hi = len.length - 1;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (len[m] <= s) lo = m;
        else hi = m;
      }
      const u = (s - len[lo]) / (len[hi] - len[lo] || 1);
      const a = dense[lo], b = dense[hi];
      return { x: lerp(a[0], b[0], u), y: lerp(a[1], b[1], u), a: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    }
    // Ride: chain lift to the first crest, then gravity, then brakes.
    let crest = 0;
    for (let s = 0; s < L * 0.3; s += 4) if (at(s).y < at(crest).y) crest = s;
    const yTop = at(crest).y;
    const speed = (s) => {
      if (s < crest) return 520;
      const v = Math.sqrt(150 ** 2 + 2 * 1100 * Math.max(0, at(s).y - yTop));
      return Math.max(40, v * Math.sqrt(clamp((L - s) / 420)));
    };
    const table = [[0, 0]];
    let s = 0, time = 0;
    while (s < L - 1 && time < 60) {
      s = Math.min(L, s + speed(s) / 240);
      time += 1 / 240;
      table.push([time, s]);
    }
    const T = time, span = C.coasterEnd - C.coasterStart;
    function sAt(t) {
      const u = clamp((t - C.coasterStart) / span) * T;
      const i = Math.min(table.length - 1, Math.floor(u * 240));
      return table[i][1];
    }
    // When the cart is at the top of the loop (score.py's whoosh cue).
    let loopTop = 0, best = 1e9;
    for (let t = C.coasterStart; t < C.coasterEnd; t += 0.01) {
      const p = at(sAt(t));
      if (p.x > 1250 && p.x < 1550 && p.y < best) (best = p.y), (loopTop = t);
    }
    return { at, L, sAt, loopTop };
  })();
  const CELL = 84;
  const STRIP = 58;
  const headAt = (t) =>
    t < C.render + 0.3
      ? 0
      : Math.min(TRACK.L, TRACK.sAt(t + 0.9) + 300 * prog(t, C.render + 0.3, C.render + 0.9));
  const tailAt = (t) => TRACK.L * inOut(prog(t, C.coasterEnd + 0.1, C.coasterEnd + 1.0));
  const FILE_FORM = C.coasterEnd + 1.0;

  // ---- poses ------------------------------------------------------------------------
  /** Hops from landing to landing; `marks` are [time, {x, y}] in order. */
  function hops(t, marks, h) {
    for (let i = 1; i < marks.length; i++)
      if (t <= marks[i][0]) {
        const u = prog(t, marks[i - 1][0], marks[i][0]);
        return { ...arc(marks[i - 1][1], marks[i][1], u, h(i)), u, i };
      }
    return { ...marks[marks.length - 1][1], u: 1, i: marks.length };
  }
  const squash = (t, at, dur = 0.16, k = 0.28) => {
    const u = prog(t, at, at + dur);
    return u > 0 && u < 1 ? 1 - k * Math.sin(Math.PI * u) : 1;
  };

  const TITLE = [...TL.title];
  const TX = (i) => 150 + 128 * i + 56;
  const TTOP = 316;

  function mainPose(t) {
    const P = 6;
    if (t < 1.6) return pose(HOME.x, HOME.y, P, "look", t, { loop: false });
    if (t < 2.4) return pose(lerp(800, 860, prog(t, 1.6, 2.4)), HOME.y, P, "walk", (t - 1.6) * 1.4);
    if (t < C.kick) {
      const u = out3(prog(t, 2.4, C.kick));
      return pose(860 - 14 * u, HOME.y, P, "stand", 0, { rot: -0.2 * u });
    }
    if (t < 3.0) {
      const u = prog(t, C.kick, 3.0);
      return pose(846 + 26 * out3(u), HOME.y, P, "stand", 0, { rot: lerp(0.26, 0.05, u) });
    }
    if (t < C.cursor) return pose(872, HOME.y, P, "excited", t - 3.0, { loop: false });
    // From here Clawd is the mouse: it hovers, glides and clicks by stomping.
    const termIcon = { x: ICON_X(0), y: DOCK_TOP };
    if (t < 5.3) {
      const u = out3(prog(t, C.cursor, 5.3));
      return pose(872, HOME.y - 34 * u, P, "stand", 0, { cursor: true });
    }
    if (t < C.termClick) {
      const u = inOut(prog(t, 5.3, C.termClick));
      const p = arc({ x: 872, y: HOME.y - 34 }, termIcon, u, 90);
      return pose(p.x, p.y, P, "stand", 0, { cursor: true, rot: -0.12 * Math.sin(Math.PI * u) });
    }
    const start = { x: charX(-1), y: INPUT_TOP };
    if (t < 7.3) {
      if (t < 6.3) return pose(termIcon.x, termIcon.y, P, "stand", 0, { sy: squash(t, C.termClick, 0.3, 0.3) });
      const u = inOut(prog(t, 6.3, 7.3));
      const p = arc(termIcon, start, u, 160);
      return pose(p.x, p.y, lerp(P, 5, u), "stand", 0, { cursor: true });
    }
    if (t < C.enter) {
      const marks = [[7.3, start]];
      PROMPT.forEach((_, i) => marks.push([C.typeStart + i * C.typeStep, { x: charX(i), y: INPUT_TOP }]));
      marks.push([C.enter, { x: ENTER_X, y: INPUT_TOP }]);
      const p = hops(t, marks, (i) => (i === marks.length - 1 ? 150 : 26));
      return pose(p.x, p.y, 5, "stand", 0, { sy: 1 + 0.12 * Math.sin(Math.PI * p.u) });
    }
    if (t < C.spark)
      return pose(ENTER_X, INPUT_TOP, 5, "think", t - C.enter - 0.15, { sy: squash(t, C.enter, 0.2, 0.32) });
    if (t < C.split) return pose(ENTER_X, INPUT_TOP, 5, "spark", (t - C.spark) * 1.1, { loop: false });
    if (t < C.merge) return { hidden: true };
    // Merged again.
    const audC = { x: 960, y: P1.y + P1.h - 4 };
    if (t < 54.6) {
      const k = out3(prog(t, C.merge, C.merge + 0.3));
      return pose(audC.x, audC.y, lerp(4, P, k), "excited", t - C.merge, { loop: false });
    }
    if (t < C.close + 0.4) {
      const marks = [[54.6, audC]];
      TITLE.forEach((_, i) => marks.push([C.titleStart + i * C.titleStep, { x: TX(i), y: TTOP }]));
      const p = hops(t, marks, (i) => (i === 1 ? 260 : 40));
      if (t < marks[marks.length - 1][0]) return pose(p.x, p.y, P, "stand", 0, { sy: 1 + 0.1 * Math.sin(Math.PI * p.u) });
      const last = marks[marks.length - 1][0];
      return pose(p.x, p.y, P, t < 57.4 ? "excited" : "wave", t - last, { sy: squash(t, last, 0.2) });
    }
    const perch = { x: TX(TITLE.length - 1), y: TTOP };
    const under = { x: 1588, y: 206 };
    if (t < C.grab) {
      const u = inOut(prog(t, C.close + 0.4, C.grab));
      const p = { x: lerp(perch.x, under.x, u), y: lerp(perch.y, under.y, u) - 140 * Math.sin(Math.PI * u) };
      return pose(p.x, p.y, P, "stand", 0, { cursor: true, rot: 0.1 * Math.sin(Math.PI * u) });
    }
    const drop = { x: 864, y: HOME.y };
    if (t < 62.2) {
      const u = inOut(prog(t, C.grab + 0.15, 62.2));
      const dip = 14 * Math.sin(Math.PI * prog(t, C.grab, C.grab + 0.3));
      const p = arc(under, drop, u, 80);
      return pose(p.x, p.y + dip, P, "stand", 0, { cursor: true });
    }
    if (t < C.place + 0.2) return pose(drop.x, drop.y, P, "stand", 0, { sy: squash(t, C.place, 0.3, 0.15) });
    if (t < 63.3) {
      const u = inOut(prog(t, C.place + 0.2, 63.3));
      return pose(lerp(drop.x, HOME.x, u), HOME.y, P, "walk", (63.3 - t) * 1.3);
    }
    return pose(HOME.x, HOME.y, P, "look", 0, { loop: false });
  }

  function pointerPose(t) {
    if (t < C.kick || t >= C.place + 0.4) return { ...PTR_REST };
    if (t < C.stick) {
      const u = prog(t, C.kick, C.stick);
      const e = 1 - (1 - u) ** 1.6;
      const c = stuckCentre(PTR_ROT_STUCK);
      const ctl = { x: 1260, y: -420 };
      const x = (1 - e) ** 2 * PTR_REST.x + 2 * (1 - e) * e * ctl.x + e * e * c.x;
      const y = (1 - e) ** 2 * PTR_REST.y + 2 * (1 - e) * e * ctl.y + e * e * c.y;
      return { x, y, rot: lerp(0, 4 * Math.PI + PTR_ROT_STUCK, out3(u)) };
    }
    if (t < C.grab) {
      const k = t - C.stick;
      const rot = PTR_ROT_STUCK + 0.4 * Math.exp(-5 * k) * Math.sin(16 * k);
      return { ...stuckCentre(rot), rot };
    }
    const m = mainPose(t);
    const held = { x: m.x, y: m.y - 96 - 40, rot: 0 };
    if (t < C.grab + 0.3) {
      const u = smooth(prog(t, C.grab, C.grab + 0.3));
      const s = stuckCentre(PTR_ROT_STUCK);
      return { x: lerp(s.x, held.x, u), y: lerp(s.y, held.y, u), rot: lerp(PTR_ROT_STUCK, 0, u) };
    }
    if (t < 62.2) return held;
    const u = inOut(prog(t, 62.2, C.place));
    const bounce = 6 * Math.sin(Math.PI * prog(t, C.place, C.place + 0.4));
    return { x: lerp(held.x, PTR_REST.x, u), y: lerp(held.y, PTR_REST.y, u) - bounce, rot: 0 };
  }

  const SPLIT_FROM = { x: ENTER_X, y: INPUT_TOP };
  const CART_SEAT = [-96, -32, 32, 96];
  const AUD = [760, 880, 1040, 1160];
  const FILE_END = () => TRACK.at(TRACK.L);
  const SCREEN_C = () => {
    const r = screenOf(P1);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };

  function cartPose(t) {
    const s = TRACK.sAt(t);
    const p = TRACK.at(s);
    const lift = STRIP / 2 + 4;
    const n = { x: Math.sin(p.a), y: -Math.cos(p.a) };
    return { x: p.x + n.x * lift, y: p.y + n.y * lift, a: p.a };
  }
  const seatOf = (k, t) => {
    const c = cartPose(t);
    const o = rotV(CART_SEAT[k], -8, c.a);
    return { x: c.x + o.x, y: c.y + o.y, a: c.a };
  };

  function agentPose(k, t) {
    if (t < C.split || t >= C.merge) return { hidden: true };
    const spot = AGENT_SPOT[k];
    if (t < C.split + 0.8) {
      const u = inOut(prog(t, C.split, C.split + 0.8));
      const p = arc(SPLIT_FROM, spot, u, 220 + 60 * k);
      return pose(p.x, p.y, lerp(5, 4, u), "stand", 0, { rot: (k % 2 ? 1 : -1) * 2 * Math.PI * u });
    }
    const done = C.done[k];
    if (t < C.editor + 0.3) {
      if (t < done) return pose(spot.x, spot.y, 4, WORK_CLIP[k], t - C.split - 0.8, { sy: squash(t, C.split + 0.8) });
      return pose(spot.x, spot.y, 4, "excited", t - done, { loop: false });
    }
    // The editor.
    if (k === 3) {
      if (t < C.render + 0.15) {
        const land0 = { x: WX(STOMPS[0]), y: waveTop(STOMPS[0]) };
        if (t < STOMPS[0]) {
          const u = inOut(prog(t, C.editor + 0.3, STOMPS[0]));
          const p = arc(spot, land0, u, 260);
          return pose(p.x, p.y, 4, "stand", 0);
        }
        const marks = STOMPS.map((o) => [o, { x: WX(o), y: waveTop(o) }]);
        marks.push([C.render, { x: BTN.x + BTN.w / 2, y: BTN.y + 8 }]);
        const p = hops(t, marks, (i) => (i === marks.length - 1 ? 220 : 46));
        const landed = marks[Math.max(0, p.i - 1)][0];
        return pose(p.x, p.y, 4, t > C.render ? "excited" : "stand", t - C.render, {
          sy: p.u >= 1 || t > C.render ? squash(t, C.render, 0.2, 0.35) : 1 + 0.15 * Math.sin(Math.PI * p.u) - 0.25 * (1 - prog(t, landed, landed + 0.08)) * (p.u < 0.2),
        });
      }
    } else {
      const tile = TILE(k);
      const onTile = { x: tile.x + 70, y: tile.y };
      const drop = C.drops[k];
      const lift = drop - 1.0;
      const target = { x: 300 + 180 * k, y: LANE_Y[k] - 40 };
      const rest = { x: 360 + 120 * k, y: ED.y + ED.h - 6 };
      if (t < lift) {
        const u = inOut(prog(t, C.editor + 0.3, C.editor + 0.9 + 0.1 * k));
        const p = arc(spot, onTile, u, 200);
        return pose(p.x, p.y, 4, u < 1 ? "stand" : "look", t - C.editor - 1, { sy: squash(t, C.editor + 0.9 + 0.1 * k) });
      }
      if (t < drop) {
        const u = inOut(prog(t, lift + 0.1, drop));
        const p = arc(onTile, target, u, 120);
        return pose(p.x, p.y, 4, "stand", 0, { cursor: true, carry: k, sy: squash(t, lift, 0.12, 0.3) });
      }
      if (t < C.render + 0.15) {
        const u = inOut(prog(t, drop + 0.15, drop + 0.7));
        const p = arc(target, rest, u, 80);
        return pose(p.x, p.y, 4, u < 1 ? "stand" : "look", t - drop - 0.7);
      }
    }
    // Into the cart.
    const from = k === 3 ? { x: BTN.x + BTN.w / 2, y: BTN.y + 8 } : { x: 360 + 120 * k, y: ED.y + ED.h - 6 };
    if (t < C.coasterStart) {
      const u = inOut(prog(t, C.render + 0.15, C.coasterStart));
      const seat = seatOf(k, C.coasterStart);
      const p = arc(from, seat, u, 200);
      return pose(p.x, p.y, lerp(4, 2.6, u), "stand", 0);
    }
    if (t < C.coasterEnd + 0.15) {
      const seat = seatOf(k, t);
      return pose(seat.x, seat.y, 2.6, "cheer", t - C.coasterStart + k * 0.3, { rot: seat.a, seat: true });
    }
    // Out of the cart, carry the file into the player.
    const fileAt = filePos(t);
    const under = { x: fileAt.x + (k - 1.5) * 52, y: fileAt.y + 92 };
    if (t < FILE_FORM + 0.2) {
      const u = inOut(prog(t, C.coasterEnd + 0.15, FILE_FORM + 0.2));
      const seat = seatOf(k, C.coasterEnd);
      const p = arc(seat, under, u, 90);
      return pose(p.x, p.y, lerp(2.6, 3, u), "stand", 0, { rot: lerp(seat.a, 0, u) });
    }
    if (t < C.fileDrop) return pose(under.x, under.y, 3, "walk", t + k * 0.2, { flip: true, cursor: true });
    const aud = { x: AUD[k], y: P1.y + P1.h - 4 };
    if (t < C.fileDrop + 0.6) {
      const u = inOut(prog(t, C.fileDrop, C.fileDrop + 0.6));
      const p = arc(filePos(C.fileDrop - 0.01), aud, u, 60);
      return pose(p.x + (k - 1.5) * 52 * (1 - u), p.y + 92 * (1 - u), lerp(3, 4, u), "stand", 0);
    }
    if (t < C.merge - 0.5) {
      const clip = (Math.floor((t - 46.6) / 2.2) + k) % 3 === 0 ? "cheer" : "look";
      return pose(aud.x, aud.y, 4, clip, t - 46.6 + k * 0.7, { sy: squash(t, C.fileDrop + 0.6) });
    }
    const u = inOut(prog(t, C.merge - 0.5, C.merge));
    const p = arc(aud, { x: 960, y: aud.y }, u, 120);
    return pose(p.x, p.y, 4, "stand", 0, { rot: (k < 2 ? 1 : -1) * 0.6 * Math.sin(Math.PI * u) });
  }

  function filePos(t) {
    const e = FILE_END();
    const c = SCREEN_C();
    const u = inOut(prog(t, FILE_FORM + 0.3, C.fileDrop));
    return { x: lerp(e.x, c.x, u), y: lerp(e.y - 70, c.y - 40, u) - 60 * Math.sin(Math.PI * u) };
  }

  // ---- background --------------------------------------------------------------------
  const SKY = [
    [0.0, "#47507e", "#f3b88c"],
    [0.08, "#7fa7d4", "#f6dcc0"],
    [0.3, "#77acd9", "#e3eef2"],
    [0.6, "#6f9dc8", "#f2dcb4"],
    [0.72, "#4f4c80", "#f0956a"],
    [0.8, "#1c2140", "#5b4566"],
    [0.9, "#121831", "#2c2f52"],
    [0.96, "#2e3561", "#c48a7e"],
    [1.0, "#47507e", "#f3b88c"],
  ];
  function skyAt(p) {
    for (let i = 1; i < SKY.length; i++)
      if (p <= SKY[i][0]) {
        const u = smooth(prog(p, SKY[i - 1][0], SKY[i][0]));
        return [rgbMix(SKY[i - 1][1], SKY[i][1], u), rgbMix(SKY[i - 1][2], SKY[i][2], u)];
      }
    return [hex(SKY[0][1]), hex(SKY[0][2])];
  }
  const rand = (() => {
    let s = 7;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();
  const STARS = Array.from({ length: 90 }, () => [rand() * W, rand() * 640, rand() * 6.28, 2 + Math.floor(rand() * 2) * 2]);
  const HILLS = [0, 1].map((layer) =>
    Array.from({ length: W / 16 + 1 }, (_, i) => {
      const x = i * 16;
      const y =
        layer === 0
          ? 760 + 60 * Math.sin(x / 260 + 1) + 30 * Math.sin(x / 97)
          : 850 + 40 * Math.sin(x / 180 + 3) + 18 * Math.sin(x / 61);
      return Math.round(y / 8) * 8;
    }),
  );
  const CLOUDS = Array.from({ length: 6 }, (_, i) => ({ x: i * 380 + rand() * 120, y: 120 + rand() * 380, w: 5 + Math.floor(rand() * 5), k: 1 + (i % 2) }));

  function blockDisc(g, cx, cy, r, color, step = 8) {
    g.fillStyle = color;
    for (let y = -r; y < r; y += step) {
      const half = Math.floor(Math.sqrt(Math.max(0, r * r - (y + step / 2) ** 2)) / step) * step;
      g.fillRect(cx - half, cy + y, half * 2, step);
    }
  }

  function drawWallpaper(g, t) {
    const p = (t / DUR) % 1;
    const [top, bot] = skyAt(p);
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, css(top));
    grad.addColorStop(0.75, css(bot));
    grad.addColorStop(1, css(bot));
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    const night = clamp(1 - Math.abs(p - 0.87) / 0.1);
    if (night > 0)
      for (const [x, y, ph, sz] of STARS) {
        g.globalAlpha = night * (0.5 + 0.5 * Math.sin(t * 3 + ph));
        g.fillStyle = "#fff8e7";
        g.fillRect(x, y, sz, sz);
      }
    g.globalAlpha = 1;
    // Sun rises at the start (and again just before the loop), moon at night.
    const ps = p > 0.9 ? p - 1 : p;
    const sunU = (ps + 0.04) / 0.82;
    if (sunU > 0 && sunU < 1) {
      const x = lerp(160, 1760, sunU), y = 800 - 620 * Math.sin(Math.PI * sunU);
      g.globalAlpha = 0.25;
      blockDisc(g, x, y, 92, "#fff1c9");
      g.globalAlpha = 1;
      blockDisc(g, x, y, 60, mix("#f7c86a", "#fff3d6", Math.sin(Math.PI * sunU)));
    }
    const moonU = prog(p, 0.78, 0.97);
    if (moonU > 0 && moonU < 1) {
      const x = lerp(1700, 300, moonU), y = 700 - 520 * Math.sin(Math.PI * moonU);
      blockDisc(g, x, y, 40, "#f1ede0");
      blockDisc(g, x + 18, y - 10, 34, css(rgbMix(top, bot, 0.25)));
    }
    for (const c of CLOUDS) {
      const span = W + 400;
      const x = ((c.x + (t / DUR) * span * c.k) % span) - 200;
      g.fillStyle = css(rgbMix([255, 255, 255], bot, 0.25 + 0.5 * night));
      g.globalAlpha = 0.8;
      const u = 16;
      g.fillRect(x, c.y, c.w * u * 2, u * 2);
      g.fillRect(x + u * 2, c.y - u, c.w * u, u);
      g.fillRect(x + u, c.y + u * 2, c.w * u * 2 - u * 2, u);
      g.globalAlpha = 1;
    }
    HILLS.forEach((hs, layer) => {
      g.fillStyle = css(rgbMix(layer ? "#2d3a36" : "#4b5c55", bot, layer ? 0.25 : 0.45).map((v) => v * (1 - 0.55 * night)));
      g.beginPath();
      g.moveTo(0, H);
      hs.forEach((y, i) => {
        g.lineTo(i * 16, y);
        g.lineTo(i * 16 + 16, y);
      });
      g.lineTo(W, H);
      g.fill();
    });
  }

  function drawMenuBar(g, t) {
    g.fillStyle = "rgba(250,249,245,0.82)";
    g.fillRect(0, 0, W, 34);
    g.fillStyle = K.ink;
    g.font = `600 19px ${UI}`;
    g.textBaseline = "middle";
    g.fillStyle = K.clawd;
    g.fillText("✻", 22, 18);
    g.fillStyle = K.ink;
    g.fillText("Clawd", 50, 18);
    g.font = `400 18px ${UI}`;
    ["文件", "编辑", "显示", "窗口", "帮助"].forEach((m, i) => g.fillText(m, 140 + i * 70, 18));
    const mins = Math.floor(((6 * 60 + (t / DUR) * 24 * 60) % (24 * 60)));
    const hh = String(Math.floor(mins / 60)).padStart(2, "0");
    const mm = String(mins % 60).padStart(2, "0");
    g.textAlign = "right";
    g.fillText(`${hh}:${mm}`, W - 24, 18);
    g.textAlign = "left";
  }

  function drawIcon(g, i, cx, cy, s) {
    const x = cx - s / 2, y = cy - s / 2;
    const colors = ["#2b2a27", K.agent[0], K.agent[1], K.agent[2], K.agent[3], "#3d3d3a"];
    g.fillStyle = colors[i];
    roundRect(g, x, y, s, s, 12);
    g.fill();
    g.fillStyle = "#faf9f5";
    g.strokeStyle = "#faf9f5";
    g.lineWidth = 4;
    const u = s / 8;
    if (i === 0) {
      g.font = `700 ${s * 0.42}px ${MONO}`;
      g.textBaseline = "middle";
      g.fillStyle = K.clawd;
      g.fillText(">_", x + u * 1.3, cy + 1);
    } else if (i === 1) {
      g.fillRect(cx - u * 1.5, cy - u * 1.5, u * 3, u * 3);
      g.globalAlpha = 0.6;
      g.fillRect(cx - u * 0.5, cy - u * 2.5, u * 3, u);
      g.fillRect(cx + u * 1.5, cy - u * 1.5, u, u * 3);
      g.globalAlpha = 1;
    } else if (i === 2) {
      g.font = `700 ${s * 0.5}px ${MONO}`;
      g.textBaseline = "middle";
      g.fillText("{}", x + u * 1.6, cy + 2);
    } else if (i === 3) {
      g.fillRect(cx - u * 1.2, cy + u * 0.6, u * 1.6, u * 1.2);
      g.fillRect(cx + u * 0.2, cy - u * 2.2, u * 0.5, u * 3.4);
      g.fillRect(cx + u * 0.2, cy - u * 2.2, u * 1.8, u * 0.6);
    } else if (i === 4) {
      g.fillRect(x + u * 1.5, y + u * 2, u * 5, u * 4);
      g.fillStyle = colors[4];
      for (let k = 0; k < 4; k++) {
        g.fillRect(x + u * 1.8 + k * u * 1.3, y + u * 2.3, u * 0.6, u * 0.5);
        g.fillRect(x + u * 1.8 + k * u * 1.3, y + u * 5.2, u * 0.6, u * 0.5);
      }
    } else {
      g.beginPath();
      g.moveTo(cx - u * 1.2, cy - u * 1.8);
      g.lineTo(cx + u * 1.8, cy);
      g.lineTo(cx - u * 1.2, cy + u * 1.8);
      g.fill();
    }
  }

  function drawDock(g, t) {
    g.fillStyle = "rgba(250,249,245,0.55)";
    roundRect(g, DOCK.x, DOCK.y, DOCK.w, DOCK.h, 22);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.7)";
    g.lineWidth = 2;
    g.stroke();
    const running = [
      t > C.termOpen && t < C.split + 0.4,
      t > C.split && t < C.editor + 0.6,
      t > C.split && t < C.editor + 0.6,
      t > C.split && t < C.editor + 0.6,
      t > C.split && t < C.render + 1,
      t > C.coasterEnd + 0.8 && t < C.close + 0.8,
    ];
    for (let i = 0; i < 6; i++) {
      let bob = 0;
      if (i === 0) bob = 18 * Math.max(0, Math.sin(Math.PI * prog(t, C.termClick, C.termClick + 0.45)));
      drawIcon(g, i, ICON_X(i), DOCK.y + 38 - bob, 60);
      if (running[i]) {
        g.fillStyle = K.ink;
        g.fillRect(ICON_X(i) - 3, DOCK.y + 72, 6, 4);
      }
    }
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
  }

  /** A window opened `u` of the way (0 closed, 1 open), growing out of `from`. */
  function withWindow(g, rect, u, from, opts, body) {
    if (u <= 0.001) return;
    const e = opts.easing ? opts.easing(u) : back(u);
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    g.save();
    g.translate(lerp(from.x, cx, clamp(e, 0, 1.2)), lerp(from.y, cy, clamp(e, 0, 1.2)));
    g.scale(lerp(0.08, 1, e), lerp(0.08, 1, e));
    g.translate(-cx, -cy);
    g.globalAlpha *= clamp(u * 3);
    // Shadow, frame, title bar.
    g.fillStyle = "rgba(20,20,19,0.18)";
    roundRect(g, rect.x + 6, rect.y + 10, rect.w, rect.h, 14);
    g.fill();
    g.fillStyle = opts.dark ? K.term : K.ivory;
    roundRect(g, rect.x, rect.y, rect.w, rect.h, 14);
    g.fill();
    g.strokeStyle = opts.dark ? "#3a3936" : K.line;
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = opts.dark ? "#2a2927" : K.paper;
    g.save();
    roundRect(g, rect.x, rect.y, rect.w, rect.h, 14);
    g.clip();
    g.fillRect(rect.x, rect.y, rect.w, 36);
    if (opts.accent) {
      g.fillStyle = opts.accent;
      g.fillRect(rect.x, rect.y + 33, rect.w * (opts.progress ?? 1), 3);
    }
    g.restore();
    ["#e7826b", "#e9c46a", "#8fbf7a"].forEach((c, i) => {
      g.fillStyle = opts.dark ? "#55534e" : c;
      g.beginPath();
      g.arc(rect.x + 22 + i * 22, rect.y + 18, 7, 0, 7);
      g.fill();
    });
    g.fillStyle = opts.dark ? "#b9b6aa" : K.slate;
    g.font = `500 18px ${UI}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(opts.title, rect.x + rect.w / 2, rect.y + 19);
    g.textAlign = "left";
    if (opts.status) {
      g.textAlign = "right";
      g.fillStyle = opts.statusColor ?? K.slate;
      g.fillText(opts.status, rect.x + rect.w - 18, rect.y + 19);
      g.textAlign = "left";
    }
    g.save();
    g.beginPath();
    g.rect(rect.x, rect.y + 36, rect.w, rect.h - 36);
    g.clip();
    body(g);
    g.restore();
    g.restore();
  }

  // ---- terminal ---------------------------------------------------------------------
  function drawTerminal(g, t) {
    const open = prog(t, C.termOpen, C.termOpen + 0.5);
    const close = prog(t, C.split, C.split + 0.4);
    const u = open * (1 - close);
    const icon = { x: ICON_X(0), y: DOCK.y + 38 };
    withWindow(g, TERM, u, icon, { dark: true, title: "clawd — ~/films/self-portrait", easing: close > 0 ? inOut : back }, (g) => {
      const x = TERM.x + 40;
      g.textBaseline = "alphabetic";
      // Welcome box.
      g.strokeStyle = K.clawd;
      g.lineWidth = 2;
      roundRect(g, x, TERM.y + 66, 560, 120, 10);
      g.stroke();
      g.fillStyle = K.clawd;
      g.font = `600 26px ${UI}`;
      g.fillText("✻ Welcome to Claude Code", x + 24, TERM.y + 110);
      g.fillStyle = "#9c998e";
      g.font = `400 20px ${UI}`;
      g.fillText("cwd: ~/films/self-portrait", x + 24, TERM.y + 152);
      // Response, streamed after Enter.
      const lines = [
        ["⏺ ", "#d97757", "好。主角是我自己，那就让我自己来拍。"],
        ["⏺ ", "#d97757", "我把自己分成 4 个，一起开工："],
        ["  ⎿ ", "#77736a", "Task(建模) · Task(写代码) · Task(配乐) · Task(剪辑)"],
      ];
      const shown = (t - C.enter - 0.1) * 40;
      let used = 0;
      g.font = `400 24px ${UI}`;
      lines.forEach(([lead, col, text], i) => {
        const n = clamp(Math.floor(shown - used), 0, text.length);
        used += text.length + 4;
        if (shown < used - text.length - 4) return;
        const y = TERM.y + 248 + i * 42;
        g.fillStyle = col;
        g.fillText(lead, x, y);
        g.fillStyle = i === 2 ? "#a9a596" : "#ece9df";
        g.fillText(text.slice(0, n), x + g.measureText(lead).width, y);
      });
      // Input box: typed one character per Clawd stomp.
      g.strokeStyle = "#5c5a54";
      g.lineWidth = 2;
      roundRect(g, x, INPUT_TOP, TERM.w - 80, 70, 10);
      g.stroke();
      g.fillStyle = "#9c998e";
      g.font = `600 30px ${MONO}`;
      g.fillText(">", x + 22, INPUT_TOP + 46);
      g.font = `500 40px ${CJK}`;
      const sent = t >= C.enter;
      PROMPT.forEach((ch, i) => {
        const at = C.typeStart + i * C.typeStep;
        if (t < at) return;
        const pop = 1 + 0.35 * (1 - out3(prog(t, at, at + 0.15)));
        g.save();
        g.translate(charX(i), INPUT_TOP + 36);
        g.scale(pop, pop);
        g.fillStyle = sent ? "#77736a" : "#f4f1e8";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(ch, 0, 2);
        g.restore();
      });
      g.textAlign = "left";
      if (!sent && t > C.termOpen + 0.5) {
        const n = PROMPT.filter((_, i) => t >= C.typeStart + i * C.typeStep).length;
        if (Math.floor(t * 2.5) % 2 === 0) {
          g.fillStyle = K.clawd;
          g.fillRect(charX(n) - 23 + 4, INPUT_TOP + 16, 4, 40);
        }
      }
      // Enter key glyph Clawd stomps.
      const press = t >= C.enter && t < C.enter + 0.2 ? 4 : 0;
      g.fillStyle = t >= C.enter ? K.clawd : "#3a3936";
      roundRect(g, ENTER_X - 34, INPUT_TOP + 12 + press, 68, 46, 8);
      g.fill();
      g.fillStyle = "#f4f1e8";
      g.font = `600 28px ${UI}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("⏎", ENTER_X, INPUT_TOP + 36 + press);
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
    });
  }

  // ---- the four windows ---------------------------------------------------------------
  const VOX = (() => {
    const s = SPR.Walking;
    const f = D.sprites.Walking;
    const list = [];
    const solid = new Set();
    const pal = f.palette;
    const pix = Array.from(f.base, (c) => (c === "." ? 255 : parseInt(c, 36)));
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const c = pix[y * f.w + x];
        if (c === 255) continue;
        const dark = pal[c].toLowerCase() === "#141413";
        for (let z = 0; z < 5; z++) {
          if (dark && z > 0) {
            list.push({ x, y, z, c: pal[1] ?? K.clawd });
          } else list.push({ x, y, z, c: pal[c] });
          solid.add(`${x},${y},${z}`);
        }
      }
    for (const v of list) {
      v.x -= s.w / 2;
      v.y -= s.h / 2;
      v.z -= 2;
    }
    return { list, solid, faces: 0 };
  })();

  function drawVoxels(g, t, cx, cy, size, build) {
    const th = (t - C.split) * 0.9 + 0.6;
    const pitch = -0.42;
    const cs = Math.cos(th), sn = Math.sin(th), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const proj = (x, y, z) => {
      const X = x * cs + z * sn, Z = -x * sn + z * cs;
      const Y = y * cp - Z * sp, ZZ = y * sp + Z * cp;
      return [cx + X * size, cy + Y * size, ZZ];
    };
    // Floor grid.
    g.strokeStyle = "rgba(106,155,204,0.35)";
    g.lineWidth = 1.5;
    for (let i = -8; i <= 8; i += 2) {
      const a = proj(i * 1.5, 8, -12), b = proj(i * 1.5, 8, 12);
      const c2 = proj(-12, 8, i * 1.5), d = proj(12, 8, i * 1.5);
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.moveTo(c2[0], c2[1]);
      g.lineTo(d[0], d[1]);
      g.stroke();
    }
    const faces = [];
    const F = [
      [0, 0, -1, [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], 1.0],
      [0, 0, 1, [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], 0.7],
      [-1, 0, 0, [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], 0.82],
      [1, 0, 0, [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]], 0.82],
      [0, -1, 0, [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], 1.12],
    ];
    const rows = VOX.list.length;
    VOX.list.forEach((v, n) => {
      const order = 1 - (v.y + 8) / 16; // bottom rows first
      const appear = clamp((build - order * 0.85) / 0.15);
      if (appear <= 0) return;
      const drop = (1 - out3(appear)) * -14;
      for (const [nx, ny, nz, quad, shade] of F) {
        const key = `${v.x + 12 + nx},${v.y + 8 + ny},${v.z + 2 + nz}`;
        if (VOX.solid.has(key)) continue;
        const pts = quad.map(([a, b, c]) => proj(v.x + a, v.y + b + drop, v.z + c));
        // Back-face cull: keep faces whose normal points at the viewer.
        const nzv = -nx * sn * cp + ny * sp + nz * cs * cp;
        if (nzv > -0.02) continue;
        const depth = pts.reduce((s, p) => s + p[2], 0);
        faces.push([depth, pts, v.c, shade]);
      }
    });
    faces.sort((a, b) => b[0] - a[0]);
    for (const [, pts, c, shade] of faces) {
      const [r, gg, b] = hex(c);
      g.fillStyle = `rgb(${r * shade},${gg * shade},${b * shade})`;
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 4; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath();
      g.fill();
    }
    VOX.faces = faces.length;
    return rows;
  }

  // Code: this very file, typed in.
  const CODE_LINES = D.code.split("\n");
  function drawCode(g, t, rect, chars) {
    let left = chars, end = 0;
    for (; end < CODE_LINES.length && left > CODE_LINES[end].length; end++) left -= CODE_LINES[end].length + 1;
    const rows = 16;
    const first = Math.max(0, end - rows + 1);
    g.font = `400 17px ${MONO}`;
    g.textBaseline = "alphabetic";
    for (let r = 0; first + r <= end && r < rows; r++) {
      const n = first + r;
      let text = CODE_LINES[n] ?? "";
      if (n === end) text = text.slice(0, Math.max(0, left));
      text = text.slice(0, 64);
      const y = rect.y + 30 + r * 23;
      g.fillStyle = K.mid;
      g.textAlign = "right";
      g.fillText(String(n + 1), rect.x + 34, y);
      g.textAlign = "left";
      const x0 = rect.x + 48;
      const trimmed = text.trimStart();
      if (trimmed.startsWith("//")) {
        g.fillStyle = "#8f8b7e";
        g.fillText(text, x0, y);
        continue;
      }
      // Cheap highlighting: keywords, strings, numbers.
      const parts = [];
      let last = 0;
      const re = /(\b(?:const|let|function|return|if|else|for|of|new|while)\b)|("[^"]*"|'[^']*'|`[^`]*`)|(\b\d+(?:\.\d+)?\b)/g;
      let m;
      while ((m = re.exec(text))) {
        if (m.index > last) parts.push([text.slice(last, m.index), K.slate]);
        parts.push([m[0], m[1] ? "#c4613f" : m[2] ? "#5e7a3c" : "#4f7fb0"]);
        last = m.index + m[0].length;
      }
      parts.push([text.slice(last), K.slate]);
      let x = x0;
      for (const [s, col] of parts) {
        g.fillStyle = col;
        g.fillText(s, x, y);
        x += g.measureText(s).width;
      }
      if (n === end && Math.floor(t * 4) % 2 === 0) {
        g.fillStyle = K.agent[1];
        g.fillRect(x + 1, y - 16, 9, 19);
      }
    }
  }

  const NOTE_COL = { lead: K.agent[3], bass: "#3d3d3a", arp: K.agent[0], bell: K.agent[2] };
  function drawPianoRoll(g, t, rect, before = 2, after = 4) {
    g.fillStyle = "#f4f2ec";
    g.fillRect(rect.x, rect.y, rect.w, rect.h);
    const lo = 28, hi = 100;
    const y = (m) => rect.y + rect.h - ((m - lo) / (hi - lo)) * rect.h;
    for (let m = lo; m <= hi; m++)
      if ([1, 3, 6, 8, 10].includes(m % 12)) {
        g.fillStyle = "rgba(61,61,58,0.05)";
        g.fillRect(rect.x, y(m + 1), rect.w, rect.h / (hi - lo));
      }
    const t0 = t - before, t1 = t + after;
    const X = (s) => rect.x + ((s - t0) / (t1 - t0)) * rect.w;
    for (let b = Math.ceil(t0 * 2); b <= t1 * 2; b++) {
      g.fillStyle = b % 4 ? "rgba(61,61,58,0.07)" : "rgba(61,61,58,0.18)";
      g.fillRect(X(b / 2), rect.y, 1.5, rect.h);
    }
    for (const n of S.notes) {
      if (n.t > t1) break;
      if (n.t + n.d < t0) continue;
      const on = t >= n.t && t < n.t + Math.max(n.d, 0.12);
      g.fillStyle = NOTE_COL[n.i];
      g.globalAlpha = on ? 1 : 0.55;
      const h = Math.max(5, rect.h / (hi - lo));
      g.fillRect(X(n.t), y(n.m) - h / 2 - (on ? 2 : 0), Math.max(5, (n.d / (t1 - t0)) * rect.w - 1), h + (on ? 4 : 0));
    }
    g.globalAlpha = 1;
    g.fillStyle = K.clawd;
    g.fillRect(X(t) - 1.5, rect.y, 3, rect.h);
  }

  function drawWaveform(g, x0, x1, cy, amp, t0, t1, now, colA, colB) {
    for (let x = x0; x < x1; x += 3) {
      const s0 = lerp(t0, t1, (x - x0) / (x1 - x0)), s1 = lerp(t0, t1, (x + 3 - x0) / (x1 - x0));
      let lo = 0, hi = 0;
      for (let s = s0; s < s1; s += 1 / S.peakRate) {
        const [a, b] = peakAt(Math.max(0, s));
        lo = Math.min(lo, a);
        hi = Math.max(hi, b);
      }
      g.fillStyle = s0 < now ? colA : colB;
      g.fillRect(x, cy - (hi / 127) * amp, 2, Math.max(2, ((hi - lo) / 127) * amp));
    }
  }

  function drawAgentWindows(g, t) {
    const open = prog(t, C.split, C.split + 0.45);
    if (open <= 0 || t > C.editor + 0.8) return;
    const coll = prog(t, C.editor, C.editor + 0.45);
    WINS.forEach((rect, k) => {
      const done = t >= C.done[k];
      const p = clamp((t - C.split - 0.6) / (C.done[k] - C.split - 0.6));
      const status = done ? "✓ 完成" : `${Math.floor(p * 100)}%`;
      let r = rect;
      if (k < 3 && coll > 0) {
        const tile = TILE(k), e = inOut(coll);
        r = { x: lerp(rect.x, tile.x, e), y: lerp(rect.y, tile.y, e), w: lerp(rect.w, tile.w, e), h: lerp(rect.h, tile.h + 36, e) };
        if (coll >= 1) return;
      }
      if (k === 3 && coll > 0) return; // becomes the editor
      const body = (g) => {
        if (k === 0) {
          const build = prog(t, C.split + 0.8, C.done[0] - 1.5);
          g.fillStyle = "#f4f2ec";
          g.fillRect(r.x, r.y + 36, r.w, r.h - 36);
          drawVoxels(g, t, r.x + r.w * 0.6, r.y + r.h * 0.52, 16 * (r.w / rect.w), build);
          g.fillStyle = K.slate;
          g.font = `400 16px ${MONO}`;
          g.fillText(`voxels ${Math.round(VOX.list.length * build)}  faces ${VOX.faces}`, r.x + 260, r.y + r.h - 18);
        } else if (k === 1) {
          drawCode(g, t, { x: r.x + 180, y: r.y + 40 }, Math.max(0, (t - C.split - 0.8) * 150));
        } else if (k === 2) {
          drawPianoRoll(g, t, { x: r.x + 240, y: r.y + 56, w: r.w - 260, h: r.h - 76 });
        } else {
          const reveal = prog(t, C.split + 1, C.done[2]);
          const x0 = r.x + 200, x1 = r.x + r.w - 20;
          g.fillStyle = "#f4f2ec";
          g.fillRect(x0, r.y + 56, x1 - x0, 140);
          drawWaveform(g, x0, lerp(x0, x1, reveal), r.y + 126, 60, 0, DUR, t, K.agent[3], K.mid);
          ["V1 建模", "V2 代码", "A1 配乐"].forEach((name, i) => {
            const y = r.y + 216 + i * 62;
            g.fillStyle = "#ece9e0";
            g.fillRect(x0, y, x1 - x0, 50);
            g.fillStyle = K.mid;
            g.font = `500 16px ${UI}`;
            g.fillText(name, x0 + 10, y + 30);
            if (t >= C.done[i]) {
              g.fillStyle = K.agent[i];
              g.globalAlpha = 0.25;
              g.fillRect(x0 + 90, y + 6, (x1 - x0 - 100) * out3(prog(t, C.done[i], C.done[i] + 0.4)), 38);
              g.globalAlpha = 1;
            }
          });
        }
        if (k < 3 && coll > 0) {
          g.fillStyle = `rgba(250,249,245,${coll})`;
          g.fillRect(r.x, r.y, r.w, r.h);
        }
      };
      withWindow(g, r, open, { x: SPLIT_FROM.x, y: SPLIT_FROM.y }, {
        title: WIN_TITLE[k],
        accent: K.agent[k],
        progress: p,
        status: coll > 0.3 ? "" : status,
        statusColor: done ? K.agent[k] : K.mid,
      }, body);
    });
  }

  // ---- editor ---------------------------------------------------------------------------
  function edRect(t) {
    const e = inOut(prog(t, C.editor, C.editor + 0.7));
    const a = WINS[3];
    return { x: lerp(a.x, ED.x, e), y: lerp(a.y, ED.y, e), w: lerp(a.w, ED.w, e), h: lerp(a.h, ED.h, e) };
  }
  const THUMB_T = Array.from({ length: 40 }, (_, k) => 0.4 + 0.8 * k);
  function drawEditor(g, t, thumbs) {
    if (t < C.editor || t > C.coasterStart + 0.6) return;
    const r = edRect(t);
    const fold = prog(t, C.render + 0.25, C.coasterStart + 0.5);
    const u = 1 - fold;
    const into = { x: TRACK.at(0).x, y: TRACK.at(0).y };
    const rr = fold > 0 ? r : r;
    withWindow(g, rr, u, into, { title: "剪辑 · 主角是我自己", accent: K.agent[3], easing: (x) => (fold > 0 ? inOut(x) : 1) }, (g) => {
      const fade = prog(t, C.editor + 0.15, C.editor + 0.45);
      g.globalAlpha *= fade;
      // Bin.
      g.fillStyle = K.mid;
      g.font = `500 17px ${UI}`;
      g.fillText("素材", 140, 132);
      for (let k = 0; k < 3; k++) {
        const tile = TILE(k);
        const carried = t >= C.drops[k] - 1.0;
        g.strokeStyle = K.line;
        g.setLineDash([6, 6]);
        g.lineWidth = 2;
        roundRect(g, tile.x, tile.y, tile.w, tile.h, 10);
        g.stroke();
        g.setLineDash([]);
        if (!carried) drawTile(g, k, tile.x, tile.y, 1);
      }
      // Preview monitor: cuts to a new earlier frame on every stomped beat.
      g.fillStyle = "#1f1e1d";
      g.fillRect(PREVIEW.x, PREVIEW.y, PREVIEW.w, PREVIEW.h);
      const stomped = STOMPS.filter((o) => o <= t).length;
      if (stomped > 0 && thumbs) {
        const th = thumbs[(stomped * 3) % thumbs.length];
        g.imageSmoothingEnabled = true;
        g.drawImage(th, PREVIEW.x + 6, PREVIEW.y + 6, PREVIEW.w - 12, PREVIEW.h - 12);
        g.imageSmoothingEnabled = false;
      } else {
        g.fillStyle = "#77736a";
        g.font = `500 20px ${UI}`;
        g.textAlign = "center";
        g.fillText("预览", PREVIEW.x + PREVIEW.w / 2, PREVIEW.y + PREVIEW.h / 2);
        g.textAlign = "left";
      }
      // Info.
      g.fillStyle = K.slate;
      g.font = `500 22px ${UI}`;
      g.fillText(`节拍点  ${String(stomped).padStart(2, "0")} / ${STOMPS.length}`, 1040, 170);
      g.fillStyle = K.mid;
      g.font = `400 18px ${UI}`;
      g.fillText("从 score.wav 的低频能量里检测", 1040, 204);
      g.fillText(`${TL.bpm} BPM · 播放头 ${t.toFixed(2)} s`, 1040, 236);
      g.fillText("拖入素材 → 对齐到节拍 → 渲染", 1040, 268);
      // Render button.
      const pressed = t >= C.render;
      const press = pressed ? 10 * (1 - out3(prog(t, C.render, C.render + 0.5))) + 4 : 0;
      g.fillStyle = "#a9533a";
      roundRect(g, BTN.x, BTN.y + 10, BTN.w, BTN.h, 18);
      g.fill();
      g.fillStyle = pressed ? "#e88b6c" : K.clawd;
      roundRect(g, BTN.x, BTN.y + press, BTN.w, BTN.h, 18);
      g.fill();
      g.fillStyle = "#fff";
      g.font = `700 40px ${CJK}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(pressed ? "渲染中…" : "渲染 ▶", BTN.x + BTN.w / 2, BTN.y + BTN.h / 2 + press + 2);
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
      // Waveform: the real mix, 24.6 s to 31.4 s.
      g.fillStyle = "#f4f2ec";
      g.fillRect(WAVE.x0 - 10, WAVE.cy - WAVE.amp - 30, WAVE.x1 - WAVE.x0 + 20, WAVE.amp * 2 + 40);
      for (let s = Math.ceil(WAVE.t0 * 2) / 2; s <= WAVE.t1; s += 0.5) {
        g.fillStyle = "rgba(61,61,58,0.1)";
        g.fillRect(WX(s), WAVE.cy - WAVE.amp - 30, 1, 10);
      }
      drawWaveform(g, WAVE.x0, WAVE.x1, WAVE.cy, WAVE.amp, WAVE.t0, WAVE.t1, t, "#cf7a5c", "#b9b6aa");
      // Lanes.
      LANE_Y.forEach((y, k) => {
        g.fillStyle = "#ece9e0";
        g.fillRect(WAVE.x0, y, WAVE.x1 - WAVE.x0, LANE_H);
        g.fillStyle = K.mid;
        g.font = `500 16px ${UI}`;
        g.fillText(LANE_NAME[k], WAVE.x0 + 10, y + 34);
        const dropped = t >= C.drops[k];
        if (dropped) {
          const marks = STOMPS.filter((o) => o <= t);
          const right = marks.length ? WX(marks[marks.length - 1]) : WX(STOMPS[0]);
          const left = WX(STOMPS[0]);
          const snap = out3(prog(t, C.drops[k], C.drops[k] + 0.25));
          const x0 = lerp(300 + 180 * k - 80, left, snap);
          const x1 = Math.max(x0 + 40, lerp(300 + 180 * k + 80, right, snap));
          g.fillStyle = K.agent[k];
          roundRect(g, x0, y + 5, x1 - x0, LANE_H - 10, 6);
          g.fill();
          // Cuts at every beat marker.
          g.fillStyle = "rgba(255,255,255,0.55)";
          for (const o of marks) if (WX(o) > x0 + 4 && WX(o) < x1 - 2) g.fillRect(WX(o) - 1, y + 5, 2, LANE_H - 10);
          g.fillStyle = "#fff";
          g.font = `600 15px ${MONO}`;
          if (x1 - x0 > 120) g.fillText(TILE_NAME[k], x0 + 10, y + 34);
        }
      });
      // Beat markers stomped so far.
      for (const o of STOMPS) {
        if (o > t) break;
        const x = WX(o);
        const pop = 1 + 0.8 * (1 - out3(prog(t, o, o + 0.2)));
        g.fillStyle = K.clawd;
        g.globalAlpha *= 0.9;
        g.fillRect(x - 1, WAVE.cy - WAVE.amp - 18, 2, LANE_Y[2] + LANE_H - (WAVE.cy - WAVE.amp - 18));
        g.globalAlpha /= 0.9;
        g.save();
        g.translate(x, WAVE.cy - WAVE.amp - 24);
        g.rotate(Math.PI / 4);
        g.fillRect(-7 * pop, -7 * pop, 14 * pop, 14 * pop);
        g.restore();
      }
      // Playhead.
      if (t >= WAVE.t0 && t <= WAVE.t1) {
        g.fillStyle = K.ink;
        g.fillRect(WX(t) - 1, WAVE.cy - WAVE.amp - 30, 2, LANE_Y[2] + LANE_H - (WAVE.cy - WAVE.amp - 30));
      }
    });
  }

  function drawTile(g, k, x, y, s = 1) {
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.fillStyle = K.agent[k];
    roundRect(g, 0, 0, 330, 70, 10);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.font = `600 20px ${MONO}`;
    g.textBaseline = "middle";
    g.fillText(TILE_NAME[k], 84, 36);
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(10, 10, 60, 50);
    g.fillStyle = "#fff";
    if (k === 0) drawClawd(g, { x: 40, y: 52, P: 1.8, name: "Walking", i: 0 });
    if (k === 1) {
      g.font = `700 24px ${MONO}`;
      g.fillText("{}", 22, 36);
    }
    if (k === 2) for (let i = 0; i < 8; i++) g.fillRect(16 + i * 6, 35 - 12 * Math.abs(Math.sin(i * 1.7)), 3, 24 * Math.abs(Math.sin(i * 1.7)) + 2);
    g.textBaseline = "alphabetic";
    g.restore();
  }

  // ---- coaster ------------------------------------------------------------------------
  function drawCoaster(g, t, thumbs) {
    if (t < C.render + 0.3 || t > FILE_FORM + 0.1) return;
    const head = headAt(t);
    const tail = tailAt(t);
    // Supports under the track.
    g.strokeStyle = "rgba(61,61,58,0.35)";
    g.lineWidth = 6;
    for (let s = CELL * 3; s < head; s += CELL * 4) {
      if (s < tail) continue;
      const p = TRACK.at(s);
      if (p.y > 820 || (p.x > 1150 && p.x < 1700 && p.y > 380)) continue;
      g.beginPath();
      g.moveTo(p.x, p.y + STRIP / 2);
      g.lineTo(p.x, DOCK_TOP + 40);
      g.stroke();
    }
    // Film cells, each an earlier frame of this film.
    for (let i = 0, s = 0; s < head; i++, s += CELL) {
      const mid = s + CELL / 2;
      if (mid < tail) continue;
      const p = TRACK.at(mid);
      const born = clamp((head - s) / 160);
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.a);
      g.scale(lerp(0.4, 1, out3(born)), lerp(0.4, 1, out3(born)));
      g.fillStyle = "#24221f";
      g.fillRect(-CELL / 2 - 0.5, -STRIP / 2, CELL + 1, STRIP);
      g.fillStyle = "#f0eee6";
      for (let h = 0; h < 4; h++) {
        g.fillRect(-CELL / 2 + 6 + h * 20, -STRIP / 2 + 3, 9, 5);
        g.fillRect(-CELL / 2 + 6 + h * 20, STRIP / 2 - 8, 9, 5);
      }
      if (thumbs) {
        g.imageSmoothingEnabled = true;
        g.drawImage(thumbs[i % thumbs.length], -CELL / 2 + 4, -STRIP / 2 + 11, CELL - 8, STRIP - 22);
        g.imageSmoothingEnabled = false;
      }
      if (born < 1) {
        g.fillStyle = `rgba(255,255,255,${1 - born})`;
        g.fillRect(-CELL / 2, -STRIP / 2, CELL, STRIP);
      }
      g.restore();
    }
    // The cart.
    if (t >= C.coasterStart - 0.6 && t < C.coasterEnd + 0.8) {
      const c = cartPose(t);
      const fade = 1 - prog(t, C.coasterEnd + 0.3, C.coasterEnd + 0.8);
      g.save();
      g.globalAlpha *= fade;
      g.translate(c.x, c.y);
      g.rotate(c.a);
      g.fillStyle = "#3d3d3a";
      roundRect(g, -150, -6, 300, 30, 10);
      g.fill();
      g.fillStyle = K.clawd;
      g.fillRect(-150, 4, 300, 6);
      g.fillStyle = "#24221f";
      for (const wx of [-110, 110]) {
        g.beginPath();
        g.arc(wx, 22, 9, 0, 7);
        g.fill();
      }
      g.restore();
    }
    // Render counter.
    const frames = Math.min(TL.duration * TL.fps, Math.round((head / TRACK.L) * TL.duration * TL.fps));
    const a = clamp(prog(t, C.render + 0.4, C.render + 0.8) - prog(t, C.coasterEnd + 0.4, C.coasterEnd + 0.9));
    if (a > 0) {
      g.save();
      g.globalAlpha *= a;
      g.fillStyle = "rgba(31,30,29,0.88)";
      roundRect(g, 760, 52, 400, 54, 27);
      g.fill();
      g.fillStyle = K.clawd;
      g.fillRect(780, 96, 360 * (frames / (TL.duration * TL.fps)), 4);
      g.fillStyle = "#f4f1e8";
      g.font = `600 24px ${UI}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const n = String(frames).padStart(4, "0");
      g.fillText(frames >= TL.duration * TL.fps ? `✓ 渲染完成 ${n} 帧` : `渲染中  ${n} / ${TL.duration * TL.fps} 帧`, 960, 78);
      g.restore();
    }
  }

  function drawFile(g, t) {
    if (t < C.coasterEnd + 0.5 || t >= C.fileDrop + 0.35) return;
    const p = filePos(t);
    const appear = out3(prog(t, C.coasterEnd + 0.5, FILE_FORM));
    const sink = 1 - inOut(prog(t, C.fileDrop, C.fileDrop + 0.35));
    const s = appear * sink;
    g.save();
    g.translate(p.x, p.y);
    g.scale(s, s);
    g.rotate(0.05 * Math.sin(t * 6));
    g.fillStyle = "#24221f";
    roundRect(g, -110, -40, 220, 80, 12);
    g.fill();
    g.fillStyle = "#f0eee6";
    for (let h = 0; h < 9; h++) {
      g.fillRect(-100 + h * 23, -36, 10, 6);
      g.fillRect(-100 + h * 23, 30, 10, 6);
    }
    g.fillStyle = K.clawd;
    g.font = `700 22px ${CJK}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("主角是我自己.mp4", 0, 1);
    g.textAlign = "left";
    g.restore();
  }

  // ---- player and the frame inside the frame ----------------------------------------------
  function playerRect(t) {
    const u = inOut(prog(t, C.merge + 0.3, C.titleStart + 0.2));
    return { x: lerp(P1.x, P2.x, u), y: lerp(P1.y, P2.y, u), w: lerp(P1.w, P2.w, u), h: lerp(P1.h, P2.h, u) };
  }
  function drawPlayer(g, t, env) {
    const open = prog(t, FILE_FORM - 0.2, FILE_FORM + 0.4);
    const close = prog(t, C.close, C.close + 0.7);
    const u = open * (1 - close);
    if (u <= 0) return;
    const pr = playerRect(t);
    const scr = screenOf(pr);
    const icon = { x: ICON_X(5), y: DOCK.y + 38 };
    const time = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
    withWindow(g, pr, u, close > 0 ? icon : FILE_END(), {
      title: "播放器 · 主角是我自己.mp4",
      accent: K.clawd,
      progress: t / DUR,
      status: `${time} / 01:04`,
      statusColor: K.slate,
      easing: close > 0 ? inOut : back,
    }, (g) => {
      g.fillStyle = "#1f1e1d";
      g.fillRect(pr.x, pr.y + 36, pr.w, pr.h - 36);
      const on = prog(t, C.fileDrop, C.fileDrop + 0.3);
      if (on > 0) {
        const depthOK = env.depth < 14 && env.scale * scr.w > 2;
        g.save();
        g.beginPath();
        g.rect(scr.x, scr.y, scr.w, scr.h);
        g.clip();
        if (depthOK) {
          g.translate(scr.x, scr.y);
          g.scale(scr.w / W, scr.h / H);
          drawScene(g, t, { ...env, depth: env.depth + 1, scale: (env.scale * scr.w) / W });
        }
        g.restore();
        if (on < 1) {
          g.fillStyle = `rgba(255,255,255,${1 - on})`;
          g.fillRect(scr.x, scr.y, scr.w, scr.h);
        }
      } else {
        g.fillStyle = "#77736a";
        g.font = `500 26px ${UI}`;
        g.textAlign = "center";
        g.fillText("把成片拖到这里", scr.x + scr.w / 2, scr.y + scr.h / 2);
        g.textAlign = "left";
      }
    });
  }

  // ---- title -------------------------------------------------------------------------
  function fmtClock(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m ? `${m} 分 ${String(s).padStart(2, "0")} 秒` : `${s} 秒`;
  }
  function drawTitle(g, t, env) {
    if (t < C.titleStart - 0.05 || t > C.close + 1.4) return;
    const out = prog(t, C.close, C.close + 1.2);
    TITLE.forEach((ch, i) => {
      const at = C.titleStart + i * C.titleStep;
      if (t < at) return;
      const pop = 1 + 0.4 * (1 - out3(prog(t, at, at + 0.18)));
      const fall = out * out * (500 + 80 * i);
      g.save();
      g.translate(TX(i), TTOP + 56 + fall);
      g.rotate(out * (i % 2 ? 0.5 : -0.4));
      g.scale(pop, 1 / pop);
      g.fillStyle = K.ink;
      g.font = `700 112px ${CJK}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(ch, 4, 6);
      g.fillStyle = "#faf9f5";
      g.fillText(ch, 0, 0);
      g.restore();
    });
    const a = clamp(prog(t, C.titleStart + 1.3, C.titleStart + 1.6) - out * 1.5);
    if (a <= 0) return;
    g.save();
    g.globalAlpha *= a;
    g.fillStyle = "rgba(31,30,29,0.82)";
    roundRect(g, 140, 446, 780, 404, 18);
    g.fill();
    g.fillStyle = K.clawd;
    g.font = `600 26px ${UI}`;
    g.fillText("一镜到底 · 64 秒 · Claude Code 自导自演", 172, 494);
    const st = D.stats;
    const lines = [
      `${st.frames} 帧 · ${st.fps} fps · 1 个镜头，0 次剪切`,
      `代码 ${st.codeLines} 行 · ${st.codeFiles} 个文件 · 0 张图片素材`,
      `配乐 ${st.notes} 个音符 · ${(st.samples / 1e6).toFixed(2)}M 个采样`,
      `波形里检测到 ${st.onsets} 个节拍点 · 踩了 ${STOMPS.length} 个`,
      `像素小人 ${st.spriteSets} 套动作 · ${st.spriteFrames} 帧`,
      `此刻屏幕里套了 ${env.levels} 层`,
      `渲染到这一帧用了 ${fmtClock(env.elapsed)}`,
    ];
    g.font = `400 23px ${UI}`;
    lines.forEach((line, i) => {
      const at = C.titleStart + 1.6 + i * 0.16;
      const n = Math.floor(clamp((t - at) / 0.3) * line.length);
      g.fillStyle = i >= 5 ? "#f2c4ae" : "#ece9df";
      g.fillText(line.slice(0, n), 172, 548 + i * 42);
    });
    g.restore();
  }

  // ---- bits ----------------------------------------------------------------------------
  function drawPointer(g, t) {
    const p = pointerPose(t);
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.rot);
    g.drawImage(arrowImg, -24, -38, 48, 76);
    g.restore();
    if (t > C.kick && t < C.kick + 0.3) burst(g, PTR_REST.x - 20, PTR_REST.y + 10, prog(t, C.kick, C.kick + 0.3), K.ivory, 8, 70);
    if (t > C.stick && t < C.stick + 0.35) burst(g, PTR_TIP_STUCK.x, PTR_TIP_STUCK.y + 4, prog(t, C.stick, C.stick + 0.35), K.clawd, 7, 50);
  }

  function burst(g, x, y, u, color, n, r) {
    g.save();
    g.globalAlpha *= 1 - u;
    g.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const d = r * out3(u);
      g.fillRect(x + Math.cos(a) * d - 5, y + Math.sin(a) * d - 5, 10, 10);
    }
    g.restore();
  }

  function ring(g, x, y, u, color, r = 60) {
    if (u <= 0 || u >= 1) return;
    g.save();
    g.globalAlpha *= 1 - u;
    g.strokeStyle = color;
    g.lineWidth = 6;
    g.beginPath();
    g.ellipse(x, y, r * out3(u), r * 0.35 * out3(u), 0, 0, 7);
    g.stroke();
    g.restore();
  }

  function drawActors(g, t) {
    const m = mainPose(t);
    if (!m.hidden) {
      if (m.cursor)
        for (let k = 3; k >= 1; k--) {
          const q = mainPose(t - k * 0.035);
          if (!q.hidden) drawClawd(g, { ...q, alpha: 0.12 * (4 - k) });
        }
      drawClawd(g, m);
      if (m.cursor && (t < C.grab || t > C.place)) {
        // Clawd is the cursor now: a little arrow badge rides on its shoulder.
        g.save();
        g.translate(m.x + 7 * m.P, m.y - 16 * m.P - 22);
        g.rotate(-0.15);
        g.globalAlpha *= 0.9;
        g.drawImage(arrowImg, 0, 0, 18, 28.5);
        g.restore();
      }
    }
    // Click feedback.
    ring(g, ICON_X(0), DOCK_TOP + 2, prog(t, C.termClick, C.termClick + 0.45), K.clawd, 80);
    ring(g, ENTER_X, INPUT_TOP + 2, prog(t, C.enter, C.enter + 0.45), K.clawd, 90);
    PROMPT.forEach((_, i) => {
      const at = C.typeStart + i * C.typeStep;
      ring(g, charX(i), INPUT_TOP + 2, prog(t, at, at + 0.3), K.clawd, 34);
    });
    // Split and merge sparks.
    if (t > C.split - 0.05 && t < C.split + 0.5) burst(g, SPLIT_FROM.x, SPLIT_FROM.y - 40, prog(t, C.split - 0.05, C.split + 0.5), K.clawd, 14, 180);
    if (t > C.merge - 0.05 && t < C.merge + 0.5) burst(g, 960, P1.y + P1.h - 40, prog(t, C.merge - 0.05, C.merge + 0.5), K.clawd, 14, 200);
    for (let k = 0; k < 4; k++) {
      const a = agentPose(k, t);
      if (a.hidden) continue;
      drawClawd(g, a);
      if (a.carry != null) drawTile(g, a.carry, a.x - 82, a.y - 4 * 16 - 50, 0.5);
      // Name tags while they work.
      const tag = clamp(prog(t, C.split + 0.6, C.split + 0.9) - prog(t, C.editor, C.editor + 0.3));
      if (tag > 0) {
        g.save();
        g.globalAlpha *= tag;
        g.font = `600 20px ${CJK}`;
        const label = TL.agents[k];
        const w = g.measureText(label).width + 20;
        g.fillStyle = K.agent[k];
        roundRect(g, a.x - w / 2, a.y - 100, w, 30, 15);
        g.fill();
        g.fillStyle = "#fff";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(label, a.x, a.y - 84);
        g.textAlign = "left";
        g.textBaseline = "alphabetic";
        g.restore();
      }
    }
    for (const o of STOMPS) ring(g, WX(o), waveTop(o) + 2, prog(t, o, o + 0.3), K.clawd, 46);
    ring(g, BTN.x + BTN.w / 2, BTN.y + 8, prog(t, C.render, C.render + 0.6), K.clawd, 200);
  }

  function drawFrontOfCart(g, t) {
    if (t < C.coasterStart - 0.6 || t > C.coasterEnd + 0.8) return;
    const c = cartPose(t);
    const fade = 1 - prog(t, C.coasterEnd + 0.3, C.coasterEnd + 0.8);
    g.save();
    g.globalAlpha *= fade;
    g.translate(c.x, c.y);
    g.rotate(c.a);
    g.fillStyle = "#3d3d3a";
    roundRect(g, -140, -26, 280, 26, 8);
    g.fill();
    g.fillStyle = K.clawd;
    g.font = `700 16px ${MONO}`;
    g.textBaseline = "middle";
    g.fillText("RENDER EXPRESS", -64, -13);
    g.restore();
  }

  // ---- the scene --------------------------------------------------------------------
  let THUMBS = null;
  function drawScene(g, t, env) {
    g.imageSmoothingEnabled = false;
    drawWallpaper(g, t);
    drawMenuBar(g, t);
    // The stuck pointer hangs from the menu bar; the free one is drawn with the actors.
    drawDock(g, t);
    drawTerminal(g, t);
    drawAgentWindows(g, t);
    drawEditor(g, t, env.thumbs);
    drawCoaster(g, t, env.thumbs);
    drawPlayer(g, t, env);
    drawTitle(g, t, env);
    drawPointer(g, t);
    drawActors(g, t);
    drawFrontOfCart(g, t);
    drawFile(g, t);
  }

  // ---- camera --------------------------------------------------------------------------
  const CAM = [
    [0, 960, 540, 1],
    [6.3, 960, 540, 1],
    [7.4, 960, 470, 1.32],
    [11.3, 960, 470, 1.32],
    [12.3, 960, 540, 1],
    [14.3, 960, 540, 1],
    [15.3, 520, 300, 1.7],
    [16.4, 520, 300, 1.7],
    [17.2, 1420, 300, 1.7],
    [18.3, 1420, 300, 1.7],
    [19.1, 520, 760, 1.7],
    [20.2, 520, 760, 1.7],
    [21.0, 960, 540, 1],
    [32.3, 960, 540, 1],
  ];
  function camAt(t) {
    if (t >= 32.3 && t < 45.0) {
      const k = clamp(prog(t, 32.3, 33.3) - prog(t, 43.6, 45.0));
      const c = cartPose(clamp(t, C.coasterStart, C.coasterEnd));
      const z = lerp(1, 1.28, smooth(k));
      return clampCam(lerp(960, lerp(960, c.x, 0.7), smooth(k)), lerp(540, lerp(540, c.y, 0.7), smooth(k)), z);
    }
    if (t >= 45) return { x: 960, y: 540, z: 1 };
    for (let i = 1; i < CAM.length; i++)
      if (t <= CAM[i][0]) {
        const u = inOut(prog(t, CAM[i - 1][0], CAM[i][0]));
        const z = Math.exp(lerp(Math.log(CAM[i - 1][3]), Math.log(CAM[i][3]), u));
        return clampCam(lerp(CAM[i - 1][1], CAM[i][1], u), lerp(CAM[i - 1][2], CAM[i][2], u), z);
      }
    return { x: 960, y: 540, z: 1 };
  }
  function clampCam(x, y, z) {
    const hw = W / 2 / z, hh = H / 2 / z;
    return { x: clamp(x, hw, W - hw), y: clamp(y, hh, H - hh), z };
  }

  // The push into the screen: one level is a zoom of 1 / (screen width / W)
  // about the point the screen map leaves where it is.
  const DROSTE_LEVELS = 4;
  function drosteAt(t) {
    const u = inOut(prog(t, C.pushStart, C.pushEnd));
    const scr = screenOf(P1);
    const s = scr.w / W;
    const fix = { x: scr.x / (1 - s), y: scr.y / (1 - s) };
    const z = u * DROSTE_LEVELS;
    return { k: Math.pow(1 / s, z - Math.floor(z)), fix };
  }

  function levelsAt(t, scale) {
    if (t < C.fileDrop || t > C.close + 0.7) return 0;
    const s = screenOf(playerRect(t)).w / W;
    let n = 0;
    for (let sc = scale; sc * s * W > 2 && n < 14; sc *= s) n++;
    return n;
  }

  async function prepare() {
    await Promise.all([
      document.fonts.load(`400 20px ${MONO}`),
      document.fonts.load(`700 40px ${CJK}`, "主角是我自己"),
    ]);
    // Film cells and the preview monitor show earlier moments of this film.
    const cv = document.createElement("canvas");
    cv.width = 240;
    cv.height = 135;
    THUMBS = THUMB_T.map((tt) => {
      const c = document.createElement("canvas");
      c.width = 240;
      c.height = 135;
      const g = c.getContext("2d");
      g.scale(240 / W, 135 / H);
      drawScene(g, tt, { depth: 0, scale: 240 / W, thumbs: null, levels: 0, elapsed: 0 });
      return c;
    });
  }

  function frame(g, t, elapsed = 0) {
    t = ((t % DUR) + DUR) % DUR;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const cam = camAt(t);
    g.translate(W / 2, H / 2);
    g.scale(cam.z, cam.z);
    g.translate(-cam.x, -cam.y);
    let scale = cam.z;
    if (t > C.pushStart && t < C.pushEnd) {
      const d = drosteAt(t);
      g.translate(d.fix.x, d.fix.y);
      g.scale(d.k, d.k);
      g.translate(-d.fix.x, -d.fix.y);
      scale *= d.k;
    }
    drawScene(g, t, { depth: 0, scale, thumbs: THUMBS, levels: levelsAt(t, 1), elapsed });
  }

  window.FILM = { W, H, DUR, fps: TL.fps, prepare, frame, loopTop: TRACK.loopTop };
})();
