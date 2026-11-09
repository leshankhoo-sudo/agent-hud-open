import { useEffect, useMemo, useRef, useState } from 'react';
import { getWeather, describeCode, tokyoHourKey, formatTokyo, dailySummary, WEATHER_TTL_MS } from './lib/weather.js';

const DOW = (d) => new Date(d + 'T00:00:00+09:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Asia/Tokyo' });
const fmt = (v, unit, digits = 1) => (v == null ? 'no value' : `${digits === 0 ? Math.round(v) : v.toFixed(digits)}${unit}`);

function RollNum({ value }) {
  const [v, setV] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(value); return; }
    const a = from.current, t0 = performance.now();
    let raf;
    const f = (now) => { const k = Math.min(1, (now - t0) / 700), e = 1 - Math.pow(1 - k, 3); setV(a + (value - a) * e); if (k < 1) raf = requestAnimationFrame(f); else from.current = value; };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{v.toFixed(1)}</>;
}

export function WxIcon({ kind, size = 22 }) {
  const s = { width: size, height: size };
  const sun = <><circle cx="12" cy="12" r="4.2" fill="#f2b233" /><g stroke="#f2b233" strokeWidth="1.6" strokeLinecap="round">{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} x1="12" y1="2.6" x2="12" y2="4.6" transform={`rotate(${a} 12 12)`} />)}</g></>;
  const cloud = (y = 0, fill = '#b8c4d2') => <path d={`M7 ${18 + y}h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.4A3.3 3.3 0 0 0 7 ${18 + y}z`} fill={fill} />;
  const drops = (n, c = '#3d73c9') => <g stroke={c} strokeWidth="1.6" strokeLinecap="round">{Array.from({ length: n }, (_, i) => <line key={i} x1={8 + i * 4} y1="19.5" x2={7 + i * 4} y2="22" />)}</g>;
  const body = {
    sun,
    partly: <><g transform="translate(-3 -3) scale(.8)">{sun}</g>{cloud(1)}</>,
    cloud: cloud(-1, '#a9b6c6'),
    fog: <>{cloud(-3)}<g stroke="#9aa6b4" strokeWidth="1.6" strokeLinecap="round"><line x1="5" y1="19" x2="19" y2="19" /><line x1="7" y1="22" x2="17" y2="22" /></g></>,
    drizzle: <>{cloud(-3)}{drops(2, '#6c95d6')}</>,
    rain: <>{cloud(-3, '#9aa8b9')}{drops(3)}</>,
    snow: <>{cloud(-3)}<g fill="#8fb3e6">{[8, 12, 16].map((x) => <circle key={x} cx={x} cy="21" r="1.2" />)}</g></>,
    storm: <>{cloud(-3, '#7f8da0')}<path d="M12 16l-2.5 4h3l-1.5 3.5 4-5h-3l1.5-2.5z" fill="#f2b233" /></>,
    none: <circle cx="12" cy="12" r="6" fill="none" stroke="#b8c4d2" strokeDasharray="2 2" />,
  }[kind] || cloud();
  return <svg viewBox="0 0 24 24" style={s} aria-hidden="true">{body}</svg>;
}

