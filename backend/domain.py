"""Core clinic logic shared by the admin API and the voice-agent API:
lookups, fuzzy matching, availability and serialisation."""

import difflib
import re
from collections import OrderedDict
from datetime import date, datetime, time, timedelta
from typing import Iterable, Optional

from sqlmodel import Session, select

from . import timeutil
from .models import (
    AgentSettings,
    Appointment,
    CallLog,
    ClinicHours,
    ClinicSettings,
    Closure,
    Doctor,
    DoctorSchedule,
    DoctorService,
    DoctorTimeOff,
    Message,
    Patient,
    Service,
)

FREEING_STATUSES = ("cancelled",)  # statuses that do NOT occupy a slot
UPCOMING_STATUSES = ("scheduled", "confirmed")


# ---------------------------------------------------------------- settings


def get_clinic(session: Session) -> ClinicSettings:
    clinic = session.exec(select(ClinicSettings)).first()
    if clinic is None:
        clinic = ClinicSettings()
        session.add(clinic)
        session.commit()
        session.refresh(clinic)
    return clinic


def get_agent_settings(session: Session) -> AgentSettings:
    settings = session.exec(select(AgentSettings)).first()
    if settings is None:
        settings = AgentSettings()
        session.add(settings)
        session.commit()
        session.refresh(settings)
    return settings


# ---------------------------------------------------------------- matching


def phone_key(phone: str | None) -> str:
    digits = re.sub(r"\D", "", phone or "")
    return digits[-10:] if len(digits) >= 7 else digits


def _norm(text: str) -> str:
    text = (text or "").lower().replace("&", " and ")
    text = re.sub(r"\bdr\b\.?", " ", text)
    text = re.sub(r"\bdoctor\b", " ", text)
    text = re.sub(r"[^a-z0-9 ]", " ", text)
    return " ".join(text.split())


def _score(query: str, candidates: Iterable[str]) -> float:
    best = 0.0
    q_tokens = set(query.split())
    for raw in candidates:
        cand = _norm(raw)
        if not cand:
            continue
        if cand == query:
            return 1.0
        if query in cand or cand in query:
            best = max(best, 0.9)
        c_tokens = set(cand.split())
        if q_tokens and c_tokens:
            overlap = len(q_tokens & c_tokens) / len(q_tokens)
            if overlap:
                best = max(best, 0.5 + 0.4 * overlap)
        best = max(best, difflib.SequenceMatcher(None, query, cand).ratio())
    return best


NO_PREFERENCE = {"", "any", "anyone", "any doctor", "no preference", "none", "whoever", "first available"}


def find_service(session: Session, query: str | int | None) -> Optional[Service]:
    if query is None:
        return None
    services = session.exec(select(Service).where(Service.is_active == True)).all()  # noqa: E712
    raw = str(query).strip()
    if raw.isdigit():
        return next((s for s in services if s.id == int(raw)), None)
    q = _norm(raw)
    if not q:
        return None
    scored = sorted(
        ((_score(q, [s.name, *s.keywords.split(",")]), s) for s in services),
        key=lambda item: -item[0],
    )
    return scored[0][1] if scored and scored[0][0] >= 0.55 else None


def find_doctor(session: Session, query: str | int | None) -> Optional[Doctor]:
    if query is None:
        return None
    raw = str(query).strip()
    if raw.lower() in NO_PREFERENCE:
        return None
    doctors = session.exec(select(Doctor).where(Doctor.is_active == True)).all()  # noqa: E712
    if raw.isdigit():
        return next((d for d in doctors if d.id == int(raw)), None)
    q = _norm(raw)
    if not q:
        return None
    scored = sorted(
        ((_score(q, [d.name, *d.name.split(), d.title]), d) for d in doctors),
        key=lambda item: -item[0],
    )
    return scored[0][1] if scored and scored[0][0] >= 0.6 else None


# ---------------------------------------------------------------- availability


def clinic_window(session: Session, day: date) -> Optional[tuple[time, time]]:
    if session.exec(select(Closure).where(Closure.date == day)).first():
        return None
    hours = session.exec(select(ClinicHours).where(ClinicHours.weekday == day.weekday())).first()
    if not hours or not hours.is_open:
        return None
    return timeutil.parse_hm(hours.open_time), timeutil.parse_hm(hours.close_time)


def closure_reason(session: Session, day: date) -> Optional[str]:
    closure = session.exec(select(Closure).where(Closure.date == day)).first()
    return (closure.reason or "a closure day") if closure else None


def doctor_is_off(session: Session, doctor_id: int, day: date) -> bool:
    return (
        session.exec(
            select(DoctorTimeOff).where(
                DoctorTimeOff.doctor_id == doctor_id,
                DoctorTimeOff.start_date <= day,
                DoctorTimeOff.end_date >= day,
            )
        ).first()
        is not None
    )


