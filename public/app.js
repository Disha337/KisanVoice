import { t, setLang, getLang, LANG_META, applyI18n } from './i18n.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const state = { phase: 'idle', history: [], lastReply: '', weather: null, status: null, image: null,
  prefs: { lang: 'en', autoSpeak: true, handsFree: false, rate: 1 }, profile: { name: '', village: '', crops: '' }, speakToken: 0, lastExecId: '' };

/* ---------- storage ---------- */
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage may be blocked */ } };

/* ---------- icons ---------- */
const ICONS = {
  idle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 15a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v5a4 4 0 0 0 4 4Zm6-4a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.9V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.1A6 6 0 0 0 18 11Z"/></svg>',
  listening: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="3"/></svg>',
  thinking: '<svg class="dots" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/></svg>',
  speaking: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4Zm-2.5-8.7v2.1a7 7 0 0 1 0 13.2v2.1a9 9 0 0 0 0-17.4Z"/></svg>',
};

/* ---------- phase / notice ---------- */
function setPhase(p) {
  state.phase = p;
  $('#orbwrap').className = 'orbwrap p-' + p;
  $('#phaseLabel').textContent = t({ idle: 'voice.idle', listening: 'voice.listening', thinking: 'voice.thinking', speaking: 'voice.speaking' }[p]);
  $('#orb').setAttribute('aria-pressed', String(p === 'listening'));
  $('#orb').disabled = p === 'thinking';
  $('#orbIcon').innerHTML = ICONS[p];
  $('#stopBtn').disabled = p !== 'speaking';
  $('#orbHint').textContent = p === 'listening' ? t('voice.tapStop') : p === 'idle' ? t('voice.tap') : '';
}
function notice(msg, type = 'warn', actions = []) {
  const n = $('#notice'); n.hidden = false; n.className = 'notice ' + (type === 'error' ? 'error' : '');
  n.textContent = msg;
  if (actions.length) {
    const d = document.createElement('div'); d.className = 'acts';
    actions.forEach((a) => { const b = document.createElement('button'); b.className = 'btn ghost small'; b.textContent = a.label; b.onclick = a.run; d.append(b); });
    n.append(d);
  }
}
const clearNotice = () => { $('#notice').hidden = true; $('#notice').textContent = ''; };

/* ---------- chat rendering ---------- */
function bubble(m) {
  const d = document.createElement('div');
  d.className = 'bubble ' + (m.role === 'user' ? 'me' : 'bot');
  const who = document.createElement('div'); who.className = 'who'; who.textContent = t(m.role === 'user' ? 'voice.you' : 'voice.bot');
  const p = document.createElement('p'); p.textContent = m.content;
  d.append(who, p);
  if (m.role === 'assistant') {
    const f = document.createElement('div'); f.className = 'bfoot';
    const b = document.createElement('span'); b.className = 'badge' + (m.source === 'demo' ? ' demo' : '');
    b.textContent = m.source === 'demo' ? t('voice.demo') : t('voice.ai') + (m.provider ? ' · ' + m.provider : '');
    const pl = document.createElement('button'); pl.className = 'btn ghost small'; pl.textContent = '🔊 ' + t('voice.play'); pl.onclick = () => speak(m.content);
    f.append(b, pl); d.append(f);
  }
  return d;
}
function renderChat() {
  const c = $('#chat');
  $$('.bubble:not(.greeting)', c).forEach((x) => x.remove());
  state.history.forEach((m) => c.append(bubble(m)));
}
function addMsg(role, content, meta = {}) {
  const m = { role, content, ...meta };
  state.history.push(m); save('kv_history', state.history.slice(-20));
  $('#chat').append(bubble(m));
  $('#chat').lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (role === 'assistant') state.lastReply = content;
  return m;
}

