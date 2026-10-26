"""Dental AI receptionist - LiveKit voice agent.

Speech-to-text: Deepgram Flux (default), Cartesia Ink-2 or Deepgram Nova-3.
Voice: Deepgram Aura-2, Cartesia Sonic 3.6 or ElevenLabs. Brain: Google Gemini.
All of these are picked in the admin panel (Settings -> AI receptionist).

From the project root:
    .venv\\Scripts\\python agent\\agent.py start            # what start.ps1 runs
"""

import asyncio
import json
import logging
import math
import os
import shlex  # noqa: F401  (imported lazily mid-call by a dependency otherwise - ~0.4 s stall)
import sys
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from dotenv import load_dotenv

AGENT_DIR = Path(__file__).resolve().parent
load_dotenv(AGENT_DIR.parent / ".env")
sys.path.insert(0, str(AGENT_DIR))
# Keep downloaded models inside the project instead of the user profile.
os.environ.setdefault("HF_HOME", str(AGENT_DIR.parent / ".cache" / "huggingface"))
# Turn detection now comes from Flux / Ink-2 themselves, or LiveKit's cloud detector for Nova-3.
# Don't preload the local turn model (~250 MB RAM, and slow to load on startup).
os.environ.setdefault("LIVEKIT_AGENTS_PRELOAD_LOCAL_INFERENCE", "0")

from livekit import api, rtc  # noqa: E402
from livekit.agents import (  # noqa: E402
    NOT_GIVEN,
    Agent,
    AgentSession,
    JobContext,
    JobProcess,
    NotGivenOr,
    RunContext,
    TurnHandlingOptions,
    WorkerOptions,
    cli,
    function_tool,
    get_job_context,
    inference,
    room_io,
)
from livekit.agents import llm as lk_llm  # noqa: E402
from livekit.agents import tts as lk_tts  # noqa: E402
from livekit.agents.utils import is_given  # noqa: E402

try:  # imported lazily by dependencies on first use - mid-call that froze the audio loop (0.4-0.7 s)
    import httpcore._async.socks_proxy  # noqa: E402, F401
    import tqdm.auto  # noqa: E402, F401
except ImportError:  # pragma: no cover
    pass

# Every plugin must be imported here: LiveKit only allows plugin registration on the main
# thread, and on Windows each call runs on a worker thread.
from livekit.plugins import anthropic, cartesia, deepgram, elevenlabs, google, openai, silero  # noqa: E402
from livekit.plugins.anthropic import llm as anthropic_llm  # noqa: E402
from livekit.plugins.cartesia.models import TTSDefaultVoiceId as CARTESIA_DEFAULT_VOICE  # noqa: E402

from clinic_api import ClinicAPI  # noqa: E402
from prompts import build_instructions, render_greeting  # noqa: E402
from language import ONE_MOMENT, VoiceLanguage, detect_language, first_sentence_ready  # noqa: E402
from spoken_text import SpokenTextFilter  # noqa: E402

try:  # LiveKit Cloud background voice cancellation (optional)
    from livekit.plugins import noise_cancellation
except ImportError:  # pragma: no cover
    noise_cancellation = None

logger = logging.getLogger("receptionist")
logger.setLevel(logging.INFO)


