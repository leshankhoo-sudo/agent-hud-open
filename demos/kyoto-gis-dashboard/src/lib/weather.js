// Open-Meteo forecast client with a 30-minute cache.
// Values are model estimates for a grid cell, not observations at the attraction.
// On any failure this module throws; it never returns placeholder weather.

export const WEATHER_TTL_MS = 30 * 60 * 1000;
export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

export function weatherUrl(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat.toFixed(5),
    longitude: lon.toFixed(5),
    current: 'temperature_2m,weather_code',
    hourly: 'temperature_2m,weather_code,precipitation_probability,precipitation',
    timezone: 'Asia/Tokyo',
    forecast_days: '7',
  });
  return `${OPEN_METEO_URL}?${p}`;
}

export class WeatherError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'network' | 'http' | 'api' | 'format'
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Turn the raw response into rows. Missing values stay null (shown as "no value").
export function parseWeather(json) {
  if (!json || typeof json !== 'object') throw new WeatherError('format', 'Empty response');
  if (json.error) throw new WeatherError('api', json.reason || 'Open-Meteo returned an error');
  const h = json.hourly;
  if (!h || !Array.isArray(h.time) || h.time.length === 0) throw new WeatherError('format', 'Response has no hourly forecast');
  const hourly = h.time.map((t, i) => ({
    time: t,
    temperature: num(h.temperature_2m?.[i]),
    code: num(h.weather_code?.[i]),
    precipProb: num(h.precipitation_probability?.[i]),
    precip: num(h.precipitation?.[i]),
  }));
  const c = json.current || null;
  return {
    timezone: json.timezone,
    grid: { lat: num(json.latitude), lon: num(json.longitude), elevation: num(json.elevation) },
    units: { temperature: json.hourly_units?.temperature_2m || '°C', precip: json.hourly_units?.precipitation || 'mm', precipProb: json.hourly_units?.precipitation_probability || '%' },
    current: c ? { time: c.time || null, interval: num(c.interval), temperature: num(c.temperature_2m), code: num(c.weather_code) } : null,
    hourly,
  };
}

const memory = new Map();
const keyOf = (lat, lon) => `${lat.toFixed(4)},${lon.toFixed(4)}`;

function readStore(storage, key) {
  try {
    const s = storage?.getItem('wx:' + key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
function writeStore(storage, key, entry) {
  try {
    storage?.setItem('wx:' + key, JSON.stringify(entry));
  } catch {
    /* storage full or blocked: memory cache still works */
  }
}

// Returns { data, fetchedAt, fromCache }.
export async function getWeather(lat, lon, { force = false, fetchImpl = globalThis.fetch, now = () => Date.now(), storage = globalThis.sessionStorage, signal } = {}) {
  const key = keyOf(lat, lon);
  if (!force) {
    const hit = memory.get(key) || readStore(storage, key);
    if (hit && now() - hit.fetchedAt < WEATHER_TTL_MS) {
      memory.set(key, hit);
      return { ...hit, fromCache: true };
    }
  }
  let res;
  try {
    res = await fetchImpl(weatherUrl(lat, lon), { signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new WeatherError('network', 'Could not reach Open-Meteo (' + (e?.message || 'network error') + ')');
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* handled below */
  }
  if (!res.ok) throw new WeatherError('http', `Open-Meteo HTTP ${res.status}` + (json?.reason ? `: ${json.reason}` : ''));
  const data = parseWeather(json);
  const entry = { data, fetchedAt: now() };
  memory.set(key, entry);
  writeStore(storage, key, entry);
  return { ...entry, fromCache: false };
}

export function clearWeatherCache() {
  memory.clear();
}

// WMO weather interpretation codes used by Open-Meteo.
const WMO = {
  0: ['Clear sky', 'sun'], 1: ['Mainly clear', 'sun'], 2: ['Partly cloudy', 'partly'], 3: ['Overcast', 'cloud'],
  45: ['Fog', 'fog'], 48: ['Depositing rime fog', 'fog'],
  51: ['Light drizzle', 'drizzle'], 53: ['Moderate drizzle', 'drizzle'], 55: ['Dense drizzle', 'drizzle'],
  56: ['Light freezing drizzle', 'drizzle'], 57: ['Dense freezing drizzle', 'drizzle'],
  61: ['Slight rain', 'rain'], 63: ['Moderate rain', 'rain'], 65: ['Heavy rain', 'rain'],
  66: ['Light freezing rain', 'rain'], 67: ['Heavy freezing rain', 'rain'],
  71: ['Slight snow', 'snow'], 73: ['Moderate snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
  80: ['Slight rain showers', 'rain'], 81: ['Moderate rain showers', 'rain'], 82: ['Violent rain showers', 'rain'],
  85: ['Slight snow showers', 'snow'], 86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorm', 'storm'], 96: ['Thunderstorm, slight hail', 'storm'], 99: ['Thunderstorm, heavy hail', 'storm'],
};
export function describeCode(code) {
  if (code == null) return { label: 'No value', icon: 'none' };
  const w = WMO[code];
  return w ? { label: w[0], icon: w[1] } : { label: `Code ${code}`, icon: 'cloud' };
}

// "Now" in Asia/Tokyo as the hourly key format used by Open-Meteo: YYYY-MM-DDTHH:00
export function tokyoHourKey(date = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
}

export function formatTokyo(ms) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms) + ' JST';
}

// Daily summary derived only from the hourly values in the response.
export function dailySummary(hourly) {
  const days = new Map();
  for (const h of hourly) {
    const d = h.time.slice(0, 10);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(h);
  }
  return [...days.entries()].map(([date, hs]) => {
    const t = hs.map((x) => x.temperature).filter((v) => v != null);
    const pp = hs.map((x) => x.precipProb).filter((v) => v != null);
    const pr = hs.map((x) => x.precip).filter((v) => v != null);
    return {
      date,
      hours: hs.length,
      min: t.length ? Math.min(...t) : null,
      max: t.length ? Math.max(...t) : null,
      maxProb: pp.length ? Math.max(...pp) : null,
      total: pr.length ? Math.round(pr.reduce((a, b) => a + b, 0) * 10) / 10 : null,
    };
  });
}