export default function Weather({ target }) {
  const [state, setState] = useState({ status: 'idle' });
  const [day, setDay] = useState(null);
  const [hour, setHour] = useState(null);
  const ctrl = useRef(null);

  async function load(force = false) {
    if (!target || import.meta.env.VITE_TARGET === 'artifact') return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setState((s) => ({ status: 'loading', prev: s.data ? s : s.prev }));
    try {
      const r = await getWeather(target.lat, target.lon, { force, signal: c.signal });
      if (c.signal.aborted) return;
      setState({ status: 'ok', ...r });
    } catch (e) {
      if (e?.name === 'AbortError') return;
      setState({ status: 'error', error: e.message || String(e), kind: e.kind || 'network' });
    }
  }

  useEffect(() => {
    setState({ status: 'idle' });
    if (target) load(false);
    return () => ctrl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  const data = state.status === 'ok' ? state.data : null;
  const days = useMemo(() => (data ? dailySummary(data.hourly) : []), [data]);

  // Default planned visit: the current Tokyo hour if it is in the forecast, else the first hour.
  useEffect(() => {
    if (!data) return;
    const now = tokyoHourKey();
    const first = data.hourly.find((h) => h.time >= now) || data.hourly[0];
    setDay((d) => (d && days.some((x) => x.date === d) ? d : first.time.slice(0, 10)));
    setHour((h) => (h != null ? h : Number(first.time.slice(11, 13))));
  }, [data, days]);

  if (!target) return null;
  if (import.meta.env.VITE_TARGET === 'artifact') {
    return (
      <section className="card wx" aria-labelledby="wx-h">
        <header className="card-h"><h3 id="wx-h">Weather forecast</h3></header>
        <div className="alert" role="status">
          <b>Live weather is off in this online preview</b>
          <span>The claude.ai viewer blocks requests to outside servers, so Open-Meteo cannot be reached here. No forecast is shown instead.</span>
          <span className="muted">In the deployed or locally run dashboard, selecting this point requests the Open-Meteo forecast for {target.lat.toFixed(4)}, {target.lon.toFixed(4)} (Asia/Tokyo, 7 days, 30-min cache).</span>
        </div>
      </section>
    );
  }

  const key = day && hour != null ? `${day}T${String(hour).padStart(2, '0')}:00` : null;
  const sel = data && key ? data.hourly.find((h) => h.time === key) : null;
  const dayHours = data && day ? data.hourly.filter((h) => h.time.startsWith(day)) : [];

  return (
    <section className="card wx" aria-labelledby="wx-h">
      <header className="card-h">
        <h3 id="wx-h">Weather forecast</h3>
        <button className="btn ghost sm" type="button" onClick={() => load(true)} disabled={state.status === 'loading'} aria-label="Refresh weather">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={state.status === 'loading' ? 'spin' : ''}><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" /></svg>
          Refresh
        </button>
      </header>
      <p className="note">Model estimate for the grid cell around this point (Open-Meteo), not an on-site measurement.</p>

      {state.status === 'loading' && (
        <div className="wx-skel" aria-live="polite" aria-busy="true">
          <i /><i /><i />
          <span>Requesting forecast for {target.lat.toFixed(4)}, {target.lon.toFixed(4)}…</span>
        </div>
      )}

      {state.status === 'error' && (
        <div className="alert" role="alert">
          <b>Weather unavailable</b>
          <span>{state.error}</span>
          <span className="muted">No forecast is shown instead. Try Refresh later; the free Open-Meteo API has daily limits per network.</span>
          <button className="btn sm" type="button" onClick={() => load(true)}>Try again</button>
        </div>
      )}

      {data && (
        <div className="wx-body">
          <div className="wx-now">
            <WxIcon kind={describeCode(data.current?.code).icon} size={44} />
            <div>
              <div className="wx-temp">{data.current?.temperature == null ? 'no value' : <><RollNum value={data.current.temperature} />{data.units.temperature}</>}</div>
              <div>{describeCode(data.current?.code).label}</div>
              <div className="muted xs">Current model value · valid {data.current?.time ? data.current.time.replace('T', ' ') + ' JST' : 'no time given'}{data.current?.interval ? ` (${data.current.interval / 60}-min interval)` : ''}</div>
            </div>
          </div>

          <fieldset className="visit">
            <legend>Planned visit (Asia/Tokyo)</legend>
            <label>
              <span>Date</span>
              <select value={day || ''} onChange={(e) => setDay(e.target.value)} id="wx-day">
                {days.map((d) => <option key={d.date} value={d.date}>{DOW(d.date)}</option>)}
              </select>
            </label>
            <label>
              <span>Hour</span>
              <select value={hour ?? ''} onChange={(e) => setHour(Number(e.target.value))} id="wx-hour">
                {dayHours.map((h) => <option key={h.time} value={Number(h.time.slice(11, 13))}>{h.time.slice(11, 16)}</option>)}
              </select>
            </label>
          </fieldset>

          {sel ? (
            <div className="wx-sel" key={sel.time}>
              <WxIcon kind={describeCode(sel.code).icon} size={30} />
              <dl>
                <div><dt>Conditions</dt><dd>{describeCode(sel.code).label}</dd></div>
                <div><dt>Temperature</dt><dd>{fmt(sel.temperature, data.units.temperature)}</dd></div>
                <div><dt>Rain probability</dt><dd>{fmt(sel.precipProb, '%', 0)}</dd></div>
                <div><dt>Precipitation</dt><dd>{fmt(sel.precip, ' mm')}</dd></div>
              </dl>
              <p className="muted xs">Forecast valid for {sel.time.replace('T', ' ')} JST (hourly value)</p>
            </div>
          ) : (
            <p className="muted">That hour is outside the 7-day forecast.</p>
          )}

          <HourChart hours={dayHours} selected={key} onPick={(t) => setHour(Number(t.slice(11, 13)))} />

          <div className="wx-days" role="list" aria-label="Seven-day summary">
            {days.map((d, i) => (
              <button key={d.date} role="listitem" type="button" className={'wx-day' + (d.date === day ? ' on' : '')} onClick={() => setDay(d.date)} style={{ '--i': i }}>
                <span>{DOW(d.date).split(' ')[0]}</span>
                <b>{d.max == null ? '—' : Math.round(d.max)}°</b>
                <span className="muted">{d.min == null ? '—' : Math.round(d.min)}°</span>
                <span className="pp">{d.maxProb == null ? '—' : d.maxProb + '%'}</span>
              </button>
            ))}
          </div>
          <p className="muted xs">Daily values are derived from the hourly forecast (max/min temperature, highest rain probability).</p>

          <footer className="wx-meta">
            <span>Model grid point {data.grid.lat?.toFixed(3)}, {data.grid.lon?.toFixed(3)}{data.grid.elevation != null ? ` · ${Math.round(data.grid.elevation)} m` : ''}</span>
            <span>Retrieved {formatTokyo(state.fetchedAt)}{state.fromCache ? ' · from 30-min cache' : ''}</span>
            <span>Cached until {formatTokyo(state.fetchedAt + WEATHER_TTL_MS)}; Refresh requests a new copy now</span>
            <span>Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a> (CC BY 4.0)</span>
          </footer>
        </div>
      )}
    </section>
  );
}

function HourChart({ hours, selected, onPick }) {
  if (!hours.length) return null;
  const W = 320, H = 92, pad = 4, n = hours.length, bw = (W - pad * 2) / n;
  const temps = hours.map((h) => h.temperature).filter((v) => v != null);
  const tmin = Math.min(...temps), tmax = Math.max(...temps), span = Math.max(1, tmax - tmin);
  const y = (t) => 10 + (1 - (t - tmin) / span) * 34;
  let path = '';
  hours.forEach((h, i) => {
    if (h.temperature == null) return;
    path += `${path ? 'L' : 'M'}${(pad + bw * (i + 0.5)).toFixed(1)} ${y(h.temperature).toFixed(1)}`;
  });
  return (
    <figure className="hourchart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Hourly temperature and rain probability for the chosen date">
        {[0, 50, 100].map((p) => <line key={p} x1={pad} x2={W - pad} y1={H - 14 - p * 0.3} y2={H - 14 - p * 0.3} stroke="var(--line)" strokeDasharray={p ? '2 3' : ''} />)}
        {hours.map((h, i) => {
          const pp = h.precipProb;
          const on = h.time === selected;
          return (
            <g key={h.time} onClick={() => onPick(h.time)} className="hc-col">
              <rect x={pad + bw * i} y={0} width={bw} height={H} fill={on ? 'rgba(79,157,255,.16)' : 'transparent'} />
              {pp != null && <rect className="hc-bar" style={{ '--d': `${i * 12}ms` }} x={pad + bw * i + 1} y={H - 14 - pp * 0.3} width={bw - 2} height={pp * 0.3} rx="1" fill={on ? '#7fb3ff' : '#2e6bdc'} />}
              {i % 3 === 0 && <text x={pad + bw * (i + 0.5)} y={H - 2} textAnchor="middle">{h.time.slice(11, 13)}</text>}
            </g>
          );
        })}
        <path d={path} fill="none" stroke="#f2c86b" strokeWidth="1.8" strokeLinejoin="round" className="hc-line" />
        <text x={W - pad} y={9} textAnchor="end">{Math.round(tmax)}°</text>
        <text x={W - pad} y={50} textAnchor="end">{Math.round(tmin)}°</text>
      </svg>
      <figcaption><span className="key t" />Temperature <span className="key p" />Rain probability (bars, 0–100%) · click an hour to select</figcaption>
    </figure>
  );
}
