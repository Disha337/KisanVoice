import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat, aiStatus } from './lib/ai.js';
import { recommend } from './lib/crops.js';
import { getWeather } from './lib/weather.js';
import { bolnaStatus, bolnaCall, bolnaExecution } from './lib/bolna.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '7mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Tiny in-memory rate limiter (protects your API credits).
const hits = new Map();
const limit = (name, max, windowMs) => (req, res, next) => {
  const k = name + ':' + req.ip, now = Date.now();
  const arr = (hits.get(k) || []).filter((x) => now - x < windowMs);
  if (arr.length >= max) return res.status(429).json({ error: 'Too many requests. Please wait a little.', code: 'rate' });
  arr.push(now); hits.set(k, arr); next();
};
const statusFor = (code) => ({ bad_request: 400, notfound: 404, rate: 429, not_configured: 503 }[code] || 502);
const sendErr = (res, tag, e) => {
  const code = e.code || 'upstream';
  console.error(`[${tag}]`, code, e.message);
  res.status(statusFor(code)).json({ error: e.message, code });
};

app.get('/api/status', (req, res) => res.json({ ai: aiStatus(), bolna: bolnaStatus(), weather: { configured: true, source: 'Open-Meteo (no key needed)' } }));

app.post('/api/chat', limit('chat', 40, 60000), async (req, res) => {
  try {
    const { messages, lang, mode, image, context } = req.body || {};
    res.json(await chat({ messages, lang, mode: mode === 'disease' ? 'disease' : 'chat', image, context: context && typeof context === 'object' ? context : {} }));
  } catch (e) { sendErr(res, 'chat', e); }
});

app.post('/api/crops', (req, res) => {
  const { season, soil, water } = req.body || {};
  res.json({ kind: 'rule-based-sample', results: recommend({ season, soil, water }) });
});

app.get('/api/weather', limit('wx', 30, 60000), async (req, res) => {
  try { res.json(await getWeather({ q: req.query.q, lat: req.query.lat, lon: req.query.lon, lang: req.query.lang })); }
  catch (e) { sendErr(res, 'weather', e); }
});

app.post('/api/bolna/call', limit('bolna', 3, 10 * 60000), async (req, res) => {
  try { const d = await bolnaCall({ phone: req.body?.phone, name: req.body?.name }); res.json({ ok: true, execution_id: d.execution_id, message: d.message }); }
  catch (e) { sendErr(res, 'bolna', e); }
});
app.get('/api/bolna/execution/:id', limit('bolna-status', 30, 60000), async (req, res) => {
  try { res.json(await bolnaExecution(req.params.id)); } catch (e) { sendErr(res, 'bolna', e); }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API route', code: 'bad_request' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'Bad or too large request', code: 'bad_request' });
  console.error(err); res.status(500).json({ error: 'Server error', code: 'server' });
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  const s = aiStatus();
  console.log(`\n  KisanVoice running ->  http://localhost:${PORT}  (open in Chrome or Edge)`);
  console.log(`  AI: ${s.configured ? s.provider + ' / ' + s.model : 'DEMO MODE (no AI key found in .env)'}`);
  console.log(`  Bolna: ${bolnaStatus().configured ? 'configured' : 'not configured (optional)'}\n`);
});
