"""Endpoints used by the LiveKit voice agent's tool calls.

Responses are compact JSON written for an LLM that has to speak the result,
so they include ready-made spoken dates/times and clear error messages.
Protected by the shared X-Agent-Key header.
"""

import re
from datetime import date, datetime, time, timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel as _PydanticModel
from pydantic import model_validator
from sqlmodel import Session, col, select

from .. import timeutil
from ..auth import require_agent
from ..db import get_session
from ..domain import (
    UPCOMING_STATUSES,
    check_slot,
    clinic_window,
    closure_reason,
    compute_slots,
    doctor_blocks,
    doctor_service_ids,
    doctors_for_service,
    find_doctor,
    find_service,
    get_agent_settings,
    get_clinic,
    group_slots,
    phone_key,
)
from ..message_categories import CATEGORIES, categorize, looks_urgent
from ..models import Appointment, CallLog, ClinicHours, Doctor, Message, Patient, Service

router = APIRouter(prefix="/api/agent", tags=["voice-agent"], dependencies=[Depends(require_agent)])

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


class BaseModel(_PydanticModel):
    """LLM tool calls send null for optional text - treat that as empty instead of failing validation."""

    @model_validator(mode="before")
    @classmethod
    def _none_to_empty_text(cls, data):
        if isinstance(data, dict):
            return {
                key: ("" if value is None and key in cls.model_fields and cls.model_fields[key].annotation is str else value)
                for key, value in data.items()
            }
        return data


# ---------------------------------------------------------------- helpers