def _env_flag(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() not in ("0", "false", "no", "off")


BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
AGENT_API_KEY = os.getenv("AGENT_API_KEY", "dev-agent-key")
AGENT_NAME = os.getenv("AGENT_NAME", "")
# Background-noise filter on the caller's audio (LiveKit Cloud):
#   nc  = standard noise cancellation (default) - removes noise, keeps every word
#   bvc = background *voice* cancellation - stronger, but it clipped the start of words in tests
#   off = none (the browser already does basic noise suppression)
# Phone calls always use the telephony-tuned filter unless this is "off".
_nc = os.getenv("NOISE_CANCELLATION", "nc").strip().lower()
NOISE_CANCELLATION_MODE = {"true": "nc", "1": "nc", "false": "off", "0": "off", "no": "off"}.get(_nc, _nc)
# Off by default: patient calls are health data, so don't upload recordings to LiveKit Cloud unless asked.
RECORD_SESSIONS = _env_flag("RECORD_SESSIONS", False)

# LiveKit queues only 200 ms of Sophie's audio ahead; any hiccup longer than that (busy laptop,
# TTS audio arriving late from Deepgram) leaves a gap you hear as a crackle. Buffer more: it never
# delays the start of speech and is cleared instantly when she's interrupted.
AUDIO_OUTPUT_BUFFER_MS = int(os.getenv("AUDIO_OUTPUT_BUFFER_MS", "1000"))
from livekit.agents.voice.room_io import _output as _room_output  # noqa: E402

_orig_output_init = _room_output._ParticipantAudioOutput.__init__


def _buffered_output_init(self, room, *, sample_rate, num_channels, **kwargs):  # type: ignore[no-untyped-def]
    _orig_output_init(self, room, sample_rate=sample_rate, num_channels=num_channels, **kwargs)
    self._audio_source = rtc.AudioSource(sample_rate, num_channels, queue_size_ms=AUDIO_OUTPUT_BUFFER_MS)


_room_output._ParticipantAudioOutput.__init__ = _buffered_output_init
# Drafting replies before the caller finishes is faster, but sends extra LLM requests.
# Turn off if a free-tier rate limit (HTTP 429) is hit.
PREEMPTIVE_GENERATION = _env_flag("PREEMPTIVE_GENERATION", True)

DEFAULT_MODEL = "gemini-3.5-flash-lite"
# Lowest thinking level each Gemini model accepts (thinking adds delay before the first word).
# Source: https://ai.google.dev/gemini-api/docs/thinking - models not listed keep their default.
GEMINI_THINKING_LEVEL = {
    "gemini-3.5-flash-lite": "minimal",
    "gemini-3.6-flash": "minimal",
    "gemini-3-flash-preview": "minimal",
    "gemini-3.8-flash": "low",
    "gemini-3.1-pro-preview": "low",
    "gemini-4-argon": "low",
}

# Claude 4.6+ models reject a trailing assistant message (prefill). The plugin only knows the
# 4.6 names, so teach it about the newer families too.
anthropic_llm._NO_PREFILL_PATTERNS = tuple(
    dict.fromkeys(
        (*anthropic_llm._NO_PREFILL_PATTERNS, "claude-opus-4-7", "claude-opus-4-8", "claude-opus-5",
         "claude-sonnet-5", "claude-haiku-5", "claude-fable", "claude-mythos")
    )
)


class ClaudeLLM(anthropic.LLM):
    """Claude tuned for real-time voice.

    Thinking adds delay before the first spoken word, and the LiveKit plugin does not pass
    thinking blocks back between tool calls - so turn it off where the model allows it
    (Haiku 5.5) and keep effort low where it can't be disabled (Sonnet/Opus 5.x).
    """

    def __init__(self, *, model: str) -> None:
        super().__init__(model=model, caching="ephemeral", max_tokens=1024)
        if model.startswith("claude-haiku-5"):
            self._request_extras: dict[str, Any] = {"thinking": {"type": "disabled"}}
        elif model.startswith(("claude-sonnet-5", "claude-opus-5", "claude-opus-4-7", "claude-opus-4-8", "claude-fable")):
            self._request_extras = {"output_config": {"effort": "low"}}
        else:
            self._request_extras = {}

    def chat(self, *, extra_kwargs: NotGivenOr[dict[str, Any]] = NOT_GIVEN, **kwargs: Any):  # type: ignore[override]
        merged = dict(self._request_extras)
        if is_given(extra_kwargs):
            merged.update(extra_kwargs)
        return super().chat(extra_kwargs=merged, **kwargs)

FALLBACK_MESSAGE = (
    "Hello, thank you for calling. I'm really sorry, our booking system is unavailable right now. "
    "Please call back in a few minutes. Goodbye."
)


# ---------------------------------------------------------------- per-call state


class CallState:
    def __init__(self, caller_number: str, channel: str) -> None:
        self.caller_number = caller_number
        self.channel = channel
        self.call_id: Optional[int] = None
        self.patient_id: Optional[int] = None
        self.actions: list[dict] = []
        self.transcript: list[dict] = []
        self.started = time.monotonic()

    def record(self, tool: str, ok: bool, summary: str, args: Optional[dict] = None) -> None:
        self.actions.append({"tool": tool, "ok": ok, "summary": summary[:300], "args": args or {}})


def _json(data: Any) -> str:
    return json.dumps(data, default=str, ensure_ascii=False)


async def hang_up() -> None:
    job_ctx = get_job_context()
    try:
        await job_ctx.api.room.delete_room(api.DeleteRoomRequest(room=job_ctx.room.name))
    except Exception as e:  # room may already be gone
        logger.warning("could not delete room: %s", e)


# ---------------------------------------------------------------- the receptionist

# Said when the model goes straight to a lookup without speaking first, so the caller isn't left
# in silence while Sophie "checks the system" (the lookup plus her answer take ~2-4 s).
TOOL_FILLERS = {
    "check_availability": "Let me just have a look for you.",
    "lookup_patient": "Let me just find your details.",
    "register_patient": "Lovely, let me just pop you on the system.",
    "get_patient_appointments": "Let me just pull up your appointments.",
    "book_appointment": "Let me get that booked in for you.",
    "reschedule_appointment": "Let me just move that for you.",
    "cancel_appointment": "Let me just sort that out for you.",
    "take_message": "Let me just note that down.",
}

# Gemini rejects a tool call in the conversation history that carries no signature from the model
# (HTTP 400). A call rebuilt from text has none, so it gets Google's documented "skip" value.
SKIP_THOUGHT_SIGNATURE = b"skip_thought_signature_validator"


def _tool_schemas(tools: list) -> dict[str, dict]:
    """name -> JSON schema of the arguments, for every tool the model may call."""
    schemas: dict[str, dict] = {}
    for tool in tools:
        try:
            if isinstance(tool, lk_llm.RawFunctionTool):
                schemas[tool.info.name] = tool.info.raw_schema.get("parameters") or {}
            elif isinstance(tool, lk_llm.FunctionTool):
                schema = lk_llm.utils.build_legacy_openai_schema(tool, internally_tagged=True)
                schemas[schema["name"]] = schema.get("parameters") or {}
        except Exception:  # an odd tool must not break the reply
            continue
    return schemas


def _coerce_args(args: dict, schema: dict) -> dict:
    """Written-out calls give every value as text: turn "false" into False, "12" into 12, etc.
    Phone numbers and other text fields stay text (keeping leading zeros)."""
    props = schema.get("properties") or {}
    out: dict[str, Any] = {}
    for key, value in args.items():
        if props and key not in props:
            continue
        kind = (props.get(key) or {}).get("type")
        if isinstance(kind, list):
            kind = next((k for k in kind if k != "null"), None)
        if isinstance(value, str):
            text = value.strip()
            try:
                if kind == "boolean":
                    value = text.lower() in ("true", "yes", "1")
                elif kind == "integer":
                    value = int(text)
                elif kind == "number":
                    value = float(text)
            except ValueError:
                pass
        out[key] = value
    return out


class Receptionist(Agent):
    def __init__(
        self, *, instructions: str, clinic: ClinicAPI, state: CallState, boot: dict, voice: VoiceLanguage
    ) -> None:
        super().__init__(instructions=instructions)
        self.clinic = clinic
        self.state = state
        self.boot = boot
        self.voice = voice

    async def tts_node(self, text, model_settings):
        """Switches the voice to the language of this reply before Sophie starts speaking.

        Waits for the first sentence (the voice works sentence by sentence anyway, so this adds no
        delay), detects its language, then hands the whole reply to the voice."""
        stream = text.__aiter__()
        head = ""
        done = False
        while not first_sentence_ready(head):
            try:
                head += await stream.__anext__()
            except StopAsyncIteration:
                done = True
                break
        self.voice.update_from(head)

        async def whole_reply():
            if head:
                yield head
            if not done:
                async for chunk in stream:
                    yield chunk

        async for frame in Agent.default.tts_node(self, whole_reply(), model_settings):
            yield frame

    def _caller_language(self, chat_ctx: lk_llm.ChatContext) -> str:
        """Language of the caller's last message, falling back to the call's current language."""
        for item in reversed(chat_ctx.items):
            if getattr(item, "role", None) == "user":
                return detect_language(getattr(item, "text_content", None) or "") or self.voice.current
        return self.voice.current

    async def llm_node(self, chat_ctx: lk_llm.ChatContext, tools: list, model_settings: Any):
        """Cleans up the model's reply before Sophie says it.

        - Tags such as <speak> are removed, and a tool call the model wrote out as text is run for
          real instead of being read aloud (see spoken_text.py). The cleaned text is also what goes
          into the conversation history, so the model doesn't copy its own slip on later turns.
        - If the model calls a tool without saying anything first, a short "let me check" is added.
          It is part of the same reply, so it always plays before the result, is dropped together
          with the reply if the caller keeps talking, and shows in the transcript.
        """
        guard = SpokenTextFilter()
        spoke = False
        called: set[str] = set()
        language = self._caller_language(chat_ctx)

        def filler_for(tool_name: str) -> str | None:
            nonlocal spoke
            if spoke:
                return None
            spoke = True
            if language != "en":
                text = ONE_MOMENT.get(language)
            else:
                text = TOOL_FILLERS.get(tool_name)
            return text + " " if text else None

        async for chunk in Agent.default.llm_node(self, chat_ctx, tools, model_settings):
            if isinstance(chunk, str):
                text = guard.feed(chunk)
                spoke = spoke or bool(text.strip())
                if text:
                    yield text
                continue
            if isinstance(chunk, lk_llm.ChatChunk) and chunk.delta is not None:
                delta = chunk.delta
                if delta.content:
                    text = guard.feed(delta.content)
                    spoke = spoke or bool(text.strip())
                    if text != delta.content:
                        chunk = chunk.model_copy(update={"delta": delta.model_copy(update={"content": text})})
                if delta.tool_calls:
                    called.update(call.name for call in delta.tool_calls)
                    if filler := filler_for(delta.tool_calls[0].name):
                        yield filler
            yield chunk

        tail = guard.finish()
        if tail:
            spoke = spoke or bool(tail.strip())
            yield tail
        if guard.removed:
            logger.warning("removed markup the model wrote into Sophie's reply")

        schemas = _tool_schemas(tools) if guard.calls else {}
        for call in guard.calls:
            if call.name not in schemas or call.name in called:
                logger.warning("ignored a tool call written as text: %s", call.name)
                continue
            called.add(call.name)
            call_id = f"text_call_{uuid.uuid4().hex[:12]}"
            try:
                signatures = getattr(self.session.llm, "_thought_signatures", None)
            except RuntimeError:  # no running session (offline tests)
                signatures = None
            if isinstance(signatures, dict):
                signatures[call_id] = SKIP_THOUGHT_SIGNATURE
            if filler := filler_for(call.name):
                yield filler
            logger.warning("the model wrote a tool call as text - running %s for real", call.name)
            yield lk_llm.ChatChunk(
                id=call_id,
                delta=lk_llm.ChoiceDelta(
                    role="assistant",
                    tool_calls=[
                        lk_llm.FunctionToolCall(
                            name=call.name,
                            arguments=json.dumps(_coerce_args(call.args, schemas[call.name])),
                            call_id=call_id,
                        )
                    ],
                ),
            )

    # -- availability -------------------------------------------------------

    @function_tool()
    async def check_availability(
        self,
        context: RunContext,
        treatment: str,
        date: str = "",
        doctor: str = "",
        time_of_day: str = "",
    ) -> str:
        """Check free appointment times. Always use this before offering a time.

        Args:
            treatment: The treatment name from the clinic's list, e.g. "Routine Check-up" or "Emergency Appointment".
            date: The day to check, as YYYY-MM-DD. Leave empty to find the next available days.
            doctor: Optional doctor name if the caller has a preference.
            time_of_day: Optional "morning", "afternoon" or "evening".
        """
        args = {"service": treatment, "date": date or None, "doctor": doctor or None, "time_of_day": time_of_day or None}
        res = await self.clinic.request("POST", "/api/agent/availability", args)
        times = len(res.get("available_times") or [])
        self.state.record(
            "check_availability",
            bool(res.get("ok")),
            res.get("error") or f"{res.get('service')} on {res.get('day', 'next available days')}: {times} times offered",
            args,
        )
        return _json(res)

    # -- patients -----------------------------------------------------------

    @function_tool()
    async def lookup_patient(
        self,
        context: RunContext,
        first_name: str = "",
        last_name: str = "",
        date_of_birth: str = "",
        phone: str = "",
    ) -> str:
        """Find an existing patient's record. Ask for their full name and date of birth first.

        Args:
            first_name: Patient's first name.
            last_name: Patient's surname.
            date_of_birth: Date of birth as YYYY-MM-DD.
            phone: Phone number if the caller gave one. The caller ID is used automatically when empty.
        """
        args = {
            "first_name": first_name or "",
            "last_name": last_name or "",
            "date_of_birth": date_of_birth or "",
            "phone": phone or self.state.caller_number,
        }
        res = await self.clinic.request("POST", "/api/agent/patients/lookup", args)
        found = res.get("patients") or []
        if len(found) == 1:
            self.state.patient_id = found[0]["patient_id"]
        self.state.record(
            "lookup_patient",
            bool(found),
            f"Found {found[0]['name']}" if len(found) == 1 else f"{len(found)} matching records",
            {k: v for k, v in args.items() if k != "phone"},
        )
        return _json(res)

    @function_tool()
    async def register_patient(
        self,
        context: RunContext,
        first_name: str,
        last_name: str,
        phone: str,
        date_of_birth: str,
        email: str = "",
    ) -> str:
        """Register a new patient. Confirm the spelling of their name and their mobile number first.

        Args:
            first_name: First name.
            last_name: Surname.
            phone: Mobile number.
            date_of_birth: Date of birth as YYYY-MM-DD.
            email: Optional email address.
        """
        args = {
            "first_name": first_name,
            "last_name": last_name,
            "phone": phone or self.state.caller_number,
            "date_of_birth": date_of_birth or None,
            "email": email or "",
            "call_id": self.state.call_id,
        }
        res = await self.clinic.request("POST", "/api/agent/patients", args)
        if res.get("ok") and res.get("patient_id"):
            self.state.patient_id = res["patient_id"]
        self.state.record(
            "register_patient",
            bool(res.get("ok")),
            res.get("error") or ("Already registered" if res.get("already_registered") else f"Registered {first_name} {last_name}"),
            {"first_name": first_name, "last_name": last_name},
        )
        return _json(res)

    @function_tool()
    async def get_patient_appointments(self, context: RunContext, patient_id: int) -> str:
        """List a verified patient's upcoming appointments (with their appointment_id).

        Args:
            patient_id: The patient_id from lookup_patient.
        """
        res = await self.clinic.request("GET", f"/api/agent/patients/{patient_id}/appointments")
        self.state.record("get_patient_appointments", bool(res.get("ok")), f"{len(res.get('upcoming') or [])} upcoming")
        return _json(res)

    # -- bookings -----------------------------------------------------------

    @function_tool()
    async def book_appointment(
        self,
        context: RunContext,
        patient_id: int,
        treatment: str,
        date: str,
        time: str,
        doctor: str = "",
        notes: str = "",
    ) -> str:
        """Book an appointment once the caller has agreed a specific day and time.

        Args:
            patient_id: The patient_id from lookup_patient or register_patient.
            treatment: The treatment name, e.g. "Scale & Polish".
            date: Day as YYYY-MM-DD.
            time: Start time as HH:MM in 24-hour format, e.g. "14:30".
            doctor: Doctor name if one was chosen. Leave empty for whoever is free.
            notes: Short note for the dentist, e.g. symptoms the caller mentioned.
        """
        args = {
            "patient_id": patient_id,
            "service": treatment,
            "date": date,
            "time": time,
            "doctor": doctor or None,
            "notes": notes or "",
            "call_id": self.state.call_id,
        }
        res = await self.clinic.request("POST", "/api/agent/appointments", args)
        if res.get("ok"):
            self.state.patient_id = patient_id
        self.state.record(
            "book_appointment",
            bool(res.get("ok")),
            res.get("error") or f"{res.get('service')} with {res.get('doctor')}, {res.get('when')}",
            args,
        )
        return _json(res)

    @function_tool()
    async def reschedule_appointment(
        self,
        context: RunContext,
        patient_id: int,
        appointment_id: int,
        new_date: str,
        new_time: str,
        doctor: str = "",
    ) -> str:
        """Move an existing appointment to a new day/time the caller has agreed to.

        Args:
            patient_id: The verified patient's id.
            appointment_id: The appointment to move (from get_patient_appointments).
            new_date: New day as YYYY-MM-DD.
            new_time: New start time as HH:MM (24-hour).
            doctor: Optional doctor name if they want someone else.
        """
        args = {"patient_id": patient_id, "date": new_date, "time": new_time, "doctor": doctor or None}
        res = await self.clinic.request("POST", f"/api/agent/appointments/{appointment_id}/reschedule", args)
        self.state.record(
            "reschedule_appointment",
            bool(res.get("ok")),
            res.get("error") or f"Moved from {res.get('previous_time')} to {res.get('when')}",
            {**args, "appointment_id": appointment_id},
        )
        return _json(res)

    @function_tool()
    async def cancel_appointment(self, context: RunContext, patient_id: int, appointment_id: int, reason: str = "") -> str:
        """Cancel an appointment after the caller has confirmed which one.

        Args:
            patient_id: The verified patient's id.
            appointment_id: The appointment to cancel (from get_patient_appointments).
            reason: Short reason, if given.
        """
        args = {"patient_id": patient_id, "reason": reason or ""}
        res = await self.clinic.request("POST", f"/api/agent/appointments/{appointment_id}/cancel", args)
        self.state.record(
            "cancel_appointment",
            bool(res.get("ok")),
            res.get("error") or f"Cancelled {res.get('service')} on {res.get('when')}",
            {**args, "appointment_id": appointment_id},
        )
        return _json(res)

    # -- people ---------------------------------------------------------------

    @function_tool()
    async def take_message(
        self,
        context: RunContext,
        caller_name: str,
        phone: str,
        message: str,
        category: Literal["appointment", "complaint", "issue", "general"],
        urgent: bool = False,
    ) -> str:
        """Leave a message for the clinic team to call the caller back (anything you can't sort out yourself).

        Args:
            caller_name: Caller's full name.
            phone: Best number to call back on.
            message: What they need, in one or two sentences.
            category: "appointment" for anything about a booking (missing, wrong, can't find a time, wants to
                change it), "complaint" if they are unhappy with the clinic, its staff or their treatment,
                "issue" for any other problem to sort out (billing, payments, insurance, records, a problem after
                treatment), "general" for questions and other call-back requests.
            urgent: True if it can't wait: severe pain, swelling, bleeding, a broken or knocked-out tooth, or
                they need a call back today.
        """
        if not self.boot["agent"].get("allow_messages", True):
            return _json({"ok": False, "error": "Taking messages is turned off. Ask them to call back during opening hours."})
        args = {
            "caller_name": caller_name,
            "phone": phone or self.state.caller_number,
            "message": message,
            "category": category,
            "urgency": "urgent" if urgent else "normal",
            "patient_id": self.state.patient_id,
            "call_id": self.state.call_id,
        }
        res = await self.clinic.request("POST", "/api/agent/messages", args)
        self.state.record(
            "take_message",
            bool(res.get("ok")),
            message,
            {"category": res.get("category", category), "urgent": res.get("urgent", urgent)},
        )
        return _json(res)

    @function_tool()
    async def transfer_to_staff(self, context: RunContext, reason: str) -> str:
        """Transfer a phone call to a human member of staff. Tell the caller you're putting them through first.

        Args:
            reason: Why the caller needs a person.
        """
        number = (self.boot["clinic"].get("transfer_number") or "").strip()
        if not self.boot["agent"].get("allow_transfer") or not number or self.state.channel != "phone":
            return _json({"ok": False, "error": "Transfers aren't available. Offer to take a message instead."})
        job_ctx = get_job_context()
        sip = next(
            (p for p in job_ctx.room.remote_participants.values() if p.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP),
            None,
        )
        if not sip:
            return _json({"ok": False, "error": "No phone caller to transfer. Offer to take a message instead."})
        await context.wait_for_playout()
        try:
            await job_ctx.api.sip.transfer_sip_participant(
                api.TransferSIPParticipantRequest(
                    room_name=job_ctx.room.name,
                    participant_identity=sip.identity,
                    transfer_to=number if number.startswith(("tel:", "sip:")) else f"tel:{number}",
                    play_dialtone=False,
                )
            )
        except Exception as e:
            logger.exception("transfer failed")
            self.state.record("transfer_to_staff", False, str(e))
            return _json({"ok": False, "error": "The transfer didn't go through. Apologise and offer to take a message."})
        self.state.record("transfer_to_staff", True, reason)
        return _json({"ok": True})

    @function_tool()
    async def end_call(self, context: RunContext) -> None:
        """Hang up. Only use this after you have said goodbye and the caller has nothing else."""
        self.state.record("end_call", True, "Call ended by receptionist")
        await context.wait_for_playout()
        await hang_up()


# ---------------------------------------------------------------- model builders


STT_LABELS = {
    "deepgram-flux": "Deepgram Flux",
    "cartesia-ink-2": "Cartesia Ink-2",
    "deepgram-nova-3": "Deepgram Nova-3",
}
CARTESIA_INK_LANGUAGES = {"en", "fr", "hi", "ja", "es"}


def _keyterms(boot: dict) -> list[str]:
    """Names the recogniser would otherwise mishear: the caller's own name first (when caller ID
    matches a patient), then the clinic, doctor and treatment names."""
    caller = boot.get("caller") or {}
    terms = [p.get("name") or "" for p in caller.get("patients") or []]
    terms.append(boot["clinic"]["name"])
    terms += [d["name"].replace("Dr ", "").strip() for d in boot["doctors"]]
    terms += [s["name"] for s in boot["services"]]
    return list(dict.fromkeys(t for t in terms if t))[:40]


def build_stt(settings: dict, boot: dict) -> tuple[Any, Any, str]:
    """Returns (speech-to-text, turn detection, label) for the engine picked in Settings.

    Flux and Ink-2 detect the end of the caller's turn themselves (from how they speak, not
    just silence), so no separate turn model is needed. Nova-3 uses LiveKit's cloud turn detector.
    """
    choice = (settings.get("stt_model") or "deepgram-flux").strip()
    language = (settings.get("stt_language") or "en").strip()
    terms = _keyterms(boot)
    # Early "probably finished" signal lets Sophie start drafting her reply sooner.
    eager = 0.4 if PREEMPTIVE_GENERATION else NOT_GIVEN

    if choice == "cartesia-ink-2":
        if os.getenv("CARTESIA_API_KEY"):
            base = language.split("-")[0].lower()
            return (
                cartesia.STT(
                    model="ink-2",
                    language=base if base in CARTESIA_INK_LANGUAGES else "en",
                    keyterm=terms,
                    turn_eager_end_threshold=eager,
                ),
                "stt",
                STT_LABELS[choice],
            )
        logger.warning("Cartesia Ink-2 picked but CARTESIA_API_KEY is missing - using Deepgram Flux")
        choice = "deepgram-flux"

    if choice == "deepgram-nova-3":
        opts: dict[str, Any] = dict(
            model="nova-3", language=language, smart_format=True, punctuate=True, interim_results=True
        )
        if language != "multi":
            opts["keyterm"] = terms
        # Cloud-hosted LiveKit turn model; if it's unreachable, turns end on the silence timer.
        return deepgram.STT(**opts), inference.TurnDetector(version="v1", local_fallback=False), STT_LABELS[choice]

    model = "flux-general-multi" if language == "multi" else "flux-general-en"
    return deepgram.STTv2(model=model, keyterm=terms, eager_eot_threshold=eager), "stt", STT_LABELS["deepgram-flux"]


def build_llm(settings: dict, credentials: Any = None):
    """Gemini by default (free tier via a Google AI Studio key, or Vertex AI when
    GOOGLE_GENAI_USE_VERTEXAI=true). Claude and OpenAI models stay available as paid options."""
    model = (settings.get("llm_model") or DEFAULT_MODEL).strip()
    if model.startswith(("gemini", "gemma")):
        extra: dict[str, Any] = {}
        level = GEMINI_THINKING_LEVEL.get(model)
        if level:
            extra["thinking_config"] = {"thinking_level": level}
        if credentials is not None:
            extra["credentials"] = credentials
        return google.LLM(model=model, max_output_tokens=1024, **extra)
    if model.startswith("claude"):
        return ClaudeLLM(model=model)
    return openai.LLM(model=model)


FALLBACK_VOICE = "aura-2-pandora-en"  # Deepgram's British female voice


def build_tts(settings: dict) -> tuple[Any, str, VoiceLanguage]:
    """Returns (text-to-speech, label, language switcher). Cartesia/ElevenLabs get Deepgram as an
    automatic backup, so a bad voice ID or a provider outage never leaves the caller in silence.
    Cartesia and ElevenLabs can speak other languages; the Deepgram voices are English only."""
    provider = settings.get("tts_provider") or "deepgram"
    voice = (settings.get("tts_voice") or "").strip()
    model = (settings.get("tts_model") or "").strip()
    speed = float(settings.get("tts_speed") or 1.0)
    backup = deepgram.TTS(model=FALLBACK_VOICE)

    if provider == "cartesia" and os.getenv("CARTESIA_API_KEY"):
        primary = cartesia.TTS(
            model=model or "sonic-3.6",
            voice=voice or CARTESIA_DEFAULT_VOICE,
            language="en",
            speed=speed if abs(speed - 1.0) > 0.01 else None,
        )
        label = f"Cartesia {model or 'sonic-3.6'}"
        return lk_tts.FallbackAdapter([primary, backup]), label, VoiceLanguage("cartesia", primary)
    if provider == "elevenlabs" and voice and (os.getenv("ELEVEN_API_KEY") or os.getenv("ELEVENLABS_API_KEY")):
        primary = elevenlabs.TTS(voice_id=voice, model=model or "eleven_flash_v2_5")
        label = f"ElevenLabs {model or 'eleven_flash_v2_5'}"
        return lk_tts.FallbackAdapter([primary, backup]), label, VoiceLanguage("elevenlabs", primary)
    if provider != "deepgram":
        logger.warning("voice provider %s is not configured (missing key or voice) - using Deepgram", provider)
    primary = deepgram.TTS(model=voice if voice.startswith("aura") else FALLBACK_VOICE)
    return primary, "Deepgram Aura-2", VoiceLanguage("deepgram")


# ---------------------------------------------------------------- entrypoint


# Last model used by this worker. Lets each call start building the LLM straight away,
# in parallel with connecting, instead of waiting for the clinic settings first.
_llm_model_hint = DEFAULT_MODEL

# Preparing Gemini is slow and blocking: creating the client loads TLS certificates (~1 s on
# Windows) and Vertex AI loads + refreshes credentials with a synchronous HTTP call (~2 s).
# On the audio loop that froze the caller's audio (crackling, dropped words), and it delayed
# every call by ~3-4 s. So: one shared Google sign-in per worker (refreshed ahead of expiry),
# and the next call's client is always built in the background before the phone rings.
_prep_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="llm-prep")
_prepared: dict[str, Future] = {}
_prepared_lock = threading.Lock()
_google_creds: Any = None
_google_creds_lock = threading.Lock()