/* ---------- speech recognition (real mic capture) ---------- */
let rec = null, finalText = '', interimText = '', srError = false, listenTimer = 0, meter = null;
function srMessage(code) {
  return { 'not-allowed': 'err.denied', 'service-not-allowed': 'err.denied', 'audio-capture': 'err.nomic', 'no-speech': 'err.nospeech',
    'network': 'err.network', 'language-not-supported': 'err.srlang' }[code] || null;
}
function startListening() {
  if (state.phase === 'listening') return stopListening();
  stopSpeaking(); clearNotice();
  if (!SR) { notice(t('err.unsupported'), 'warn'); $('#textIn').focus(); return; }
  finalText = ''; interimText = ''; srError = false;
  rec = new SR();
  rec.lang = LANG_META[getLang()].speech; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
  rec.onstart = () => { setPhase('listening'); startMeter(); clearTimeout(listenTimer); listenTimer = setTimeout(() => { try { rec.stop(); } catch { /* ignore */ } }, 20000); };
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; }
    interimText = interim; $('#live').textContent = (finalText + interim).trim();
  };
  rec.onerror = (e) => { srError = true; const k = srMessage(e.error); notice(k ? t(k) : t('err.generic', { m: e.error }), 'warn'); };
  rec.onend = () => {
    clearTimeout(listenTimer); stopMeter();
    const txt = (finalText || interimText).trim();
    $('#live').textContent = '';
    if (state.phase === 'listening') setPhase('idle');
    if (txt) send(txt); else if (!srError) notice(t('err.nospeech'), 'warn');
  };
  try { rec.start(); } catch (err) { setPhase('idle'); notice(t('err.generic', { m: err.message }), 'error'); }
}
function stopListening() { try { rec && rec.stop(); } catch { /* ignore */ } }

/* real microphone level meter (desktop only; phones often can't share the mic with recognition) */
async function startMeter() {
  if (IS_MOBILE || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (state.phase !== 'listening') { stream.getTracks().forEach((x) => x.stop()); return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const an = ctx.createAnalyser(); an.fftSize = 128;
    ctx.createMediaStreamSource(stream).connect(an);
    const data = new Uint8Array(an.frequencyBinCount), cv = $('#wave'), g = cv.getContext('2d');
    cv.hidden = false; meter = { stream, ctx, raf: 0 };
    const draw = () => {
      an.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
      $('#orbwrap').style.setProperty('--level', Math.min(1, avg * 2.2).toFixed(2));
      g.clearRect(0, 0, cv.width, cv.height);
      const n = 36, w = cv.width / n;
      for (let i = 0; i < n; i++) {
        const v = data[Math.floor((i / n) * data.length * 0.7)] / 255, h = Math.max(3, v * cv.height);
        g.fillStyle = '#f4a300'; g.fillRect(i * w + 2, (cv.height - h) / 2, w - 4, h);
      }
      meter.raf = requestAnimationFrame(draw);
    };
    draw();
  } catch { /* meter is optional; recognition continues */ }
}
function stopMeter() {
  if (!meter) return;
  cancelAnimationFrame(meter.raf); meter.stream.getTracks().forEach((x) => x.stop()); meter.ctx.close().catch(() => {});
  meter = null; $('#wave').hidden = true; $('#orbwrap').style.setProperty('--level', '0');
}

/* ---------- speech synthesis ---------- */
const voicesReady = () => new Promise((res) => {
  if (!('speechSynthesis' in window)) return res([]);
  const v = speechSynthesis.getVoices(); if (v.length) return res(v);
  const done = () => res(speechSynthesis.getVoices());
  speechSynthesis.addEventListener('voiceschanged', done, { once: true }); setTimeout(done, 1500);
});
function pickVoice(voices, lang) {
  const code = LANG_META[lang].speech.toLowerCase(), base = code.split('-')[0];
  const norm = (v) => v.lang.replace('_', '-').toLowerCase();
  return voices.find((v) => norm(v) === code) || voices.find((v) => norm(v).startsWith(base)) || null;
}
async function speak(text, voiceLang) {
  if (!text) return;
  if (!('speechSynthesis' in window)) { notice(t('err.notts'), 'warn'); return; }
  const lang = voiceLang || getLang();
  const voices = await voicesReady();
  const voice = pickVoice(voices, lang);
  if (!voice && lang !== 'en') {
    const acts = lang === 'mr' && pickVoice(voices, 'hi') ? [{ label: t('err.hiVoice'), run: () => { clearNotice(); speak(text, 'hi'); } }] : [];
    notice(t('err.novoice', { l: LANG_META[lang].name }), 'warn', acts); return;
  }
  speechSynthesis.cancel();
  const token = ++state.speakToken;
  const chunks = text.match(/[^.!?।\n]+[.!?।]?/g)?.map((s) => s.trim()).filter(Boolean) || [text];
  setPhase('speaking');
  const finish = (ok) => {
    if (token !== state.speakToken) return;
    if (state.phase === 'speaking') setPhase('idle');
    if (!ok) notice(t('err.notts'), 'warn'); else if (state.prefs.handsFree) startListening();
  };
  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c);
    u.lang = LANG_META[lang].speech; if (voice) u.voice = voice; u.rate = state.prefs.rate;
    u.onend = () => { if (i === chunks.length - 1) finish(true); };
    u.onerror = (e) => { if (token !== state.speakToken) return; if (e.error === 'interrupted' || e.error === 'canceled') return; finish(false); };
    speechSynthesis.speak(u);
  });
}
function stopSpeaking() {
  state.speakToken++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (state.phase === 'speaking') setPhase('idle');
}