def parse_day(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    v = value.strip().lower()
    today = timeutil.today()
    if v == "today":
        return today
    if v == "tomorrow":
        return today + timedelta(days=1)
    try:
        return date.fromisoformat(v[:10])
    except ValueError:
        return None


def parse_clock(value: Optional[str]) -> Optional[time]:
    if not value:
        return None
    v = value.strip().lower().replace(".", ":").replace(" ", "")
    if v in ("noon", "midday", "12noon"):
        return time(12, 0)
    m = re.match(r"^(\d{1,2})(?::?(\d{2}))?(am|pm)?$", v)
    if not m:
        return None
    hour, minute, ampm = int(m.group(1)), int(m.group(2) or 0), m.group(3)
    if ampm == "pm" and hour < 12:
        hour += 12
    if ampm == "am" and hour == 12:
        hour = 0
    if not (0 <= hour < 24 and 0 <= minute < 60):
        return None
    return time(hour, minute)


def money(clinic, amount: float) -> str:
    if not amount:
        return "free"
    return f"{clinic.currency_symbol}{amount:,.0f}" if float(amount).is_integer() else f"{clinic.currency_symbol}{amount:,.2f}"


def appt_brief(session: Session, appt: Appointment) -> dict:
    doctor = session.get(Doctor, appt.doctor_id)
    service = session.get(Service, appt.service_id)
    return {
        "appointment_id": appt.id,
        "service": service.name if service else "Appointment",
        "doctor": doctor.name if doctor else "",
        "when": timeutil.spoken_datetime(appt.start),
        "date": appt.start.date().isoformat(),
        "time": timeutil.fmt_hm(appt.start),
        "status": appt.status,
    }


def upcoming_for(session: Session, patient_id: int, limit: int = 5) -> list[dict]:
    rows = session.exec(
        select(Appointment)
        .where(
            Appointment.patient_id == patient_id,
            Appointment.start >= timeutil.now(),
            col(Appointment.status).in_(UPCOMING_STATUSES),
        )
        .order_by(Appointment.start)
        .limit(limit)
    ).all()
    return [appt_brief(session, a) for a in rows]


def patient_brief(session: Session, p: Patient) -> dict:
    return {
        "patient_id": p.id,
        "name": f"{p.first_name} {p.last_name}".strip(),
        "date_of_birth": p.date_of_birth.isoformat() if p.date_of_birth else None,
        "phone_last_digits": re.sub(r"\D", "", p.phone)[-3:] if p.phone else None,
        "upcoming_appointments": upcoming_for(session, p.id),
    }


def service_names(session: Session) -> str:
    return ", ".join(s.name for s in session.exec(select(Service).where(Service.is_active == True)).all())  # noqa: E712


def doctor_names(session: Session) -> str:
    return ", ".join(d.name for d in session.exec(select(Doctor).where(Doctor.is_active == True)).all())  # noqa: E712


def find_next_days(
    session: Session,
    service: Service,
    doctor_id: Optional[int],
    start_day: date,
    time_of_day: Optional[str],
    days: int = 21,
    want: int = 3,
) -> list[dict]:
    found = []
    for i in range(days):
        d = start_day + timedelta(days=i)
        grouped = group_slots(compute_slots(session, d, service, doctor_id), limit=4, time_of_day=time_of_day)
        if grouped:
            found.append({"date": d.isoformat(), "day": timeutil.spoken_date(d), "times": grouped})
            if len(found) >= want:
                break
    return found


# ---------------------------------------------------------------- bootstrap


@router.get("/bootstrap")
def bootstrap(caller_number: str = "", session: Session = Depends(get_session)):
    clinic = get_clinic(session)
    agent = get_agent_settings(session)
    now = timeutil.now()

    hours = {h.weekday: h for h in session.exec(select(ClinicHours)).all()}
    opening = []
    for wd in range(7):
        h = hours.get(wd)
        if h and h.is_open:
            opening.append(
                {
                    "day": WEEKDAYS[wd],
                    "hours": f"{timeutil.spoken_time(timeutil.parse_hm(h.open_time))} to "
                    f"{timeutil.spoken_time(timeutil.parse_hm(h.close_time))}",
                }
            )
        else:
            opening.append({"day": WEEKDAYS[wd], "hours": "Closed"})

    calendar = []
    for i in range(15):
        d = now.date() + timedelta(days=i)
        window = clinic_window(session, d)
        reason = closure_reason(session, d)
        if window:
            status = f"open {timeutil.fmt_hm(window[0])}-{timeutil.fmt_hm(window[1])}"
        else:
            status = f"CLOSED ({reason})" if reason else "CLOSED"
        calendar.append({"date": d.isoformat(), "day": timeutil.spoken_date(d), "status": status})

    services = session.exec(
        select(Service).where(Service.is_active == True).order_by(Service.category, Service.name)  # noqa: E712
    ).all()
    service_by_id = {s.id: s for s in services}
    doctors = []
    for d in session.exec(select(Doctor).where(Doctor.is_active == True).order_by(Doctor.id)).all():  # noqa: E712
        days = sorted({wd for wd in range(7) if doctor_blocks(session, d.id, wd)})
        doctors.append(
            {
                "id": d.id,
                "name": d.name,
                "title": d.title,
                "bio": d.bio,
                "works_on": ", ".join(WEEKDAYS[wd] for wd in days) or "no regular days",
                "services": [service_by_id[sid].name for sid in doctor_service_ids(session, d.id) if sid in service_by_id],
            }
        )

    caller = None
    key = phone_key(caller_number)
    if key:
        matches = session.exec(select(Patient).where(Patient.phone_key == key).limit(5)).all()
        caller = {"number": caller_number, "patients": [patient_brief(session, p) for p in matches]}

    return {
        "now": now,
        "today_spoken": f"{timeutil.spoken_date(now)} {now.year}",
        "time_spoken": timeutil.spoken_time(now),
        "clinic": {
            "name": clinic.name,
            "phone": clinic.phone,
            "email": clinic.email,
            "address": clinic.address,
            "website": clinic.website,
            "timezone": clinic.timezone,
            "emergency_info": clinic.emergency_info,
            "knowledge_base": clinic.knowledge_base,
            "transfer_number": clinic.transfer_number,
            "currency_symbol": clinic.currency_symbol,
        },
        "agent": agent.model_dump(),
        "opening_hours": opening,
        "calendar": calendar,
        "services": [
            {
                "id": s.id,
                "name": s.name,
                "category": s.category,
                "duration_minutes": s.duration_minutes,
                "price": money(clinic, s.price),
                "description": s.description,
                "is_emergency": s.is_emergency,
            }
            for s in services
        ],
        "doctors": doctors,
        "caller": caller,
    }


# ---------------------------------------------------------------- availability


class AvailabilityIn(BaseModel):
    service: str
    date: Optional[str] = None
    doctor: Optional[str] = None
    time_of_day: Optional[str] = None


@router.post("/availability")
def availability(body: AvailabilityIn, session: Session = Depends(get_session)):
    clinic = get_clinic(session)
    service = find_service(session, body.service)
    if not service:
        return {"ok": False, "error": f"No service matches '{body.service}'. Services: {service_names(session)}"}
    doctor = find_doctor(session, body.doctor) if body.doctor else None
    if body.doctor and body.doctor.strip().lower() not in ("any", "anyone", "no preference", "") and not doctor:
        return {"ok": False, "error": f"No doctor matches '{body.doctor}'. Doctors: {doctor_names(session)}"}
    if doctor and service.id not in doctor_service_ids(session, doctor.id):
        others = ", ".join(d.name for d in doctors_for_service(session, service.id)) or "nobody at the moment"
        return {"ok": False, "error": f"{doctor.name} does not provide {service.name}. It is offered by: {others}."}

    result: dict = {
        "ok": True,
        "service": service.name,
        "duration_minutes": service.duration_minutes,
        "price": money(clinic, service.price),
        "doctor": doctor.name if doctor else "any available",
    }
    today = timeutil.today()
    day = parse_day(body.date)
    if body.date and not day:
        return {"ok": False, "error": "Date must be in YYYY-MM-DD format."}

    grouped: list = []
    if day:
        result["date"] = day.isoformat()
        result["day"] = timeutil.spoken_date(day)
        if day < today:
            result["note"] = "That date is in the past."
        else:
            grouped = group_slots(
                compute_slots(session, day, service, doctor.id if doctor else None), limit=8, time_of_day=body.time_of_day
            )
            result["available_times"] = grouped
            if not grouped:
                reason = closure_reason(session, day)
                if reason:
                    result["note"] = f"The clinic is closed that day ({reason})."
                elif not clinic_window(session, day):
                    result["note"] = f"The clinic is closed on {day.strftime('%A')}s."
                else:
                    result["note"] = "No free slots that day" + (f" in the {body.time_of_day}" if body.time_of_day else "") + "."
    if not grouped:
        start_day = max(today, day + timedelta(days=1)) if day else today
        result["next_available"] = find_next_days(
            session, service, doctor.id if doctor else None, start_day, body.time_of_day
        )
    return result


# ---------------------------------------------------------------- patients


class LookupIn(BaseModel):
    phone: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    date_of_birth: Optional[str] = None


@router.post("/patients/lookup")
def lookup_patient(body: LookupIn, session: Session = Depends(get_session)):
    candidates: list[Patient] = []
    first = (body.first_name or "").strip().lower()
    last = (body.last_name or "").strip().lower()
    key = phone_key(body.phone)
    if key:
        candidates = list(session.exec(select(Patient).where(Patient.phone_key == key).limit(10)).all())
        if candidates and (first or last):
            # The number may be shared (family) - keep only people whose name fits.
            candidates = [
                p for p in candidates
                if (not last or p.last_name.lower() == last) and (not first or p.first_name.lower().startswith(first))
            ]
    if not candidates and (body.last_name or body.first_name):
        stmt = select(Patient)
        if body.last_name:
            stmt = stmt.where(col(Patient.last_name).ilike(body.last_name.strip()))
        if body.first_name:
            stmt = stmt.where(col(Patient.first_name).ilike(f"{body.first_name.strip()}%"))
        candidates = list(session.exec(stmt.limit(10)).all())
    dob = parse_day(body.date_of_birth)
    if dob and candidates:
        # Never reveal a record whose date of birth contradicts what the caller said.
        exact = [p for p in candidates if p.date_of_birth == dob]
        candidates = exact or [p for p in candidates if p.date_of_birth is None]
    if not candidates:
        return {"ok": True, "found": 0, "patients": [], "note": "No matching patient record."}
    return {"ok": True, "found": len(candidates), "patients": [patient_brief(session, p) for p in candidates[:5]]}


class RegisterIn(BaseModel):
    first_name: str
    last_name: str = ""
    phone: str = ""
    date_of_birth: Optional[str] = None
    email: str = ""
    notes: str = ""
    call_id: Optional[int] = None


@router.post("/patients")
def register_patient(body: RegisterIn, session: Session = Depends(get_session)):
    if not get_agent_settings(session).allow_registration:
        return {"ok": False, "error": "Registering new patients by phone is turned off. Offer to take a message."}
    first, last = body.first_name.strip().title(), body.last_name.strip().title()
    if not first:
        return {"ok": False, "error": "First name is required."}
    key = phone_key(body.phone)
    if key:
        for p in session.exec(select(Patient).where(Patient.phone_key == key)).all():
            if p.first_name.lower() == first.lower():
                return {"ok": True, "already_registered": True, **patient_brief(session, p)}
    dob = parse_day(body.date_of_birth)
    patient = Patient(
        first_name=first,
        last_name=last,
        phone=body.phone.strip(),
        phone_key=key,
        email=body.email.strip(),
        date_of_birth=dob,
        notes=body.notes,
        source="ai_agent",
    )
    session.add(patient)
    session.commit()
    session.refresh(patient)
    return {"ok": True, "already_registered": False, "patient_id": patient.id, "name": f"{first} {last}".strip()}


@router.get("/patients/{patient_id}/appointments")
def patient_appointments(patient_id: int, session: Session = Depends(get_session)):
    patient = session.get(Patient, patient_id)
    if not patient:
        return {"ok": False, "error": "Patient not found."}
    return {"ok": True, "patient": f"{patient.first_name} {patient.last_name}".strip(), "upcoming": upcoming_for(session, patient_id, 10)}


# ---------------------------------------------------------------- bookings


class BookIn(BaseModel):
    patient_id: int
    service: str
    date: str
    time: str
    doctor: Optional[str] = None
    notes: str = ""
    call_id: Optional[int] = None


def _alternatives(session: Session, service: Service, day: date, doctor_id: Optional[int]) -> dict:
    same_day = group_slots(compute_slots(session, day, service, doctor_id), limit=6)
    if same_day:
        return {"other_times_that_day": same_day}
    return {"next_available": find_next_days(session, service, doctor_id, day + timedelta(days=1), None)}


@router.post("/appointments")
def book(body: BookIn, session: Session = Depends(get_session)):
    clinic = get_clinic(session)
    if not get_agent_settings(session).allow_booking:
        return {"ok": False, "error": "Booking by phone is turned off. Offer to take a message for the team."}
    patient = session.get(Patient, body.patient_id)
    if not patient:
        return {"ok": False, "error": "Unknown patient_id. Look the patient up or register them first."}
    service = find_service(session, body.service)
    if not service:
        return {"ok": False, "error": f"No service matches '{body.service}'. Services: {service_names(session)}"}
    day, clock = parse_day(body.date), parse_clock(body.time)
    if not day or not clock:
        return {"ok": False, "error": "Use date as YYYY-MM-DD and time as HH:MM (24 hour)."}
    start = datetime.combine(day, clock)

    doctor = find_doctor(session, body.doctor) if body.doctor else None
    if doctor:
        reason = check_slot(session, doctor, service, start)
        if reason:
            return {"ok": False, "error": reason, **_alternatives(session, service, day, doctor.id)}
    else:
        reasons = []
        for candidate in doctors_for_service(session, service.id):
            reason = check_slot(session, candidate, service, start)
            if reason is None:
                doctor = candidate
                break
            reasons.append(reason)
        if not doctor:
            return {
                "ok": False,
                "error": f"No one is free for {service.name} at {timeutil.spoken_datetime(start)}.",
                **_alternatives(session, service, day, None),
            }

    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor.id,
        service_id=service.id,
        start=start,
        end=start + timedelta(minutes=service.duration_minutes),
        status="scheduled",
        notes=body.notes,
        source="ai_agent",
        call_id=body.call_id,
    )
    session.add(appt)
    session.commit()
    session.refresh(appt)
    return {
        "ok": True,
        "booked": True,
        **appt_brief(session, appt),
        "patient": f"{patient.first_name} {patient.last_name}".strip(),
        "duration_minutes": service.duration_minutes,
        "price": money(clinic, service.price),
    }


