import test from 'node:test';
import assert from 'node:assert/strict';
import { STR } from '../public/i18n.js';
import { recommend } from '../lib/crops.js';
import { demoReply } from '../lib/demo.js';
import { normalize, buildSystem, chat } from '../lib/ai.js';

test('translations have identical keys in en, mr, hi', () => {
  const k = (o) => Object.keys(o).sort().join('|');
  assert.equal(k(STR.mr), k(STR.en));
  assert.equal(k(STR.hi), k(STR.en));
  for (const l of ['en', 'mr', 'hi']) for (const [key, v] of Object.entries(STR[l])) assert.ok(v && v.trim(), `${l}.${key} empty`);
});

test('every crop id has a name in every language', () => {
  for (const l of ['en', 'mr', 'hi']) for (const id of ['jowar','bajra','soybean','cotton','tur','wheat','gram','sugarcane','onion','tomato','maize','groundnut']) assert.ok(STR[l]['crop.' + id]);
});

test('crop recommender: rabi + black + low water favours gram', () => {
  const r = recommend({ season: 'rabi', soil: 'black', water: 'low' });
  assert.ok(r.length > 0 && r.some((x) => x.id === 'gram'));
  assert.deepEqual(recommend({}), []);
});

test('demo: Marathi tomato question, then follow-up uses history', () => {
  const q1 = { role: 'user', content: 'माझ्या टोमॅटोच्या पानांवर काळे डाग पडले आहेत. मी काय करू?' };
  const a1 = demoReply({ messages: [q1], lang: 'mr' });
  assert.match(a1, /टोमॅटो/);
  const a2 = demoReply({ messages: [q1, { role: 'assistant', content: a1 }, { role: 'user', content: 'मला अजून काय काळजी घ्यावी लागेल?' }], lang: 'mr' });
  assert.match(a2, /आणखी काळजी/);
});

test('normalize merges same-role turns, drops leading assistant, requires user last', () => {
  const n = normalize([{ role: 'assistant', content: 'hi' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }]);
  assert.deepEqual(n, [{ role: 'user', content: 'a\nb' }]);
  assert.throws(() => normalize([{ role: 'assistant', content: 'x' }]));
  assert.throws(() => normalize('nope'));
});

test('system prompt carries language, no-invention and dosage rules', () => {
  const s = buildSystem({ lang: 'mr', mode: 'disease', context: { hasImage: true } });
  assert.match(s, /Marathi/); assert.match(s, /never invent doses/i); assert.match(s, /preliminary/); assert.match(s, /photo is attached/);
});

test('chat without any key returns clearly-labelled demo', async () => {
  for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY']) delete process.env[k];
  const r = await chat({ messages: [{ role: 'user', content: 'water?' }], lang: 'en' });
  assert.equal(r.source, 'demo'); assert.equal(r.provider, null);
});