def _uses_vertex_ai() -> bool:
    return os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").strip().lower() in ("1", "true")


def _google_credentials() -> Any:
    """Shared Vertex AI credentials, refreshed when within 10 minutes of expiry. Thread-only."""
    global _google_creds
    if not _uses_vertex_ai():
        return None
    import google.auth
    from google.auth.transport.requests import Request

    with _google_creds_lock:
        for attempt in (1, 2):
            if _google_creds is None:
                _google_creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
            expiry = getattr(_google_creds, "expiry", None)  # naive UTC
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            try:
                if not _google_creds.valid or (expiry is not None and expiry - now < timedelta(minutes=10)):
                    _google_creds.refresh(Request())
                return _google_creds
            except Exception:
                # e.g. the sign-in expired and `gcloud auth application-default login` has since been
                # run: drop the cached sign-in and read the fresh one from disk, once.
                _google_creds = None
                if attempt == 2:
                    raise
        return _google_creds


def _prepare_llm(model: str) -> tuple[Any, Optional[Exception]]:
    """Runs in a background thread: Google sign-in + client creation, off the audio loop."""
    credentials = None
    if model.startswith(("gemini", "gemma")):
        try:
            credentials = _google_credentials()
        except Exception as e:
            logger.error("Google sign-in failed (%s). Run: gcloud auth application-default login", str(e)[:200])
    try:
        return build_llm({"llm_model": model}, credentials=credentials), None
    except Exception as e:  # usually a missing API key
        return None, e


