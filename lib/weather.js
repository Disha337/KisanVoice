// Real weather from Open-Meteo (free, no API key). Never invents data: errors are thrown.
async function getJson(url) {
  const c = new AbortController();
  const to = setTimeout(() => c.abort(), 10000);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) throw new Error('Weather service returned HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Weather service timed out');
    if (e instanceof TypeError) throw new Error('Could not reach the weather service. Check your internet connection.');
    throw e;
  } finally { clearTimeout(to); }
}
export async function getWeather({ q, lat, lon, lang = 'en' }) {
  let place = null;
  if (q) {
    const l = ['en', 'hi', 'mr'].includes(lang) ? lang : 'en';
    const g = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(String(q).slice(0, 80))}&count=1&language=${l}&format=json`);
    const r = g.results && g.results[0];
    if (!r) { const e = new Error('Place not found'); e.code = 'notfound'; throw e; }
    lat = r.latitude; lon = r.longitude;
    place = { name: r.name, region: r.admin1 || '', country: r.country || '' };
  }
  lat = Number(lat); lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    const e = new Error('Invalid location'); e.code = 'bad_request'; throw e;
  }
  const f = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=5`);
  const c = f.current || {}, d = f.daily || {};
  return {
    place: place || { name: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, region: '', country: '' },
    current: { temp: c.temperature_2m, humidity: c.relative_humidity_2m, precip: c.precipitation, wind: c.wind_speed_10m, code: c.weather_code, time: c.time },
    daily: (d.time || []).map((date, i) => ({ date, max: d.temperature_2m_max?.[i], min: d.temperature_2m_min?.[i], rain: d.precipitation_probability_max?.[i], code: d.weather_code?.[i] })),
    timezone: f.timezone, source: 'Open-Meteo (open-meteo.com)', fetchedAt: new Date().toISOString(),
  };
}
