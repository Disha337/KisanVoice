import { demoReply } from './demo.js';

const LANGS = {
  en: 'English (simple, clear Indian English)',
  mr: 'Marathi (मराठी) written in Devanagari script',
  hi: 'Hindi (हिन्दी) written in Devanagari script',
};
const MODELS = {
  anthropic: () => process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
  openai: () => process.env.OPENAI_MODEL || 'gpt-4o-mini',
  gemini: () => process.env.GEMINI_MODEL || 'gemini-3.8-flash',
};
const fail = (message, code, status) => Object.assign(new Error(message), { code, status });

export function provider() {
  const has = { anthropic: !!process.env.ANTHROPIC_API_KEY, openai: !!process.env.OPENAI_API_KEY, gemini: !!process.env.GEMINI_API_KEY };
  const want = (process.env.AI_PROVIDER || '').toLowerCase();
  if (want && has[want]) return want;
  return Object.keys(has).find((k) => has[k]) || null;
}
export function aiStatus() {
  const p = provider();
  return { configured: !!p, provider: p, model: p ? MODELS[p]() : null };
}

export function buildSystem({ lang = 'en', mode = 'chat', context = {} } = {}) {
  let s = `You are KisanVoice, a voice-first farming information assistant for small farmers in India.
Always reply in ${LANGS[lang] || LANGS.en}, even if the farmer mixes languages.
Your answer is read aloud: use plain sentences only. No markdown, no bullet symbols, no emojis, no tables. Keep it under about 90 words unless the question truly needs more.
Use simple everyday words. Avoid jargon; briefly explain any technical term you must use.
Use the earlier messages to understand follow-up questions such as "what should I do now?" or "how much water does it need?".
If important details are missing (crop, growth stage, location, soil, symptoms), give the safest general guidance first and then ask ONE short clarifying question.
Say clearly when advice is general and not specific to the farmer's location or field.
Never invent live data: current weather, market prices, or government scheme eligibility or amounts. If asked, say you cannot check live data here and suggest the local krishi kendra, the mandi, or the official website.
For pesticide, fungicide or fertilizer questions: never invent doses or brand names. Tell the farmer to follow the product label and consult a local agriculture officer or krishi vigyan kendra when crop, product or field details are unknown. Prefer low-risk practices first (field hygiene, spacing, water management, removing affected leaves).
Be honest about uncertainty. Suggest a qualified agricultural expert when symptoms are unclear, severe or spreading fast.
Only help with farming and closely related rural topics; politely steer other topics back to farming.`;
  if (mode === 'disease') {
    s += `\nThis is a crop symptom question. Say clearly that symptom-based guidance is preliminary and cannot confirm a diagnosis. Give likely possibilities (never certainties), what to check, and safe first steps.`;
    if (context.hasImage) s += ` A photo is attached: describe only what you can actually see and say if the photo is unclear.`;
  }
  const p = context.profile;
  if (p && (p.village || p.crops || p.name)) {
    s += `\nFarmer profile typed by the farmer (may be incomplete): name=${String(p.name || '').slice(0, 60)}; village or district=${String(p.village || '').slice(0, 80)}; usual crops=${String(p.crops || '').slice(0, 120)}.`;
  }
  if (context.weather) {
    s += `\nWeather data fetched by the app (use ONLY this for weather statements; mention its source and time): ${String(context.weather).slice(0, 900)}`;
  }
  return s;
}

export function normalize(messages) {
  if (!Array.isArray(messages)) throw fail('messages must be an array', 'bad_request');
  const out = [];
  for (const m of messages.slice(-12)) {
    if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim()) continue;
    const content = m.content.trim().slice(0, 2000);
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content += '\n' + content;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (!out.length || out[out.length - 1].role !== 'user') throw fail('The last message must be a question from the user', 'bad_request');
  return out;
}

async function post(url, headers, body) {
  const c = new AbortController();
  const to = setTimeout(() => c.abort(), 90000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: c.signal });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data?.error?.message || data?.message || `AI provider returned HTTP ${r.status}`;
      throw fail(msg, r.status === 401 || r.status === 403 ? 'auth' : r.status === 429 ? 'rate' : 'upstream', r.status);
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw fail('The AI provider timed out', 'upstream');
    if (e.code) throw e;
    throw fail('Could not reach the AI provider: ' + e.message, 'upstream');
  } finally { clearTimeout(to); }
}

const lastIdx = (a) => a.length - 1;

async function callAnthropic(system, msgs, image) {
  const messages = msgs.map((m) => ({ role: m.role, content: m.content }));
  if (image) messages[lastIdx(messages)].content = [
    { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data } },
    { type: 'text', text: msgs[lastIdx(msgs)].content },
  ];
  const d = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    { model: MODELS.anthropic(), max_tokens: 600, system, messages });
  return (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}
async function callOpenAI(system, msgs, image) {
  const messages = [{ role: 'system', content: system }, ...msgs.map((m) => ({ role: m.role, content: m.content }))];
  if (image) messages[lastIdx(messages)].content = [
    { type: 'text', text: msgs[lastIdx(msgs)].content },
    { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data}` } },
  ];
  const d = await post('https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    { model: MODELS.openai(), max_completion_tokens: 600, messages });
  return d.choices?.[0]?.message?.content || '';
}
async function callGemini(system, msgs, image) {
  const contents = msgs.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  if (image) contents[lastIdx(contents)].parts.push({ inlineData: { mimeType: image.mime, data: image.data } });
  const d = await post(`https://generativelanguage.googleapis.com/v1beta/models/${MODELS.gemini()}:generateContent`, { 'x-goog-api-key': process.env.GEMINI_API_KEY },
    { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: 600, temperature: 0.4 } });
  return (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}
const CALLERS = { anthropic: callAnthropic, openai: callOpenAI, gemini: callGemini };

export async function chat({ messages, lang = 'en', mode = 'chat', image = null, context = {} }) {
  const msgs = normalize(messages);
  lang = LANGS[lang] ? lang : 'en';
  if (image) {
    const okMime = ['image/jpeg', 'image/png', 'image/webp'].includes(image.mime);
    if (!okMime || typeof image.data !== 'string' || image.data.length > 5_500_000) throw fail('Unsupported or too large image', 'bad_request');
  }
  const p = provider();
  if (!p) return { reply: demoReply({ messages: msgs, lang }), source: 'demo', provider: null, imageAnalysed: false };
  const system = buildSystem({ lang, mode, context: { ...context, hasImage: !!image } });
  const reply = (await CALLERS[p](system, msgs, image)).trim();
  if (!reply) throw fail('The AI returned an empty answer', 'upstream');
  return { reply, source: 'ai', provider: p, imageAnalysed: !!image };
}