/* ---------- AI call ---------- */
function buildContext() {
  const p = state.profile, ctx = {};
  if (p.name || p.village || p.crops) ctx.profile = p;
  if (state.weather) ctx.weather = weatherSummary(state.weather);
  return ctx;
}
function errText(e) {
  if (e instanceof TypeError) return t('err.network');
  if (e.code === 'auth') return t('err.auth');
  if (e.code === 'rate') return t('err.rate');
  return t('err.server', { m: e.message });
}
async function ask(opts = {}) {
  clearNotice(); setPhase('thinking');
  try {
    const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.history.slice(-10).map(({ role, content }) => ({ role, content })), lang: getLang(), mode: opts.mode || 'chat', image: opts.image || null, context: buildContext() }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'HTTP ' + res.status), { code: data.code });
    addMsg('assistant', data.reply, { source: data.source, provider: data.provider });
    setPhase('idle');
    if (state.prefs.autoSpeak) speak(data.reply);
    return data;
  } catch (e) {
    setPhase('idle');
    notice(errText(e), 'error', [{ label: t('err.retry'), run: () => ask(opts) }]);
    return null;
  }
}
async function send(text, opts = {}) {
  text = (text || '').trim(); if (!text) return null;
  if (opts.view !== false) showView('voice');
  addMsg('user', text);
  return ask(opts);
}

/* ---------- dictation into form fields ---------- */
function dictate(input, btn, onText) {
  if (!SR) { notice(t('err.unsupported'), 'warn'); return; }
  stopListening(); stopSpeaking();
  const r = new SR(); r.lang = LANG_META[getLang()].speech; r.interimResults = false; r.maxAlternatives = 1;
  let got = false; btn.classList.add('on');
  r.onresult = (e) => { got = true; const txt = e.results[0][0].transcript; input.value = input.value && input.tagName === 'TEXTAREA' ? input.value + ' ' + txt : txt; if (onText) onText(txt); };
  r.onerror = (e) => { const k = srMessage(e.error); inlineMsg(input, k ? t(k) : t('err.generic', { m: e.error })); };
  r.onend = () => { btn.classList.remove('on'); if (!got) inlineMsg(input, t('err.nospeech')); };
  try { r.start(); } catch { btn.classList.remove('on'); }
}
function inlineMsg(input, msg) {
  let s = input.closest('.fld')?.parentElement.querySelector('.inline-msg');
  if (!s) { s = document.createElement('div'); s.className = 'small inline-msg'; s.setAttribute('role', 'alert'); input.closest('.fld').after(s); }
  s.textContent = msg; setTimeout(() => { s.textContent = ''; }, 6000);
}