def doctor_service_ids(session: Session, doctor_id: int) -> list[int]:
    return list(
        session.exec(select(DoctorService.service_id).where(DoctorService.doctor_id == doctor_id)).all()
    )


def doctors_for_service(session: Session, service_id: int) -> list[Doctor]:
    stmt = (
        select(Doctor)
        .join(DoctorService, DoctorService.doctor_id == Doctor.id)
        .where(DoctorService.service_id == service_id, Doctor.is_active == True)  # noqa: E712
        .order_by(Doctor.id)
    )
    return list(session.exec(stmt).all())


def doctor_blocks(session: Session, doctor_id: int, weekday: int) -> list[tuple[time, time]]:
    rows = session.exec(
        select(DoctorSchedule)
        .where(DoctorSchedule.doctor_id == doctor_id, DoctorSchedule.weekday == weekday)
        .order_by(DoctorSchedule.start_time)
    ).all()
    return [(timeutil.parse_hm(r.start_time), timeutil.parse_hm(r.end_time)) for r in rows]


def busy_intervals(
    session: Session, doctor_id: int, day: date, exclude_id: Optional[int] = None
) -> list[tuple[datetime, datetime]]:
    start = datetime.combine(day, time.min)
    end = start + timedelta(days=1)
    stmt = select(Appointment).where(
        Appointment.doctor_id == doctor_id,
        Appointment.start < end,
        Appointment.end > start,
        Appointment.status.not_in(FREEING_STATUSES),
    )
    if exclude_id:
        stmt = stmt.where(Appointment.id != exclude_id)
    return [(a.start, a.end) for a in session.exec(stmt).all()]


def compute_slots(
    session: Session,
    day: date,
    service: Service,
    doctor_id: Optional[int] = None,
    exclude_appointment_id: Optional[int] = None,
    respect_notice: bool = True,
) -> list[dict]:
    """All bookable start times on `day` for `service`, per doctor."""
    clinic = get_clinic(session)
    window = clinic_window(session, day)
    if not window:
        return []
    now = timeutil.now()
    if respect_notice:
        if day < now.date() or day > now.date() + timedelta(days=clinic.max_days_ahead):
            return []
    earliest = now + timedelta(minutes=clinic.min_notice_minutes) if respect_notice else None

    doctors = doctors_for_service(session, service.id)
    if doctor_id:
        doctors = [d for d in doctors if d.id == doctor_id]

    duration = timedelta(minutes=service.duration_minutes)
    step = timedelta(minutes=max(5, clinic.slot_interval_minutes or 15))
    slots: list[dict] = []
    for doc in doctors:
        if doctor_is_off(session, doc.id, day):
            continue
        busy = busy_intervals(session, doc.id, day, exclude_appointment_id)
        for block_start, block_end in doctor_blocks(session, doc.id, day.weekday()):
            start_t = max(block_start, window[0])
            end_t = min(block_end, window[1])
            cursor = datetime.combine(day, start_t)
            limit = datetime.combine(day, end_t)
            while cursor + duration <= limit:
                slot_end = cursor + duration
                if (earliest is None or cursor >= earliest) and not any(
                    s < slot_end and cursor < e for s, e in busy
                ):
                    slots.append(
                        {"start": cursor, "end": slot_end, "doctor_id": doc.id, "doctor_name": doc.name}
                    )
                cursor += step
    slots.sort(key=lambda s: (s["start"], s["doctor_id"]))
    return slots


def check_slot(
    session: Session,
    doctor: Doctor,
    service: Service,
    start: datetime,
    exclude_id: Optional[int] = None,
    respect_notice: bool = True,
) -> Optional[str]:
    """Return None when the slot is bookable, otherwise a human-readable reason."""
    clinic = get_clinic(session)
    day = start.date()
    end = start + timedelta(minutes=service.duration_minutes)
    reason = closure_reason(session, day)
    if reason:
        return f"The clinic is closed on {timeutil.spoken_date(day)} ({reason})."
    window = clinic_window(session, day)
    if not window:
        return f"The clinic is closed on {day.strftime('%A')}s."
    if respect_notice:
        now = timeutil.now()
        if start < now + timedelta(minutes=clinic.min_notice_minutes):
            return "That time is in the past or too soon to book."
        if day > now.date() + timedelta(days=clinic.max_days_ahead):
            return f"Appointments can only be booked up to {clinic.max_days_ahead} days ahead."
    if not doctor.is_active:
        return f"{doctor.name} is not currently taking appointments."
    if service.id not in doctor_service_ids(session, doctor.id):
        return f"{doctor.name} does not provide {service.name}."
    if doctor_is_off(session, doctor.id, day):
        return f"{doctor.name} is away on {timeutil.spoken_date(day)}."
    fits = False
    for block_start, block_end in doctor_blocks(session, doctor.id, day.weekday()):
        lo = datetime.combine(day, max(block_start, window[0]))
        hi = datetime.combine(day, min(block_end, window[1]))
        if lo <= start and end <= hi:
            fits = True
            break
    if not fits:
        return f"{doctor.name} is not working at {timeutil.spoken_time(start)} on {timeutil.spoken_date(day)}."
    for s, e in busy_intervals(session, doctor.id, day, exclude_id):
        if s < end and start < e:
            return f"{doctor.name} already has an appointment at that time."
    return None


