import { useEffect, useRef, useState } from 'react';

// Background music: off until the visitor presses play. The file is only downloaded on the first
// press. It loops inside the decoded buffer between two sample-exact points (the file carries a
// second of periodic lead-in and lead-out), so there is no gap at the loop even though it is an MP3.
// Audio runs on the browser's audio thread and does not touch the map or the charts.

const VOL_KEY = 'kyoto-gis-music-volume';
const savedVolume = () => { try { const v = parseFloat(localStorage.getItem(VOL_KEY)); return v >= 0 && v <= 1 ? v : 0.5; } catch { return 0.5; } };

export default function MusicPlayer() {
  const au = useRef(null); // { ctx, gain, src }
  const [state, setState] = useState('idle'); // idle | loading | playing | paused | error
  const [vol, setVol] = useState(savedVolume);
  const base = import.meta.env.BASE_URL;

  useEffect(() => () => { au.current?.ctx.close(); }, []);
  useEffect(() => {
    // perceived loudness is closer to the square of the slider position
    if (au.current) au.current.gain.gain.setTargetAtTime(vol * vol, au.current.ctx.currentTime, 0.05);
    try { localStorage.setItem(VOL_KEY, String(vol)); } catch { /* storage blocked */ }
  }, [vol]);

  const toggle = async () => {
    const a = au.current;
    if (state === 'playing') { await a.ctx.suspend(); setState('paused'); return; }
    if (state === 'paused') { await a.ctx.resume(); setState('playing'); return; }
    if (state === 'loading') return;
    try {
      setState('loading');
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const [meta, bytes] = await Promise.all([
        fetch(`${base}data/music.json`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
        fetch(`${base}media/kyoto-slowly.mp3`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }),
      ]);
      const buf = await ctx.decodeAudioData(bytes);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = meta.loop_start;
      src.loopEnd = Math.min(meta.loop_end, buf.duration);
      src.connect(gain);
      src.start(0, meta.loop_start);
      gain.gain.setTargetAtTime(vol * vol, ctx.currentTime, 0.6); // fade in
      au.current = { ctx, gain, src };
      if (ctx.state === 'suspended') await ctx.resume();
      setState('playing');
    } catch (e) {
      console.warn('Music could not be played:', e);
      setState('error');
    }
  };

  const playing = state === 'playing';
  const label = state === 'error' ? 'Music could not be loaded. Press to try again.' : playing ? 'Pause background music' : state === 'loading' ? 'Loading music…' : 'Play background music';
  return (
    <div className={'music' + (playing ? ' playing' : '') + (state === 'loading' ? ' loading' : '') + (state === 'error' ? ' error' : '')} role="group" aria-label="Background music: Kyoto, Slowly (original piano piece)">
      <button type="button" className="music-btn" onClick={state === 'error' ? () => { setState('idle'); } : toggle} aria-pressed={playing} aria-label={label} title={label}>
        {playing ? (
          <span className="music-eq" aria-hidden="true"><i /><i /><i /></span>
        ) : (
          <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M8 14.500V4.500l8-1.800v9.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" /><circle cx="6" cy="14.5" r="2.2" fill="currentColor" /><circle cx="14" cy="12.5" r="2.2" fill="currentColor" /></svg>
        )}
      </button>
      <label className="music-vol">
        <span className="music-t">{state === 'error' ? 'Unavailable' : 'Kyoto, Slowly'}</span>
        <input type="range" min="0" max="1" step="0.02" value={vol} onChange={(e) => setVol(Number(e.target.value))} aria-label="Music volume" style={{ '--v': `${vol * 100}%` }} />
      </label>
    </div>
  );
}
