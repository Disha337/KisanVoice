# 🌾 KisanVoice

**Farming help, just a conversation away.**

KisanVoice is a voice-first AI farming assistant for Indian farmers. A farmer speaks in **Marathi, Hindi or English**, hears a simple spoken answer, and keeps asking follow-up questions. Typing is optional, never required.

Built for **BUILDATHON by Bolna** (Voice AI).

| | |
|---|---|
| 🎥 Pitch deck | [Google Drive](https://drive.google.com/file/d/1O2XpGRlavXGfehYj8NOBxSRByf9d0df0/view?usp=sharing) | |
| 🌐 Live demo | [kisanvoice-32d8.onrender.com](https://kisanvoice-32d8.onrender.com/) |
| 👤 Team | Disha |

> **Reviewer note:** open the live demo in **Microsoft Edge or Chrome** and allow the microphone. The free server may take about a minute to wake up on the first visit. Edge has a natural Marathi voice built in; on Chrome, Marathi answers are read with a Hindi voice automatically.

## Why I built this

I'm a farmer's daughter from a village. I have watched my father struggle to get timely, understandable agricultural information. Language can be a barrier, apps can be complicated, and typing is slow. So I built KisanVoice: a simple assistant that lets farmers ask in their own language, by voice.

---

## 1. The problem

A farmer with a sick crop needs an answer now. Most digital tools assume typing, English, and a trip to an expert. KisanVoice makes **speaking** the whole interface.

## 2. Why voice is the product (not a feature)

- The first screen is a large microphone orb. There is no dashboard to learn first.
- Real speech is captured (browser speech recognition) with a live transcript, in `mr-IN`, `hi-IN` or `en-IN`.
- The answer is **spoken back**, with Stop and Repeat controls.
- Follow-ups work: the last messages are sent along, so "मला अजून काय काळजी घ्यावी लागेल?" or "How much water does it need?" is understood in context.
- Optional hands-free mode listens again after each answer.
- Every voice step has a visible text twin, and a typed fallback exists for when speech fails.
- Crop and disease pages also accept dictation, by speaking into the form fields.

## 3. The 90-second demo

1. Choose **मराठी**, tap the orb, say: **"माझ्या टोमॅटोच्या पानांवर काळे डाग पडले आहेत. मी काय करू?"**
2. See the live transcript, then a cautious Marathi answer that is also spoken.
3. Tap again: **"मला अजून काय काळजी घ्यावी लागेल?"** The answer builds on the earlier conversation.
4. Switch the language buttons to show the whole UI changing.
5. Weather tab: enter a village, get a **real** forecast, then tap *Ask the assistant what to do*.

## 4. Features

| Feature | How it works |
|---|---|
| Voice conversation | Web Speech API for input, `speechSynthesis` for output, server-side AI in between |
| 3 languages | Central translation file for the full UI; speech codes `en-IN`, `mr-IN`, `hi-IN` |
| Crop suggestions | Transparent **rule-based sample** scoring (season, soil, water); labelled as non-scientific |
| Disease help | Symptom text (typed or spoken) plus optional photo; always framed as preliminary guidance |
| Weather | **Real** data from Open-Meteo (no key), with source and fetch time shown |
| Bolna phone call | Settings page triggers a Bolna voice-agent call via Bolna's documented API (see status below) |
| Guest mode | No account or database needed; profile stays in the browser |

## 5. Responsible-AI choices

The system prompt and the UI enforce these:

- Symptom guidance is **never a diagnosis** and recommends an agricultural expert when unclear.
- **No invented doses or brand names.** The farmer is pointed to the product label and a local expert.
- **No invented live data:** no made-up weather, crop prices or scheme eligibility.
- **Demo mode is labelled.** Without an AI key the app shows a few fixed example answers badged "DEMO answer, not AI".
- A photo is analysed **only** when a real AI key is configured; otherwise the app says it was not analysed.
- API keys live only on the server; the browser never sees them. Requests are rate-limited.

## 6. Architecture

```
Farmer speaks ─► Browser SpeechRecognition (live transcript)
                      │
                      ▼
              Express server  /api/chat   (keys stay here)
                      │  system prompt + last 10 messages + optional profile/weather
                      ▼
        Gemini | OpenAI | Anthropic   (or labelled demo mode)
                      │
                      ▼
 Answer shown as text + spoken via speechSynthesis ─► follow-up question
```

Other routes: `/api/weather` (Open-Meteo), `/api/crops` (rules), `/api/bolna/*` (Bolna call + status).

**Stack:** Node.js, Express, vanilla JavaScript (no build step), Web Speech API. Providers: Google Gemini (default), OpenAI or Anthropic (set one key).

## 7. Honest status

| Area | Status |
|---|---|
| Server routes, error handling, demo mode, crop rules, translations | Covered by automated tests (`npm test`) and manual API checks |
| Voice conversation flow (listen → answer → speak → follow-up, error paths) | Verified in a simulated browser with fake speech APIs |
| Real microphone and speakers | Tested on a real device: voice input and spoken answers work. Marathi speech needs an installed voice (Edge has one; Chrome falls back to a Hindi voice). |
| Live AI answers | Tested on the live site with Gemini. |
| Bolna phone call | Tested live: a Bolna agent placed a call to my own verified phone number (`POST /call`, `GET /executions/{id}`). On my current Bolna account only verified numbers can receive calls, so this feature is **not open to other users** of the live site. |

**Known limits:** Marathi recognition quality varies by device. Marathi speech output needs an installed voice (Edge has one). Crop suggestions are samples, not agronomic advice. There is no live price data. KisanVoice has not yet been tested with real farmers.

## 8. Run it locally (Windows)

1. Install **Node.js LTS** (v18+) from https://nodejs.org.
2. In the project folder terminal:
   ```
   npm install
   copy .env.example .env
   npm start
   ```
3. Open **http://localhost:3000** in Edge or Chrome and allow the microphone.

It runs in **demo mode** with no keys. For real AI answers, put **one** key in `.env` (`GEMINI_API_KEY`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`) and restart.

### Environment variables

| Variable | Needed for |
|---|---|
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Real AI answers (one is enough) |
| `BOLNA_API_KEY`, `BOLNA_AGENT_ID` | Bolna phone-call demo (optional); `BOLNA_FROM_NUMBER` is optional |
| `PORT`, `HOST` | Optional server settings |

**Public deployments:** do not set the Bolna variables on a public site, or anyone could trigger calls on your credits.

### Works without any key
Voice input and output, text fallback, history and follow-ups (demo answers), crop suggestions, real weather, all three languages.

### Needs a key
Real AI answers, disease guidance, photo analysis, and the Bolna call.

## 9. Troubleshooting

- **"Speech recognition is not supported"**: use Chrome or Edge. Recognition also needs internet.
- **Mic denied**: click the lock icon in the address bar and allow Microphone. Only `localhost` or HTTPS can use the mic.
- **Marathi not spoken aloud**: Chrome often has no Marathi voice. The app falls back to a Hindi voice. Use Edge for a natural Marathi voice.
- **"Demo mode" badge**: no AI key was found. Check `.env` and restart the server.
- **Phone testing**: the mic needs HTTPS, so use the deployed link or an HTTPS tunnel.

## 10. What's next

- Open the Bolna phone-call agent to more farmers (needs a production Bolna account and a consent flow), so farmers without smartphones can use the same assistant.
- Natural Marathi voice output on every device.
- Verified agricultural information sources.
- Voice alerts for weather and local market information.
- Testing with real farmers.

## 11. Project layout

```
server.js        Express API and static hosting
lib/             ai.js, demo.js, crops.js, weather.js, bolna.js
public/          index.html, styles.css, app.js, i18n.js
tests/           automated tests
```

## 12. Disclaimer

KisanVoice provides general farming information only. It is not a substitute for a qualified agricultural expert. Always follow product labels and local guidance.
