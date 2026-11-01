// Bolna outbound call. Endpoints per official docs (bolna.ai/docs): POST /call, GET /executions/{id}.
const BASE = 'https://api.bolna.ai';
export const bolnaStatus = () => ({ configured: !!(process.env.BOLNA_API_KEY && process.env.BOLNA_AGENT_ID) });
function need() {
  if (!bolnaStatus().configured) { const e = new Error('Bolna is not configured (BOLNA_API_KEY / BOLNA_AGENT_ID missing)'); e.code = 'not_configured'; throw e; }
}
async function bolna(path, opts = {}) {
  const c = new AbortController(); const to = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(BASE + path, { ...opts, signal: c.signal, headers: { Authorization: `Bearer ${process.env.BOLNA_API_KEY}`, 'Content-Type': 'application/json' } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.message || data.detail || `Bolna returned HTTP ${r.status}`); e.code = 'upstream'; throw e; }
    return data;
  } finally { clearTimeout(to); }
}
export async function bolnaCall({ phone, name }) {
  need();
  if (!/^\+[1-9]\d{7,14}$/.test(phone || '')) { const e = new Error('Phone must be in international format, e.g. +919876543210'); e.code = 'bad_request'; throw e; }
  const body = { agent_id: process.env.BOLNA_AGENT_ID, recipient_phone_number: phone };
  if (process.env.BOLNA_FROM_NUMBER) body.from_phone_number = process.env.BOLNA_FROM_NUMBER;
  if (name) body.user_data = { farmer_name: String(name).slice(0, 60) };
  return bolna('/call', { method: 'POST', body: JSON.stringify(body) });
}
export async function bolnaExecution(id) {
  need();
  if (!/^[\w-]{6,80}$/.test(id || '')) { const e = new Error('Bad execution id'); e.code = 'bad_request'; throw e; }
  const d = await bolna('/executions/' + id);
  return { status: d.status, transcript: d.transcript, error_message: d.error_message };
}
