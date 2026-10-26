from collections import defaultdict
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, col, func, or_, select

from .. import timeutil
from ..auth import require_admin
from ..db import get_session
from ..domain import UPCOMING_STATUSES, appointments_out, calls_out, messages_out, patient_out, phone_key
from ..models import Appointment, CallLog, Message, Patient

router = APIRouter(prefix="/api/patients", tags=["patients"], dependencies=[Depends(require_admin)])


class PatientIn(BaseModel):
    first_name: str
    last_name: str = ""
    phone: str = ""
    email: str = ""
    date_of_birth: Optional[date] = None
    gender: str = ""
    address: str = ""
    notes: str = ""


@router.get("")
def list_patients(
    search: str = "",
    page: int = 1,
    page_size: int = 25,
    session: Session = Depends(get_session),
):
    stmt = select(Patient)
    term = search.strip()
    if term:
        like = f"%{term}%"
        conditions = [
            col(Patient.first_name).ilike(like),
            col(Patient.last_name).ilike(like),
            col(Patient.email).ilike(like),
            col(Patient.phone).ilike(like),
        ]
        key = phone_key(term)
        if len(key) >= 4:
            conditions.append(col(Patient.phone_key).contains(key))
        parts = term.split()
        if len(parts) >= 2:
            conditions.append(
                col(Patient.first_name).ilike(f"%{parts[0]}%") & col(Patient.last_name).ilike(f"%{parts[-1]}%")
            )
        stmt = stmt.where(or_(*conditions))

    total = session.exec(select(func.count()).select_from(stmt.subquery())).one()
    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    rows = session.exec(
        stmt.order_by(col(Patient.created_at).desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()

    ids = [p.id for p in rows]
    by_patient: dict[int, list[Appointment]] = defaultdict(list)
    if ids:
        for a in session.exec(select(Appointment).where(col(Appointment.patient_id).in_(ids))).all():
            by_patient[a.patient_id].append(a)

    now = timeutil.now()
    items = []
    for p in rows:
        appts = by_patient[p.id]
        upcoming = sorted(
            (a for a in appts if a.start >= now and a.status in UPCOMING_STATUSES), key=lambda a: a.start
        )
        visits = sorted((a for a in appts if a.status == "completed"), key=lambda a: a.start, reverse=True)
        item = patient_out(p)
        item.update(
            next_appointment=upcoming[0].start if upcoming else None,
            last_visit=visits[0].start if visits else None,
            total_appointments=len(appts),
        )
        items.append(item)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.post("")
def create_patient(body: PatientIn, session: Session = Depends(get_session)):
    if not body.first_name.strip():
        raise HTTPException(status_code=400, detail="First name is required")
    patient = Patient(**body.model_dump(), phone_key=phone_key(body.phone), source="admin")
    session.add(patient)
    session.commit()
    session.refresh(patient)
    return patient_out(patient)


@router.get("/{patient_id}")
def get_patient(patient_id: int, session: Session = Depends(get_session)):
    patient = session.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    appts = session.exec(
        select(Appointment).where(Appointment.patient_id == patient_id).order_by(col(Appointment.start).desc())
    ).all()
    now = timeutil.now()
    all_out = appointments_out(session, appts)
    upcoming = sorted(
        (a for a in all_out if a["start"] >= now and a["status"] in UPCOMING_STATUSES), key=lambda a: a["start"]
    )
    upcoming_ids = {a["id"] for a in upcoming}
    history = [a for a in all_out if a["id"] not in upcoming_ids]
    calls = session.exec(
        select(CallLog).where(CallLog.patient_id == patient_id).order_by(col(CallLog.started_at).desc())
    ).all()
    messages = session.exec(
        select(Message).where(Message.patient_id == patient_id).order_by(col(Message.created_at).desc())
    ).all()
    return {
        "patient": patient_out(patient),
        "upcoming": upcoming,
        "history": history,
        "calls": calls_out(session, calls),
        "messages": messages_out(session, messages),
        "stats": {
            "total": len(all_out),
            "completed": sum(1 for a in all_out if a["status"] == "completed"),
            "cancelled": sum(1 for a in all_out if a["status"] == "cancelled"),
            "no_show": sum(1 for a in all_out if a["status"] == "no_show"),
            "lifetime_value": sum(a["price"] for a in all_out if a["status"] == "completed"),
        },
    }


@router.put("/{patient_id}")
def update_patient(patient_id: int, body: PatientIn, session: Session = Depends(get_session)):
    patient = session.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    for key, value in body.model_dump().items():
        setattr(patient, key, value)
    patient.phone_key = phone_key(patient.phone)
    session.add(patient)
    session.commit()
    session.refresh(patient)
    return patient_out(patient)


@router.delete("/{patient_id}")
def delete_patient(patient_id: int, session: Session = Depends(get_session)):
    patient = session.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    for appt in session.exec(select(Appointment).where(Appointment.patient_id == patient_id)).all():
        session.delete(appt)
    for call in session.exec(select(CallLog).where(CallLog.patient_id == patient_id)).all():
        call.patient_id = None
        session.add(call)
    for msg in session.exec(select(Message).where(Message.patient_id == patient_id)).all():
        msg.patient_id = None
        session.add(msg)
    session.delete(patient)
    session.commit()
    return {"ok": True}