class CancelIn(BaseModel):
    patient_id: int
    reason: str = ""


@router.post("/appointments/{appointment_id}/cancel")
def cancel(appointment_id: int, body: CancelIn, session: Session = Depends(get_session)):
    if not get_agent_settings(session).allow_cancel:
        return {"ok": False, "error": "Cancelling by phone is turned off. Offer to take a message for the team."}
    appt = session.get(Appointment, appointment_id)
    if not appt or appt.patient_id != body.patient_id:
        return {"ok": False, "error": "That appointment was not found for this patient."}
    if appt.status not in UPCOMING_STATUSES or appt.start < timeutil.now():
        return {"ok": False, "error": f"That appointment can't be cancelled (status: {appt.status})."}
    appt.status = "cancelled"
    appt.cancel_reason = body.reason or "Cancelled by patient over the phone"
    appt.updated_at = timeutil.now()
    session.add(appt)
    session.commit()
    return {"ok": True, "cancelled": True, **appt_brief(session, appt)}


class RescheduleIn(BaseModel):
    patient_id: int
    date: str
    time: str
    doctor: Optional[str] = None


@router.post("/appointments/{appointment_id}/reschedule")
def reschedule(appointment_id: int, body: RescheduleIn, session: Session = Depends(get_session)):
    if not get_agent_settings(session).allow_reschedule:
        return {"ok": False, "error": "Rescheduling by phone is turned off. Offer to take a message for the team."}
    appt = session.get(Appointment, appointment_id)
    if not appt or appt.patient_id != body.patient_id:
        return {"ok": False, "error": "That appointment was not found for this patient."}
    if appt.status not in UPCOMING_STATUSES:
        return {"ok": False, "error": f"That appointment can't be moved (status: {appt.status})."}
    service = session.get(Service, appt.service_id)
    day, clock = parse_day(body.date), parse_clock(body.time)
    if not day or not clock:
        return {"ok": False, "error": "Use date as YYYY-MM-DD and time as HH:MM (24 hour)."}
    start = datetime.combine(day, clock)

    requested = find_doctor(session, body.doctor) if body.doctor else None
    candidates = [requested] if requested else [session.get(Doctor, appt.doctor_id)] + [
        d for d in doctors_for_service(session, service.id) if d.id != appt.doctor_id
    ]
    chosen, first_reason = None, None
    for candidate in candidates:
        if not candidate:
            continue
        reason = check_slot(session, candidate, service, start, exclude_id=appt.id)
        if reason is None:
            chosen = candidate
            break
        first_reason = first_reason or reason
    if not chosen:
        return {
            "ok": False,
            "error": first_reason or "That time is not available.",
            **_alternatives(session, service, day, requested.id if requested else None),
        }
    previous = timeutil.spoken_datetime(appt.start)
    appt.start = start
    appt.end = start + timedelta(minutes=service.duration_minutes)
    appt.doctor_id = chosen.id
    appt.updated_at = timeutil.now()
    session.add(appt)
    session.commit()
    session.refresh(appt)
    return {"ok": True, "rescheduled": True, "previous_time": previous, **appt_brief(session, appt)}