/* ---------- navigation / language ---------- */
function showView(v) {
  $$('.view').forEach((x) => x.classList.toggle('active', x.id === 'view-' + v));
  $$('.tab').forEach((x) => x.classList.toggle('active', x.dataset.view === v));
  if (v !== 'voice') { stopListening(); stopSpeaking(); }
  history.replaceState(null, '', '#' + v); window.scrollTo({ top: 0 });
}
function renderSelects() {
  const fill = (id, list, prefix) => {
    const el = $(id), cur = el.value; el.innerHTML = '';
    const any = document.createElement('option'); any.value = ''; any.textContent = t('crops.any'); el.append(any);
    list.forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = t(prefix + k); el.append(o); });
    el.value = cur;
  };
  fill('#cSeason', ['kharif', 'rabi', 'summer'], 'season.'); fill('#cSoil', ['black', 'red', 'sandy', 'loamy'], 'soil.'); fill('#cWater', ['low', 'medium', 'high'], 'water.');
}
function renderChips() {
  const c = $('#chips'); c.innerHTML = '';
  ['s1', 's2', 's3', 's4'].forEach((k) => { const b = document.createElement('button'); b.className = 'chip'; b.textContent = t(k); b.onclick = () => send(t(k)); c.append(b); });
}
function renderMode() {
  const s = state.status, chip = $('#modeChip'); if (!s) return;
  chip.className = 'modechip' + (s.ai.configured ? '' : ' demo');
  chip.textContent = s.ai.configured ? '✅ ' + t('mode.ai', { p: s.ai.provider }) : '⚠️ ' + t('mode.demo');
  $('#bStatus').textContent = s.bolna.configured ? t('settings.bolnaOn') : t('settings.bolnaOff');
  $('#bCall').disabled = !s.bolna.configured;
}
function changeLang(l) {
  stopSpeaking(); setLang(l); state.prefs.lang = l; save('kv_prefs', state.prefs);
  $$('.lang').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === l)));
  applyI18n(); renderSelects(); renderChips(); renderMode(); renderChat(); setPhase(state.phase);
  document.title = 'KisanVoice · ' + t('app.tagline');
  if (state.weather && $('#wOut').children.length) renderWeather(state.weather);
}