def _prefetch_llm(model: str) -> None:
    """Start building an LLM for the next call (no-op if one is already on its way)."""
    with _prepared_lock:
        if model not in _prepared:
            _prepared[model] = _prep_pool.submit(_prepare_llm, model)


async def _take_llm(model: str) -> tuple[Any, Optional[Exception]]:
    """A ready LLM for this call (usually instant), then pre-build one for the next call."""
    with _prepared_lock:
        future = _prepared.pop(model, None)
    if future is None:
        future = _prep_pool.submit(_prepare_llm, model)
    llm_instance, error = await asyncio.wrap_future(future)
    if llm_instance is not None and model.startswith(("gemini", "gemma")):
        # The client may have been built a while ago - make sure the shared token is still fresh,
        # and rebuild if the sign-in was replaced (e.g. after a fresh gcloud login).
        try:
            creds = await asyncio.to_thread(_google_credentials)
            api_client = getattr(getattr(llm_instance, "_client", None), "_api_client", None)
            if creds is not None and api_client is not None and api_client._credentials is not creds:
                llm_instance, error = await asyncio.wrap_future(_prep_pool.submit(_prepare_llm, model))
        except Exception as e:
            logger.error("Google sign-in failed (%s). Run: gcloud auth application-default login", str(e)[:200])
    _prefetch_llm(model)
    return llm_instance, error


