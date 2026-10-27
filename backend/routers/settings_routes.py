from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, col, select

from .. import config, timeutil
from ..auth import require_admin
from ..db import get_session
from ..domain import get_agent_settings, get_clinic
from ..livekit_calls import web_call_token
from ..models import ClinicHours, Closure

router = APIRouter(prefix="/api", tags=["settings"], dependencies=[Depends(require_admin)])

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


class ClinicIn(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    website: Optional[str] = None
    timezone: Optional[str] = None
    currency_symbol: Optional[str] = None
    slot_interval_minutes: Optional[int] = None
    min_notice_minutes: Optional[int] = None
    max_days_ahead: Optional[int] = None
    emergency_info: Optional[str] = None
    knowledge_base: Optional[str] = None
    transfer_number: Optional[str] = None


class HoursIn(BaseModel):
    weekday: int
    is_open: bool
    open_time: str
    close_time: str


class ClosureIn(BaseModel):
    date: date
    reason: str = ""


class AgentIn(BaseModel):
    agent_name: Optional[str] = None
    greeting: Optional[str] = None
    personality: Optional[str] = None
    llm_model: Optional[str] = None
    tts_provider: Optional[str] = None
    tts_voice: Optional[str] = None
    tts_model: Optional[str] = None
    tts_speed: Optional[float] = None
    stt_model: Optional[str] = None
    stt_language: Optional[str] = None
    allow_booking: Optional[bool] = None
    allow_reschedule: Optional[bool] = None
    allow_cancel: Optional[bool] = None
    allow_registration: Optional[bool] = None
    allow_messages: Optional[bool] = None
    allow_transfer: Optional[bool] = None
    max_call_minutes: Optional[int] = None


class TokenIn(BaseModel):
    caller_name: str = "Web caller"
    caller_number: str = ""


# ---------------------------------------------------------------- clinic


@router.get("/settings/clinic")
def get_clinic_settings(session: Session = Depends(get_session)):
    return get_clinic(session).model_dump()


@router.put("/settings/clinic")
def update_clinic_settings(body: ClinicIn, session: Session = Depends(get_session)):
    clinic = get_clinic(session)
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    if "timezone" in data:
        try:
            from zoneinfo import ZoneInfo

            ZoneInfo(data["timezone"])
        except Exception:
            raise HTTPException(status_code=400, detail="Unknown timezone, use e.g. Europe/London")
    if "slot_interval_minutes" in data and not 5 <= data["slot_interval_minutes"] <= 120:
        raise HTTPException(status_code=400, detail="Slot interval must be between 5 and 120 minutes")
    for key, value in data.items():
        setattr(clinic, key, value)
    session.add(clinic)
    session.commit()
    session.refresh(clinic)
    timeutil.set_timezone(clinic.timezone)
    return clinic.model_dump()


@router.get("/settings/hours")
def get_hours(session: Session = Depends(get_session)):
    rows = {h.weekday: h for h in session.exec(select(ClinicHours)).all()}
    out = []
    for wd in range(7):
        h = rows.get(wd)
        out.append(
            {
                "weekday": wd,
                "day": WEEKDAYS[wd],
                "is_open": h.is_open if h else False,
                "open_time": h.open_time if h else "09:00",
                "close_time": h.close_time if h else "17:00",
            }
        )
    return out


@router.put("/settings/hours")
def set_hours(body: list[HoursIn], session: Session = Depends(get_session)):
    existing = {h.weekday: h for h in session.exec(select(ClinicHours)).all()}
    for item in body:
        if not 0 <= item.weekday <= 6:
            raise HTTPException(status_code=400, detail="Invalid weekday")
        try:
            open_t, close_t = timeutil.parse_hm(item.open_time), timeutil.parse_hm(item.close_time)
        except (ValueError, IndexError):
            raise HTTPException(status_code=400, detail="Times must look like 09:00")
        if item.is_open and open_t >= close_t:
            raise HTTPException(status_code=400, detail=f"{WEEKDAYS[item.weekday]}: opening must be before closing")
        row = existing.get(item.weekday) or ClinicHours(weekday=item.weekday)
        row.is_open = item.is_open
        row.open_time = timeutil.fmt_hm(open_t)
        row.close_time = timeutil.fmt_hm(close_t)
        session.add(row)
    session.commit()
    return get_hours(session)


@router.get("/settings/closures")
def list_closures(session: Session = Depends(get_session)):
    rows = session.exec(
        select(Closure).where(Closure.date >= timeutil.today()).order_by(col(Closure.date))
    ).all()
    return [r.model_dump() for r in rows]


@router.post("/settings/closures")
def add_closure(body: ClosureIn, session: Session = Depends(get_session)):
    if session.exec(select(Closure).where(Closure.date == body.date)).first():
        raise HTTPException(status_code=400, detail="That date is already marked as closed")
    row = Closure(date=body.date, reason=body.reason)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row.model_dump()


@router.delete("/settings/closures/{closure_id}")
def delete_closure(closure_id: int, session: Session = Depends(get_session)):
    row = session.get(Closure, closure_id)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    session.delete(row)
    session.commit()
    return {"ok": True}


# ---------------------------------------------------------------- AI receptionist


@router.get("/settings/agent")
def get_agent(session: Session = Depends(get_session)):
    return get_agent_settings(session).model_dump()


@router.put("/settings/agent")
def update_agent(body: AgentIn, session: Session = Depends(get_session)):
    settings = get_agent_settings(session)
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    if "tts_provider" in data and data["tts_provider"] not in ("deepgram", "elevenlabs", "cartesia"):
        raise HTTPException(status_code=400, detail="Voice provider must be deepgram, elevenlabs or cartesia")
    if "stt_model" in data and data["stt_model"] not in ("deepgram-flux", "cartesia-ink-2", "deepgram-nova-3"):
        raise HTTPException(status_code=400, detail="Speech recognition must be deepgram-flux, cartesia-ink-2 or deepgram-nova-3")
    if "tts_speed" in data and not 0.6 <= data["tts_speed"] <= 1.5:
        raise HTTPException(status_code=400, detail="Speaking speed must be between 0.6 and 1.5")
    for key, value in data.items():
        setattr(settings, key, value)
    settings.updated_at = timeutil.now()
    session.add(settings)
    session.commit()
    session.refresh(settings)
    return settings.model_dump()


# ---------------------------------------------------------------- system + test calls


@router.get("/system/status")
def system_status():
    return {
        "keys": config.configured_keys(),
        "gemini_via": "Vertex AI" if config.uses_vertex_ai() else "Gemini API key",
        "livekit_url": config.LIVEKIT_URL,
        "agent_name": config.AGENT_NAME or None,
        "timezone": timeutil.tz_name(),
        "server_time": timeutil.now(),
    }


@router.post("/livekit/token")
def create_test_call_token(body: TokenIn):
    return web_call_token(body.caller_name, body.caller_number)