# ---------------------------------------------------------------- messages & call logs


class MessageIn(BaseModel):
    caller_name: str
    phone: str = ""
    message: str
    category: str = ""  # appointment | complaint | issue | general ("" = work it out from the text)
    urgency: str = "normal"
    patient_id: Optional[int] = None
    call_id: Optional[int] = None


@router.post("/messages")
def take_message(body: MessageIn, session: Session = Depends(get_session)):
    text = body.message.strip()
    category = body.category.strip().lower()
    if category not in CATEGORIES:
        category = categorize(text)
    # Sophie flags urgency herself; a message that clearly describes an emergency is flagged too.
    urgent = body.urgency.lower().startswith("urg") or looks_urgent(text)
    msg = Message(
        caller_name=body.caller_name.strip(),
        phone=body.phone.strip(),
        message=text,
        category=category,
        urgency="urgent" if urgent else "normal",
        patient_id=body.patient_id,
        call_id=body.call_id,
    )
    session.add(msg)
    session.commit()
    session.refresh(msg)
    return {"ok": True, "message_id": msg.id, "category": category, "urgent": urgent}


class CallStartIn(BaseModel):
    room_name: str = ""
    channel: str = "web"
    caller_number: str = ""


@router.post("/calls/start")
def call_start(body: CallStartIn, session: Session = Depends(get_session)):
    call = CallLog(room_name=body.room_name, channel=body.channel, caller_number=body.caller_number)
    key = phone_key(body.caller_number)
    if key:
        matches = session.exec(select(Patient).where(Patient.phone_key == key)).all()
        if len(matches) == 1:
            call.patient_id = matches[0].id
    session.add(call)
    session.commit()
    session.refresh(call)
    return {"call_id": call.id}