/* ---------- crops ---------- */
const KEYS = {
  season: { kharif: /kharif|खरीप|खरीफ|monsoon|मान्सून|मानसून|पावसाळ|बरसात/i, rabi: /rabi|रब्बी|रबी|winter|हिवाळ|सर्दी/i, summer: /summer|उन्हाळ|गर्मी|जायद/i },
  soil: { black: /black|regur|काळी|काली|रेगूर|रेगुर/i, red: /\bred\b|लाल/i, sandy: /sand|वाळू|रेतीली|बलुई|वालुकामय/i, loamy: /loam|दोमट/i },
  water: { low: /\blow\b|rain.?fed|कमी|कोरडवाहू|बारानी/i, medium: /medium|moderate|मध्यम/i, high: /\bhigh\b|canal|well|भरपूर|जास्त|कालवा|विहीर|नहर|कुआँ|कुआं/i },
};
function parseField(text) {
  const found = [];
  for (const [field, map] of Object.entries(KEYS)) for (const [val, re] of Object.entries(map)) if (re.test(text)) {
    $('#c' + field[0].toUpperCase() + field.slice(1)).value = val; found.push(t(field + '.' + val)); break;
  }
  $('#cHeard').textContent = found.length ? t('crops.heard', { v: found.join(', ') }) : '';
}
async function cropsGo() {
  const body = { season: $('#cSeason').value, soil: $('#cSoil').value, water: $('#cWater').value };
  const out = $('#cOut'); out.innerHTML = '';
  try {
    const r = await fetch('/api/crops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const { results } = await r.json();
    if (!results.length) { out.innerHTML = ''; const p = document.createElement('div'); p.className = 'warn'; p.textContent = t('crops.none'); out.append(p); return; }
    results.forEach((c) => {
      const d = document.createElement('div'); d.className = 'res';
      const why = [];
      if (c.matches.season) why.push(t('crops.fitSeason', { v: t('season.' + body.season) }));
      if (c.matches.soil) why.push(t('crops.fitSoil', { v: t('soil.' + body.soil) }));
      if (c.matches.water === 'exact') why.push(t('crops.fitWater', { v: t('water.' + body.water) }));
      if (c.matches.water === 'near') why.push(t('crops.nearWater', { v: t('water.' + body.water) }));
      const h = document.createElement('h3'); h.textContent = `${t('crop.' + c.id)}  ·  ${c.score}% ${t('crops.match')}`;
      const bar = document.createElement('div'); bar.className = 'bar'; const i = document.createElement('i'); i.style.width = c.score + '%'; bar.append(i);
      const p = document.createElement('div'); p.className = 'small'; p.textContent = t('crops.why') + ': ' + (why.join('; ') || '-');
      d.append(h, bar, p); out.append(d);
    });
    const note = document.createElement('div'); note.className = 'warn'; note.textContent = t('crops.rule');
    const ask = document.createElement('button'); ask.className = 'btn primary'; ask.textContent = '🎙️ ' + t('crops.ask');
    ask.onclick = () => { const na = t('crops.any'); send(t('crops.askPrompt', { loc: $('#cLoc').value || na, season: body.season ? t('season.' + body.season) : na, soil: body.soil ? t('soil.' + body.soil) : na, water: body.water ? t('water.' + body.water) : na })); };
    out.append(note, ask);
  } catch (e) { const p = document.createElement('div'); p.className = 'notice error'; p.textContent = errText(e); out.append(p); }
}

/* ---------- disease ---------- */
function onImage(file) {
  state.image = null; $('#dPrev').hidden = true; if (!file) return;
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => {
    const sc = Math.min(1, 1024 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
    cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const data = cv.toDataURL('image/jpeg', 0.82); state.image = { mime: 'image/jpeg', data: data.split(',')[1] };
    $('#dPrev').src = data; $('#dPrev').hidden = false; URL.revokeObjectURL(url);
  };
  img.onerror = () => { $('#dMsg').textContent = t('err.generic', { m: file.name }); };
  img.src = url;
}
async function diseaseSubmit(e) {
  e.preventDefault();
  const sym = $('#dSym').value.trim(), crop = $('#dCrop').value.trim();
  if (!sym) { $('#dMsg').textContent = t('disease.need'); return; }
  $('#dMsg').textContent = t('voice.thinking'); $('#dGo').disabled = true;
  const image = state.image;
  const data = await send(t('disease.prompt', { crop: crop || '-', sym }), { mode: 'disease', image, view: false });
  $('#dGo').disabled = false; $('#dMsg').textContent = '';
  const out = $('#dOut'); out.innerHTML = '';
  if (!data) { const p = document.createElement('div'); p.className = 'notice error'; p.textContent = t('err.server', { m: '…' }); out.append(p); return; }
  const d = document.createElement('div'); d.className = 'res';
  const h = document.createElement('h3'); h.textContent = t('disease.result');
  const p = document.createElement('p'); p.style.whiteSpace = 'pre-wrap'; p.textContent = data.reply;
  const b = document.createElement('span'); b.className = 'badge' + (data.source === 'demo' ? ' demo' : ''); b.textContent = data.source === 'demo' ? t('voice.demo') : t('voice.ai') + ' · ' + data.provider;
  d.append(h, p, b);
  if (image) { const n = document.createElement('div'); n.className = 'small'; n.textContent = data.imageAnalysed ? t('disease.imgok') : t('disease.imgdemo'); d.append(n); }
  const row = document.createElement('div'); row.className = 'row wrap';
  const play = document.createElement('button'); play.className = 'btn ghost'; play.textContent = '🔊 ' + t('voice.play'); play.onclick = () => speak(data.reply);
  const go = document.createElement('button'); go.className = 'btn primary'; go.textContent = '🎙️ ' + t('disease.continue'); go.onclick = () => showView('voice');
  row.append(play, go); d.append(row); out.append(d);
}

/* ---------- weather ---------- */
const wxKey = (c) => c === 0 || c === 1 ? 'clear' : c === 2 || c === 3 ? 'cloudy' : c === 45 || c === 48 ? 'fog' : c >= 51 && c <= 57 ? 'drizzle' : (c >= 61 && c <= 67) || (c >= 80 && c <= 82) ? 'rain' : (c >= 71 && c <= 77) || c === 85 || c === 86 ? 'snow' : c >= 95 ? 'storm' : 'cloudy';
const WX_ICON = { clear: '☀️', cloudy: '☁️', fog: '🌫️', drizzle: '🌦️', rain: '🌧️', snow: '❄️', storm: '⛈️' };
function weatherSummary(w) {
  const c = w.current;
  return `Place ${w.place.name}. Now: ${c.temp}°C, humidity ${c.humidity}%, wind ${c.wind} km/h, ${wxKey(c.code)}. Next days (max/min °C, rain chance %): ` +
    w.daily.map((d) => `${d.date} ${d.max}/${d.min}, ${d.rain}%`).join('; ') + `. Source ${w.source}, fetched ${w.fetchedAt}.`;
}
function renderWeather(w) {
  const out = $('#wOut'); out.innerHTML = ''; const c = w.current;
  const card = document.createElement('div'); card.className = 'card';
  const top = document.createElement('div'); top.className = 'wnow';
  const tt = document.createElement('div'); tt.className = 'temp'; tt.textContent = `${WX_ICON[wxKey(c.code)]} ${Math.round(c.temp)}°C`;
  const nm = document.createElement('div'); const nb = document.createElement('b'); nb.textContent = [w.place.name, w.place.region].filter(Boolean).join(', ');
  const ds = document.createElement('div'); ds.className = 'small'; ds.textContent = t('wx.' + wxKey(c.code)); nm.append(nb, ds); top.append(tt, nm);
  const st = document.createElement('div'); st.className = 'stats';
  [[t('weather.humidity'), c.humidity + '%'], [t('weather.wind'), c.wind + ' km/h'], [t('weather.rain'), (w.daily[0]?.rain ?? '-') + '%']].forEach(([k, v]) => { const d = document.createElement('div'); const b = document.createElement('b'); b.textContent = v; d.append(b, k); st.append(d); });
  const fh = document.createElement('h3'); fh.textContent = t('weather.forecast');
  const days = document.createElement('div'); days.className = 'days';
  w.daily.forEach((d) => { const e = document.createElement('div'); e.className = 'day'; const dt = new Date(d.date + 'T00:00'); const k = wxKey(d.code);
    e.textContent = `${dt.toLocaleDateString(getLang() === 'en' ? 'en-IN' : LANG_META[getLang()].speech, { weekday: 'short', day: 'numeric' })} ${WX_ICON[k]} ${Math.round(d.max)}°/${Math.round(d.min)}° · 💧${d.rain ?? '-'}%`; days.append(e); });
  const tips = []; const d0 = w.daily[0] || {};
  if (w.daily.slice(0, 3).some((d) => (d.rain ?? 0) >= 60)) tips.push('tip.rain');
  if (w.daily.slice(0, 3).some((d) => d.max >= 38)) tips.push('tip.heat');
  if (c.wind >= 25) tips.push('tip.wind');
  if (!tips.length) tips.push('tip.ok');
  const th = document.createElement('div'); th.className = 'warn'; th.textContent = t('weather.tips') + ': ' + tips.map((k) => t(k)).join(' ');
  const src = document.createElement('div'); src.className = 'srcline';
  src.textContent = `${t('weather.source')}: ${w.source} · ${t('weather.updated')}: ${new Date(w.fetchedAt).toLocaleString()}`;
  const ask = document.createElement('button'); ask.className = 'btn primary'; ask.textContent = '🎙️ ' + t('weather.ask');
  ask.onclick = () => send(t('weather.askPrompt', { w: '' }).trim());
  card.append(top, st, fh, days, th, src, ask); out.append(card); void d0;
}
async function getWeather(params) {
  const out = $('#wOut'); out.innerHTML = ''; const l = document.createElement('div'); l.className = 'small'; l.textContent = t('weather.loading'); out.append(l);
  try {
    const r = await fetch('/api/weather?' + new URLSearchParams({ ...params, lang: getLang() }));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'HTTP ' + r.status), { code: data.code });
    state.weather = data; renderWeather(data);
  } catch (e) {
    out.innerHTML = ''; const p = document.createElement('div'); p.className = 'notice error';
    p.textContent = e.code === 'notfound' ? t('weather.notfound') : e instanceof TypeError ? t('err.network') : t('weather.fail', { m: e.message }); out.append(p);
  }
}