async def warm_up_llm(llm_instance: Any) -> None:
    """Send a 1-token request while the greeting plays: the first Gemini request of a call is
    slow (~6 s cold vs ~0.8 s warm on Vertex), so the caller's first question shouldn't pay it.
    Credentials are already fresh (see _prepare_llm), so this never blocks the loop."""
    client = getattr(llm_instance, "_client", None)
    model = str(getattr(llm_instance, "model", ""))
    if client is None or not hasattr(client, "aio") or not model.startswith(("gemini", "gemma")):
        return
    started = time.perf_counter()
    config: dict[str, Any] = {"max_output_tokens": 1}
    if GEMINI_THINKING_LEVEL.get(model):
        config["thinking_config"] = {"thinking_level": GEMINI_THINKING_LEVEL[model]}
    try:
        await asyncio.wait_for(client.aio.models.generate_content(model=model, contents="Hi", config=config), 20)
        logger.info("LLM warm-up done in %.1fs (%s)", time.perf_counter() - started, model)
    except Exception as e:
        logger.warning("LLM warm-up failed (%s): %s", model, str(e)[:200])


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()
    _prefetch_llm(_llm_model_hint)  # first call gets a ready-made Gemini client
    detect_language("Hello, how are you today?")  # loads the language detector before the first call