class CallEndIn(BaseModel):
    transcript: list = []
    actions: list = []
    patient_id: Optional[int] = None
    outcome: str = ""
    summary: str = ""


OUTCOME_LABELS = {
    "book_appointment": "Appointment booked",
    "reschedule_appointment": "Appointment rescheduled",
    "cancel_appointment": "Appointment cancelled",
    "register_patient": "New patient registered",
    "take_message": "Message taken",
    "transfer_to_staff": "Transferred to staff",
}


@router.post("/calls/{call_id}/end")
def call_end(call_id: int, body: CallEndIn, session: Session = Depends(get_session)):
    call = session.get(CallLog, call_id)
    if not call:
        return {"ok": False}
    now = timeutil.now()
    call.ended_at = now
    call.duration_seconds = max(0, int((now - call.started_at).total_seconds()))
    call.status = "completed"
    call.transcript = body.transcript
    call.actions = body.actions
    if body.patient_id:
        call.patient_id = body.patient_id
    if body.outcome:
        call.outcome = body.outcome
    else:
        labels = []
        for action in body.actions:
            label = OUTCOME_LABELS.get(action.get("tool", "")) if action.get("ok") else None
            if label and label not in labels:
                labels.append(label)
        call.outcome = ", ".join(labels) if labels else ("Enquiry" if body.transcript else "No conversation")
    if body.summary:
        call.summary = body.summary
    session.add(call)
    session.commit()
    return {"ok": True}