/* ---------- settings + Bolna ---------- */
async function bolnaCall() {
  const out = $('#bOut'); out.textContent = t('voice.thinking'); $('#bCall').disabled = true;
  try {
    const r = await fetch('/api/bolna/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: $('#bPhone').value.trim(), name: state.profile.name }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    state.lastExecId = d.execution_id || ''; out.textContent = t('settings.callStarted', { id: state.lastExecId || '?' });
    $('#bCheck').hidden = !state.lastExecId;
  } catch (e) { out.textContent = t('settings.callFail', { m: e instanceof TypeError ? t('err.network') : e.message }); }
  $('#bCall').disabled = !state.status?.bolna.configured;
}
async function bolnaCheck() {
  try {
    const r = await fetch('/api/bolna/execution/' + encodeURIComponent(state.lastExecId)); const d = await r.json();
    if (!r.ok) throw new Error(d.error); $('#bOut').textContent = t('settings.callStatus', { s: d.status || '?' });
  } catch (e) { $('#bOut').textContent = t('settings.callFail', { m: e.message }); }
}

/* ---------- init ---------- */
async function init() {
  state.prefs = { ...state.prefs, ...load('kv_prefs', {}) };
  state.profile = { ...state.profile, ...load('kv_profile', {}) };
  const h = load('kv_history', []); state.history = Array.isArray(h) ? h.filter((m) => m && m.content) : [];
  $('#autoSpeak').checked = state.prefs.autoSpeak; $('#handsFree').checked = state.prefs.handsFree; $('#pRate').value = state.prefs.rate;
  $('#pName').value = state.profile.name; $('#pVillage').value = state.profile.village; $('#pCrops').value = state.profile.crops;

  $$('.lang').forEach((b) => b.addEventListener('click', () => changeLang(b.dataset.lang)));
  $$('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  $('#orb').addEventListener('click', () => { if (state.phase === 'speaking') stopSpeaking(); startListening(); });
  $('#stopBtn').addEventListener('click', stopSpeaking);
  $('#repeatBtn').addEventListener('click', () => { if (state.lastReply) speak(state.lastReply); else notice(t('voice.greeting'), 'warn'); });
  $('#newBtn').addEventListener('click', () => { stopSpeaking(); stopListening(); state.history = []; state.lastReply = ''; save('kv_history', []); renderChat(); clearNotice(); });
  $('#autoSpeak').addEventListener('change', (e) => { state.prefs.autoSpeak = e.target.checked; save('kv_prefs', state.prefs); if (!e.target.checked) stopSpeaking(); });
  $('#handsFree').addEventListener('change', (e) => { state.prefs.handsFree = e.target.checked; save('kv_prefs', state.prefs); });
  $('#composer').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#textIn').value; $('#textIn').value = ''; stopSpeaking(); send(v); });
  $$('[data-dictate]').forEach((b) => b.addEventListener('click', () => { const inp = $('#' + b.dataset.dictate); dictate(inp, b, b.dataset.dictate === 'cSpeak' ? parseField : null); }));
  $('#cSpeak').addEventListener('change', (e) => parseField(e.target.value));
  $('#cGo').addEventListener('click', cropsGo);
  $('#dImg').addEventListener('change', (e) => onImage(e.target.files[0]));
  $('#dForm').addEventListener('submit', diseaseSubmit);
  $('#wForm').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#wQ').value.trim(); if (q) getWeather({ q }); });
  $('#wHere').addEventListener('click', () => {
    if (!navigator.geolocation) return notice(t('weather.geoDenied'), 'warn');
    navigator.geolocation.getCurrentPosition((p) => getWeather({ lat: p.coords.latitude, lon: p.coords.longitude }), () => { $('#wOut').innerHTML = ''; const d = document.createElement('div'); d.className = 'notice'; d.textContent = t('weather.geoDenied'); $('#wOut').append(d); });
  });
  $('#sForm').addEventListener('submit', (e) => {
    e.preventDefault(); state.profile = { name: $('#pName').value.trim(), village: $('#pVillage').value.trim(), crops: $('#pCrops').value.trim() };
    state.prefs.rate = Number($('#pRate').value); save('kv_profile', state.profile); save('kv_prefs', state.prefs); $('#sMsg').textContent = t('settings.saved');
  });
  $('#bCall').addEventListener('click', bolnaCall); $('#bCheck').addEventListener('click', bolnaCheck);
  window.addEventListener('beforeunload', () => { stopSpeaking(); stopListening(); });

  changeLang(['en', 'mr', 'hi'].includes(state.prefs.lang) ? state.prefs.lang : 'en');
  const v = location.hash.slice(1); if (['voice', 'crops', 'disease', 'weather', 'settings'].includes(v)) showView(v);
  if (!SR) notice(t('err.unsupported'), 'warn');
  try { const r = await fetch('/api/status'); state.status = await r.json(); renderMode(); } catch { notice(t('err.network'), 'error'); }
}
init();
