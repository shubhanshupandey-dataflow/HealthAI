# Handoff summary (2026-10-26)

Project: Adele Care AI receptionist "Sophie" (dental clinic). LiveKit voice agent + FastAPI backend + React admin panel.

## Running it
- Start everything: `powershell -ExecutionPolicy Bypass -File .\start.ps1` (stop: `.\stop.ps1`)
- Admin panel: http://localhost:8000. Agent log: `logs\agent.log`
- Python env: `.venv` (has `uv.exe` for installs)
- If Sophie only apologises and hangs up: run `gcloud auth application-default login` (Vertex sign-in expired)

## Rules from the user
- Demo must stay free: Gemini by default; paid models only as opt-in choices.
- Never change the Adele Care logo files; restyle around them.

## Current settings (in data/clinic.db, agent_settings)
- Speech-to-text: Cartesia Ink-2, caller language "multi"
- Voice: Cartesia sonic-3.6. Brain: gemini-3.5-flash-lite

## Done earlier: message categories
- Messages are tagged Appointment / Complaint / Issue / General, plus an Urgent flag.
- Sophie picks the category in `take_message`; an emergency safety net forces Urgent.
- Filters and tags on the Messages page, Dashboard and patient pages; staff can edit them.
- Backend logic: `backend/message_categories.py`.

## Done this session: multilingual replies
Calls start in English; Sophie switches to the caller's language (and back) for words and voice.
- `agent/language.py` (new): language detection (`fast-langdetect`, lite model), the
  `VoiceLanguage` switcher (Cartesia ~40 languages, ElevenLabs ~30, Deepgram English only),
  and translated "one moment" fillers.
- `agent/agent.py`: `Receptionist.tts_node` reads the first sentence of each reply, detects the
  language and switches the voice before speaking. Tool fillers use the caller's language.
  `build_tts` now returns `(tts, label, VoiceLanguage)`. The end-of-call wrap-up uses the
  caller's language. The detector is preloaded in `prewarm`.
- `agent/prompts.py`: new "# Language" section (overrides "British English"; native script;
  numbers as words; tool arguments and team messages in English).
- `requirements.txt`: added `fast-langdetect==1.1.0` (already installed in `.venv`).
- Tested offline (detection + voice switching). Agent restarted and registered.
  **Not yet tested on a live call.**

## Next steps
1. Live test: call Sophie, speak Hindi/Spanish, check she answers in that language with the right accent.
2. Keep "Caller language" on Multilingual in Settings (English-only options stop her understanding other languages).
3. Optional: per-language Deepgram Aura-2 voices if Deepgram is ever used as the main voice.
