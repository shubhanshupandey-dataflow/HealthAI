# Dental AI Receptionist — LiveKit + Deepgram + Google Gemini

An AI phone receptionist ("Sophie", a warm British voice) for a dental hospital, plus a full admin panel.
The whole stack runs on free tiers for demos.

```
 Caller (phone / browser)
        │  audio
        ▼
 LiveKit Cloud ──► Voice agent (agent/agent.py)
                     Deepgram Flux / Cartesia Ink-2   → speech to text + "has the caller finished?"
                     Gemini 3.5 Flash-Lite            → understands + calls tools (free tier)
                     Deepgram Aura-2 / Cartesia Sonic → British female voice
                     LiveKit noise filter + adaptive interruptions
                        │ tool calls (HTTP, X-Agent-Key)
                        ▼
                  Backend API (backend/, FastAPI + SQLite)  ◄──  Admin panel (admin/, React)
```

**What the receptionist can do on a call:** check availability, find a patient (caller ID, name + date of birth),
register new patients, book / reschedule / cancel appointments, answer FAQs (hours, prices, parking, insurance),
handle emergencies safely (999 / A&E / NHS 111 guidance), take messages for staff, transfer to a human (phone),
and hang up politely.

**Admin panel:** dashboard, day calendar per doctor, appointment list + booking, patients (history, upcoming,
calls, messages), doctors (weekly hours with split shifts, time off, treatments), treatments & prices, AI call
logs with full transcripts, messages/call-backs, clinic settings, opening hours & holidays, and every AI setting
(name, greeting, personality, voice, model, language, permissions, knowledge base). Changes apply to the next call.

---

## 1. Keys you need (all free) — put them in `.env`

| Key | Where to get it | Cost for a demo |
|---|---|---|
| `GOOGLE_API_KEY` | https://aistudio.google.com/apikey | Free tier (no card) |
| `DEEPGRAM_API_KEY` | https://console.deepgram.com | Free $200 sign-up credit |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | https://cloud.livekit.io → project → Settings → Keys | Free "Build" plan |

Optional: `CARTESIA_API_KEY` (Ink-2 listening + Sonic 3.6 voices), `ELEVEN_API_KEY` (ElevenLabs voices),
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (paid models).

`.env` already exists with generated secrets — just paste the keys in. Restart the backend and agent after editing it.

### Free-tier notes
- **Use demo data only on the Gemini free tier.** Google's pricing page says free-tier content may be used to
  improve its products. For real patients, switch to a paid Gemini key or Vertex AI (no product-training use).
- Free-tier rate limits are per Google Cloud project (see aistudio.google.com/rate-limit). If a call ever says
  "I'm having a little trouble", set `PREEMPTIVE_GENERATION=false` in `.env` — it sends fewer requests per turn.
- Gemini 3.8 Flash (smarter, slightly slower) is also free — pick it in Settings → AI receptionist.

### Using Vertex AI instead of an API key (this machine is set up this way)
`.env` has (needs a Google Cloud project with billing or free-trial credits, and the Vertex AI API enabled):
```
GOOGLE_GENAI_USE_VERTEXAI=true
GOOGLE_CLOUD_PROJECT=dataflow-zone1
GOOGLE_CLOUD_LOCATION=global          # Gemini 3.5 Flash-Lite is only served on the global endpoint
```
Credentials come from `gcloud auth application-default login`. Your Google Workspace makes that sign-in
expire periodically — if calls apologise and the agent log says "Reauthentication is needed", run it again
(do it before every demo). For a server, use a service account instead:
`GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json` (never expires).

Measured on this machine (Vertex, global): Gemini answers in ~0.9–1.5 s; the first request of a call is ~6 s,
which the agent hides by warming Gemini up while the greeting plays.

## 2. Run it (Windows)

