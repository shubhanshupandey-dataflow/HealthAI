from datetime import date, datetime, time, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, col, or_, select

from .. import timeutil
from ..auth import require_admin
from ..db import get_session
from ..domain import (
    appointments_out,
    check_slot,
    clinic_window,
    closure_reason,
    compute_slots,
    doctor_blocks,
    doctor_is_off,
)
from ..models import Appointment, Doctor, Patient, Service

router = APIRouter(prefix="/api", tags=["appointments"], dependencies=[Depends(require_admin)])

STATUSES = {"scheduled", "confirmed", "completed", "cancelled", "no_show"}


class AppointmentIn(BaseModel):
    patient_id: int
    doctor_id: int
    service_id: int
    start: datetime
    notes: str = ""
    status: str = "scheduled"
    force: bool = False  # admin override: skip working-hours / clash checks


class AppointmentUpdate(BaseModel):
    doctor_id: Optional[int] = None
    service_id: Optional[int] = None
    start: Optional[datetime] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    cancel_reason: Optional[str] = None
    force: bool = False


def _naive_minute(dt: datetime) -> datetime:
    return dt.replace(tzinfo=None, second=0, microsecond=0)


@router.get("/appointments")
def list_appointments(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    doctor_id: Optional[int] = None,
    patient_id: Optional[int] = None,
    status: Optional[str] = None,
    source: Optional[str] = None,
    search: str = "",
    order: str = "asc",
    limit: int = 500,
    session: Session = Depends(get_session),
):
    stmt = select(Appointment)
    if date_from:
        stmt = stmt.where(Appointment.start >= datetime.combine(date_from, time.min))
    if date_to:
        stmt = stmt.where(Appointment.start < datetime.combine(date_to + timedelta(days=1), time.min))
    if doctor_id:
        stmt = stmt.where(Appointment.doctor_id == doctor_id)
    if patient_id:
        stmt = stmt.where(Appointment.patient_id == patient_id)
    if status:
        stmt = stmt.where(col(Appointment.status).in_(status.split(",")))
    if source:
        stmt = stmt.where(Appointment.source == source)
    if search.strip():
        like = f"%{search.strip()}%"
        stmt = stmt.join(Patient, Patient.id == Appointment.patient_id).where(
            or_(
                col(Patient.first_name).ilike(like),
                col(Patient.last_name).ilike(like),
                col(Patient.phone).ilike(like),
            )
        )
    ordering = col(Appointment.start).desc() if order == "desc" else col(Appointment.start)
    rows = session.exec(stmt.order_by(ordering).limit(min(limit, 2000))).all()
    return appointments_out(session, rows)


@router.post("/appointments")
def create_appointment(body: AppointmentIn, session: Session = Depends(get_session)):
    patient = session.get(Patient, body.patient_id)
    doctor = session.get(Doctor, body.doctor_id)
    service = session.get(Service, body.service_id)
    if not patient or not doctor or not service:
        raise HTTPException(status_code=404, detail="Patient, doctor or service not found")
    if body.status not in STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    start = _naive_minute(body.start)
    if not body.force:
        reason = check_slot(session, doctor, service, start, respect_notice=False)
        if reason:
            raise HTTPException(status_code=409, detail=reason)
    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor.id,
        service_id=service.id,
        start=start,
        end=start + timedelta(minutes=service.duration_minutes),
        status=body.status,
        notes=body.notes,
        source="admin",
    )
    session.add(appt)
    session.commit()
    session.refresh(appt)
    return appointments_out(session, [appt])[0]


@router.get("/appointments/{appt_id}")
def get_appointment(appt_id: int, session: Session = Depends(get_session)):
    appt = session.get(Appointment, appt_id)
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return appointments_out(session, [appt])[0]


@router.put("/appointments/{appt_id}")
def update_appointment(appt_id: int, body: AppointmentUpdate, session: Session = Depends(get_session)):
    appt = session.get(Appointment, appt_id)
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    data = body.model_dump(exclude_unset=True)
    force = data.pop("force", False)

    doctor = session.get(Doctor, data.get("doctor_id") or appt.doctor_id)
    service = session.get(Service, data.get("service_id") or appt.service_id)
    if not doctor or not service:
        raise HTTPException(status_code=404, detail="Doctor or service not found")
    start = _naive_minute(data["start"]) if data.get("start") else appt.start
    moved = (
        start != appt.start or doctor.id != appt.doctor_id or service.id != appt.service_id
    )
    new_status = data.get("status") or appt.status
    if new_status not in STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    if moved and not force and new_status not in ("cancelled",):
        reason = check_slot(session, doctor, service, start, exclude_id=appt.id, respect_notice=False)
        if reason:
            raise HTTPException(status_code=409, detail=reason)

    appt.doctor_id = doctor.id
    appt.service_id = service.id
    appt.start = start
    appt.end = start + timedelta(minutes=service.duration_minutes)
    appt.status = new_status
    if "notes" in data and data["notes"] is not None:
        appt.notes = data["notes"]
    if "cancel_reason" in data and data["cancel_reason"] is not None:
        appt.cancel_reason = data["cancel_reason"]
    appt.updated_at = timeutil.now()
    session.add(appt)
    session.commit()
    session.refresh(appt)
    return appointments_out(session, [appt])[0]


@router.delete("/appointments/{appt_id}")
def delete_appointment(appt_id: int, session: Session = Depends(get_session)):
    appt = session.get(Appointment, appt_id)
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    session.delete(appt)
    session.commit()
    return {"ok": True}


@router.get("/availability")
def availability(
    day: date = Query(alias="date"),
    service_id: int = Query(),
    doctor_id: Optional[int] = None,
    exclude_appointment_id: Optional[int] = None,
    session: Session = Depends(get_session),
):
    service = session.get(Service, service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    slots = compute_slots(
        session, day, service, doctor_id, exclude_appointment_id=exclude_appointment_id, respect_notice=False
    )
    now = timeutil.now()
    return [s for s in slots if s["start"] >= now]


@router.get("/calendar")
def calendar(day: date = Query(alias="date"), session: Session = Depends(get_session)):
    window = clinic_window(session, day)
    doctors = session.exec(select(Doctor).where(Doctor.is_active == True).order_by(Doctor.id)).all()  # noqa: E712
    doctor_rows = [
        {
            "id": d.id,
            "name": d.name,
            "title": d.title,
            "color": d.color,
            "off": doctor_is_off(session, d.id, day),
            "blocks": [
                {"start": timeutil.fmt_hm(s), "end": timeutil.fmt_hm(e)}
                for s, e in doctor_blocks(session, d.id, day.weekday())
            ],
        }
        for d in doctors
    ]
    start = datetime.combine(day, time.min)
    appts = session.exec(
        select(Appointment)
        .where(Appointment.start >= start, Appointment.start < start + timedelta(days=1))
        .order_by(Appointment.start)
    ).all()
    return {
        "date": day,
        "clinic": {"open": timeutil.fmt_hm(window[0]), "close": timeutil.fmt_hm(window[1])} if window else None,
        "closure": closure_reason(session, day),
        "doctors": doctor_rows,
        "appointments": appointments_out(session, appts),
    }