TIME_OF_DAY = {
    "morning": (time(0, 0), time(12, 0)),
    "afternoon": (time(12, 0), time(17, 0)),
    "evening": (time(17, 0), time(23, 59)),
}


def group_slots(slots: list[dict], limit: int = 10, time_of_day: Optional[str] = None) -> list[dict]:
    """Collapse per-doctor slots into distinct times and spread them across the day."""
    window = TIME_OF_DAY.get((time_of_day or "").strip().lower())
    groups: "OrderedDict[datetime, list[str]]" = OrderedDict()
    for slot in slots:
        if window and not (window[0] <= slot["start"].time() < window[1]):
            continue
        groups.setdefault(slot["start"], []).append(slot["doctor_name"])
    items = list(groups.items())
    if len(items) > limit:
        stride = len(items) / limit
        items = [items[int(i * stride)] for i in range(limit)]
    return [
        {"time": timeutil.fmt_hm(start), "spoken": timeutil.spoken_time(start), "doctors": doctors}
        for start, doctors in items
    ]


# ---------------------------------------------------------------- serialisers


def patient_out(p: Patient) -> dict:
    return {
        "id": p.id,
        "first_name": p.first_name,
        "last_name": p.last_name,
        "full_name": f"{p.first_name} {p.last_name}".strip(),
        "phone": p.phone,
        "email": p.email,
        "date_of_birth": p.date_of_birth,
        "gender": p.gender,
        "address": p.address,
        "notes": p.notes,
        "source": p.source,
        "created_at": p.created_at,
    }


def appointments_out(session: Session, appts: Iterable[Appointment]) -> list[dict]:
    appts = list(appts)
    if not appts:
        return []
    patients = {
        p.id: p
        for p in session.exec(select(Patient).where(Patient.id.in_({a.patient_id for a in appts}))).all()
    }
    doctors = {
        d.id: d for d in session.exec(select(Doctor).where(Doctor.id.in_({a.doctor_id for a in appts}))).all()
    }
    services = {
        s.id: s
        for s in session.exec(select(Service).where(Service.id.in_({a.service_id for a in appts}))).all()
    }
    out = []
    for a in appts:
        p, d, s = patients.get(a.patient_id), doctors.get(a.doctor_id), services.get(a.service_id)
        out.append(
            {
                "id": a.id,
                "patient_id": a.patient_id,
                "patient_name": f"{p.first_name} {p.last_name}".strip() if p else "Unknown",
                "patient_phone": p.phone if p else "",
                "doctor_id": a.doctor_id,
                "doctor_name": d.name if d else "Unknown",
                "doctor_color": d.color if d else "#64748b",
                "service_id": a.service_id,
                "service_name": s.name if s else "Unknown",
                "price": s.price if s else 0,
                "start": a.start,
                "end": a.end,
                "status": a.status,
                "notes": a.notes,
                "source": a.source,
                "call_id": a.call_id,
                "cancel_reason": a.cancel_reason,
                "created_at": a.created_at,
            }
        )
    return out


def _patient_names(session: Session, ids: set) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = session.exec(select(Patient).where(Patient.id.in_(ids))).all()
    return {p.id: f"{p.first_name} {p.last_name}".strip() for p in rows}


def calls_out(session: Session, calls: Iterable[CallLog], include_transcript: bool = False) -> list[dict]:
    calls = list(calls)
    names = _patient_names(session, {c.patient_id for c in calls})
    out = []
    for c in calls:
        item = {
            "id": c.id,
            "room_name": c.room_name,
            "channel": c.channel,
            "caller_number": c.caller_number,
            "patient_id": c.patient_id,
            "patient_name": names.get(c.patient_id) if c.patient_id else None,
            "started_at": c.started_at,
            "ended_at": c.ended_at,
            "duration_seconds": c.duration_seconds,
            "status": c.status,
            "outcome": c.outcome,
            "summary": c.summary,
            "actions": c.actions or [],
            "turns": len(c.transcript or []),
        }
        if include_transcript:
            item["transcript"] = c.transcript or []
        out.append(item)
    return out


def messages_out(session: Session, messages: Iterable[Message]) -> list[dict]:
    messages = list(messages)
    names = _patient_names(session, {m.patient_id for m in messages})
    return [
        {
            "id": m.id,
            "caller_name": m.caller_name,
            "phone": m.phone,
            "message": m.message,
            "category": m.category or "general",
            "urgency": m.urgency,
            "status": m.status,
            "patient_id": m.patient_id,
            "patient_name": names.get(m.patient_id) if m.patient_id else None,
            "call_id": m.call_id,
            "created_at": m.created_at,
        }
        for m in messages
    ]