Everything is already installed on this machine (`.venv`, `admin/node_modules`, models in `.cache/`).

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1     # start everything
powershell -ExecutionPolicy Bypass -File .\stop.ps1      # stop everything
```

`start.ps1` opens the backend window (http://localhost:8000), the voice agent (minimised) and an
**agent log** window, then your browser. Wait for `registered worker` in the agent log (a few seconds) before calling.
Sign in with `admin@clinic.local` / `admin123` (change it in Settings → System & account), then click
**Talk to Sophie** in the sidebar — the assistant opens in a new tab: press *Call*, you hear UK ringing
until Sophie picks up, and the orb follows her voice.

The agent writes to `logs\agent.log` instead of its console on purpose: a Windows console that is slow
or paused (e.g. you click inside it) freezes the agent and makes the voice crackle. The log window is
safe to click or close. Each call logs `call ready in …` and per-turn `latency | …` lines; an
`event loop blocked` warning there means something is stalling the audio.

Manual start (from the project folder):

```powershell
.venv\Scripts\python -m uvicorn backend.main:app --port 8000     # API + admin panel
.venv\Scripts\python agent\agent.py start                         # voice agent (production mode)
npm --prefix admin run dev                                        # optional: admin hot-reload on :5173
```

### Fresh machine setup

```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
npm --prefix admin install
npm --prefix admin run build
copy .env.example .env                                  # then fill in the keys
```

## 3. How Sophie listens and sounds (Settings → AI receptionist)

| | Options | Notes |
|---|---|---|
| Speech recognition | **Deepgram Flux** (default), Cartesia Ink-2, Deepgram Nova-3 | Flux and Ink-2 decide when the caller has finished speaking themselves (~0.1 s); Nova-3 uses LiveKit's cloud turn detector |
| Voice | Deepgram Aura-2 (default: Pandora, British female), **Cartesia Sonic 3.6**, ElevenLabs | Cartesia shows a searchable list of British female voices with play buttons, plus a speed slider. "Hear the greeting" previews any choice |
| Brain | Gemini 3.5 Flash-Lite (default), other Gemini, Claude, OpenAI | |

Cartesia needs `CARTESIA_API_KEY` in `.env` (https://play.cartesia.ai/keys). If a Cartesia/ElevenLabs voice ever fails
mid-call, Sophie automatically continues with the Deepgram voice instead of going silent.

## 4. Real phone calls

1. In LiveKit Cloud → **Telephony**, get a phone number (or connect a Twilio/Telnyx SIP trunk).
2. Create a **dispatch rule** ("individual room per caller"). With `AGENT_NAME` empty, the agent joins every new
   room automatically. If you set `AGENT_NAME`, add the same name to the dispatch rule.
3. Call the number. The caller's number is matched to patient records automatically.
4. Optional: Settings → AI receptionist → *Transfer phone calls to staff* + your front-desk number (needs SIP
   REFER/transfer enabled on the trunk).

## 5. Why it's fast (measured on this laptop)

- Sophie picks up ~1–2 s after the call connects (agent setup ~0.8 s): the Gemini client and Google sign-in
  are prepared before the phone rings, and the CPU load limit that made LiveKit hold calls on a busy laptop
  is lifted (`AGENT_LOAD_THRESHOLD`). The browser plays UK ringback until she answers.
- A simple question is answered ~2–3 s after the caller stops talking; when she needs to look something up
  she says a short "let me just have a look for you" within ~3 s and always reports the result.
- Nothing slow runs on the audio loop (client creation, token refresh and lazy imports were moved off it),
  and 1 s of her speech is buffered ahead — this removed the crackling and dropped words.
- Deepgram Flux decides when the caller has finished from how they speak, not a silence timer; the caller's
  own name (from caller ID), doctor and treatment names are boosted so they're heard correctly.
- LiveKit's adaptive interruption model is on, so "mm-hmm", coughs and speaker echo don't cut Sophie off.
- Greeting is pre-written text → spoken instantly (no LLM round-trip).
- Gemini 3.5 Flash-Lite (Google's fastest current model) with thinking at its lowest level, short spoken replies.
- Preemptive generation: the LLM *and* voice start while the caller is finishing their sentence.
- Clinic facts, hours, doctors and a 15-day date table are in the prompt, so most questions need no tool call.
- Every call's latency (end of turn, Gemini first token, voice first audio) is written to `logs\agent.log`.

## 6. Useful commands

```powershell
.venv\Scripts\python -m backend.seed --reset    # wipe everything and reload the demo clinic
```

- Database: `data/clinic.db` (SQLite). Times are stored in the clinic's timezone (Settings → Clinic).
- Call recordings are **not** uploaded to LiveKit Cloud by default (health data). Set `RECORD_SESSIONS=true` in
  `.env` to turn LiveKit's session recording on.
- `NOISE_CANCELLATION=off` if you self-host LiveKit (the noise filter needs LiveKit Cloud).

## 7. Project layout

```
agent/      agent.py (LiveKit worker + 10 tools), prompts.py (system prompt), clinic_api.py
backend/    main.py, models.py, domain.py (availability engine), seed.py, routers/ (admin + agent APIs)
admin/      React + Vite + Tailwind admin panel (built into admin/dist, served by the backend)
data/       SQLite database
.cache/     tool caches (.cache\huggingface is no longer used and can be deleted)
```