async def entrypoint(ctx: JobContext) -> None:
    global _llm_model_hint
    ctx.log_context_fields = {"room": ctx.room.name}
    t0 = time.perf_counter()
    marks: dict[str, float] = {}
    # Pick up the pre-built LLM (or finish building it) while we connect - it overlaps with everything below.
    llm_task = asyncio.ensure_future(_take_llm(_llm_model_hint))

    clinic = ClinicAPI(BACKEND_URL, AGENT_API_KEY)
    await ctx.connect()
    marks["connect"] = time.perf_counter() - t0

    participant = await ctx.wait_for_participant()
    marks["caller"] = time.perf_counter() - t0
    is_phone = participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP
    caller_number = participant.attributes.get("sip.phoneNumber") or participant.attributes.get("caller_number", "")
    state = CallState(caller_number=caller_number, channel="phone" if is_phone else "web")

    boot, started = await asyncio.gather(
        clinic.bootstrap(caller_number),
        clinic.request(
            "POST",
            "/api/agent/calls/start",
            {"room_name": ctx.room.name, "channel": state.channel, "caller_number": caller_number},
        ),
    )
    state.call_id = started.get("call_id")
    marks["bootstrap"] = time.perf_counter() - t0

    vad = ctx.proc.userdata["vad"]
    llm_instance, llm_error = await llm_task
    if boot is not None:
        wanted = (boot["agent"].get("llm_model") or DEFAULT_MODEL).strip()
        if wanted != _llm_model_hint:  # the model was changed in Settings since the last call
            _llm_model_hint = wanted
            llm_instance, llm_error = await _take_llm(wanted)
    marks["llm"] = time.perf_counter() - t0
    if llm_error is not None:
        logger.error("cannot create the language model (%s) - check the keys in .env: %s", _llm_model_hint, llm_error)

    if boot is None or llm_instance is None:
        # Backend down or no LLM key: apologise with a plain voice and hang up rather than leaving silence.
        session = AgentSession(stt=deepgram.STT(), tts=deepgram.TTS(model="aura-2-pandora-en"), vad=vad)
        await session.start(agent=Agent(instructions="Apologise and end the call."), room=ctx.room, record=False)
        await session.say(FALLBACK_MESSAGE, allow_interruptions=False)
        await hang_up()
        return

    settings = boot["agent"]
    caller = boot.get("caller") or {}
    if len(caller.get("patients") or []) == 1:
        state.patient_id = caller["patients"][0]["patient_id"]

    stt_instance, turn_detection, stt_label = build_stt(settings, boot)
    tts_instance, tts_label, voice_language = build_tts(settings)
    logger.info("call setup: listening with %s, voice %s, brain %s", stt_label, tts_label, _llm_model_hint)
    session = AgentSession(
        stt=stt_instance,
        llm=llm_instance,
        tts=tts_instance,
        vad=vad,
        max_tool_steps=6,  # check availability -> look up -> register -> book needs more than the default 3
        aec_warmup_duration=1.5,  # default 3 s ignores (and drops) callers who talk early in her sentence
        turn_handling=TurnHandlingOptions(
            # Flux / Ink-2 decide when the caller has finished (from how they speak, not just silence);
            # Nova-3 uses LiveKit's cloud turn model plus a silence timer.
            turn_detection=turn_detection,
            endpointing=(
                {"mode": "fixed", "min_delay": 0.1, "max_delay": 2.5}
                if turn_detection == "stt"
                else {"mode": "dynamic", "min_delay": 0.4, "max_delay": 2.5}
            ),
            # "adaptive" = LiveKit's ML interruption model: "mm-hmm", coughs and speaker echo no longer
            # cut Sophie off mid-word (LiveKit only enables it by default in dev mode).
            interruption={
                "mode": "adaptive",
                "min_duration": 0.5,
                "false_interruption_timeout": 1.0,
                "resume_false_interruption": True,
                # keep the caller's words even while Sophie can't be interrupted (they were being dropped)
                "discard_audio_if_uninterruptible": False,
            },
            # Start the LLM *and* TTS while the caller is finishing their sentence.
            preemptive_generation={"enabled": PREEMPTIVE_GENERATION, "preemptive_tts": PREEMPTIVE_GENERATION},
        ),
    )

    @session.on("metrics_collected")
    def _on_metrics(ev) -> None:
        # One short line per stage (the full metrics dump is slow to print on a Windows console).
        m = ev.metrics
        kind = type(m).__name__
        if kind == "EOUMetrics":
            logger.info("latency | end of turn %.2fs (transcript %.2fs)", m.end_of_utterance_delay, m.transcription_delay)
        elif kind == "LLMMetrics":
            logger.info("latency | Gemini first token %.2fs", m.ttft)
        elif kind == "TTSMetrics":
            logger.info("latency | voice first audio %.2fs", m.ttfb)

    @session.on("error")
    def _on_error(ev) -> None:
        # e.g. the Gemini free tier's per-minute limit: apologise instead of going silent.
        if getattr(ev.error, "recoverable", True):
            return
        logger.error("unrecoverable %s error: %s", type(ev.source).__name__, ev.error)
        try:
            session.say(
                "I'm so sorry, I'm having a little trouble on my end. Could you say that again in a moment?",
                allow_interruptions=True,
            )
        except Exception:
            pass

    @session.on("conversation_item_added")
    def _on_item(ev) -> None:
        item = ev.item
        role = getattr(item, "role", None)
        text = (getattr(item, "text_content", None) or "").strip()
        if role in ("user", "assistant") and text:
            state.transcript.append({"role": role, "text": text})

    # Safety net for "she goes quiet after a tool call": LiveKit skips the tool reply when her
    # "let me check" line was cut off (echo, noise, "mm-hmm"). If nothing is said within a few
    # seconds of a tool finishing, prompt her to report the outcome.
    last_spoke = {"at": 0.0}

    @session.on("agent_state_changed")
    def _on_agent_state(ev) -> None:
        if ev.new_state == "speaking":
            last_spoke["at"] = time.monotonic()

    async def _ensure_followup(after: float) -> None:
        await asyncio.sleep(3.5)
        if last_spoke["at"] > after or session.agent_state != "listening" or session.user_state == "speaking":
            return
        logger.info("no reply after a tool call - prompting Sophie to report the result")
        session.generate_reply(
            instructions="Tell the caller the result of what you just did, in one or two short sentences."
        )

    @session.on("function_tools_executed")
    def _on_tools(ev) -> None:
        names = {call.name for call in ev.function_calls}
        if names & {"end_call", "transfer_to_staff"}:
            return
        asyncio.ensure_future(_ensure_followup(time.monotonic()))

    watchdog: Optional[asyncio.Task] = None
    warmup: Optional[asyncio.Task] = None

    async def finish_call() -> None:
        if watchdog:
            watchdog.cancel()
        if warmup and not warmup.done():
            warmup.cancel()
        if state.call_id:
            await clinic.request(
                "POST",
                f"/api/agent/calls/{state.call_id}/end",
                {"transcript": state.transcript, "actions": state.actions, "patient_id": state.patient_id},
            )
        await clinic.aclose()
        logger.info("call %s finished (%d turns, %d actions)", state.call_id, len(state.transcript), len(state.actions))

    ctx.add_shutdown_callback(finish_call)

    audio_input = room_io.AudioInputOptions()
    if noise_cancellation and NOISE_CANCELLATION_MODE != "off":
        if is_phone:
            nc_filter = noise_cancellation.BVCTelephony()
        elif NOISE_CANCELLATION_MODE == "bvc":
            nc_filter = noise_cancellation.BVC()
        else:
            nc_filter = noise_cancellation.NC()
        audio_input = room_io.AudioInputOptions(noise_cancellation=nc_filter)

    await session.start(
        agent=Receptionist(
            instructions=build_instructions(boot, state.channel),
            clinic=clinic,
            state=state,
            boot=boot,
            voice=voice_language,
        ),
        room=ctx.room,
        room_options=room_io.RoomOptions(audio_input=audio_input, delete_room_on_close=True),
        record=RECORD_SESSIONS,
    )
    marks["session"] = time.perf_counter() - t0
    # Fixed greeting = no LLM round-trip, so the caller hears a voice almost instantly.
    session.say(render_greeting(boot), allow_interruptions=True)
    warmup = asyncio.create_task(warm_up_llm(llm_instance))  # runs while the greeting plays
    logger.info(
        "call ready in %.2fs (%s)", marks["session"], ", ".join(f"{k} {v:.2f}s" for k, v in marks.items())
    )

    async def enforce_max_length() -> None:
        await asyncio.sleep(max(2, int(settings.get("max_call_minutes") or 15)) * 60)
        if voice_language.current == "en":
            handle = session.say(
                "I'm so sorry, I need to wrap up our call now. Please do call back if there's anything else. Goodbye!",
                allow_interruptions=False,
            )
        else:  # say it in the caller's language
            handle = session.generate_reply(
                instructions="Apologise that you need to end the call now, invite them to call back, and say goodbye.",
                allow_interruptions=False,
                tool_choice="none",
            )
        await handle.wait_for_playout()
        await hang_up()

    watchdog = asyncio.create_task(enforce_max_length())


def _load_threshold() -> float:
    # LiveKit stops sending calls to a worker once machine-wide CPU passes this (default 0.7 in
    # production). On a laptop running Chrome etc. that delayed calls by 10 s+, so locally we
    # always accept. On a dedicated server, set AGENT_LOAD_THRESHOLD=0.8 in .env.
    value = os.getenv("AGENT_LOAD_THRESHOLD", "").strip()
    try:
        return float(value) if value else math.inf
    except ValueError:
        return math.inf


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name=AGENT_NAME,
            load_threshold=_load_threshold(),
        )
    )
