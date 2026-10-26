from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, col, func, select

from .. import timeutil
from ..auth import require_admin
from ..db import get_session
from ..domain import UPCOMING_STATUSES, appointments_out, doctor_service_ids
from ..models import Appointment, Doctor, DoctorSchedule, DoctorService, DoctorTimeOff, Service

router = APIRouter(prefix="/api", tags=["staff"], dependencies=[Depends(require_admin)])


# ---------------------------------------------------------------- doctors


class DoctorIn(BaseModel):
    name: str
    title: str = "Dentist"
    bio: str = ""
    email: str = ""
    phone: str = ""
    color: str = "#0d9298"
    is_active: bool = True
    service_ids: list[int] = []


class ScheduleBlockIn(BaseModel):
    weekday: int
    start_time: str
    end_time: str


class TimeOffIn(BaseModel):
    start_date: date
    end_date: date
    reason: str = ""


def _upcoming_count(session: Session, doctor_id: int) -> int:
    return session.exec(
        select(func.count())
        .select_from(Appointment)
        .where(
            Appointment.doctor_id == doctor_id,
            Appointment.start >= timeutil.now(),
            col(Appointment.status).in_(UPCOMING_STATUSES),
        )
    ).one()


def doctor_full(session: Session, doctor: Doctor) -> dict:
    schedule = session.exec(
        select(DoctorSchedule)
        .where(DoctorSchedule.doctor_id == doctor.id)
        .order_by(DoctorSchedule.weekday, DoctorSchedule.start_time)
    ).all()
    time_off = session.exec(
        select(DoctorTimeOff)
        .where(DoctorTimeOff.doctor_id == doctor.id, DoctorTimeOff.end_date >= timeutil.today())
        .order_by(DoctorTimeOff.start_date)
    ).all()
    data = doctor.model_dump()
    data.update(
        service_ids=doctor_service_ids(session, doctor.id),
        schedule=[{"weekday": s.weekday, "start_time": s.start_time, "end_time": s.end_time} for s in schedule],
        time_off=[t.model_dump() for t in time_off],
        upcoming_count=_upcoming_count(session, doctor.id),
    )
    return data


def _set_services(session: Session, doctor_id: int, service_ids: list[int]) -> None:
    for link in session.exec(select(DoctorService).where(DoctorService.doctor_id == doctor_id)).all():
        session.delete(link)
    session.flush()
    for sid in sorted(set(service_ids)):
        if session.get(Service, sid):
            session.add(DoctorService(doctor_id=doctor_id, service_id=sid))


@router.get("/doctors")
def list_doctors(session: Session = Depends(get_session)):
    doctors = session.exec(select(Doctor).order_by(col(Doctor.is_active).desc(), Doctor.id)).all()
    return [doctor_full(session, d) for d in doctors]


@router.post("/doctors")
def create_doctor(body: DoctorIn, session: Session = Depends(get_session)):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")
    doctor = Doctor(**body.model_dump(exclude={"service_ids"}))
    session.add(doctor)
    session.flush()
    _set_services(session, doctor.id, body.service_ids)
    session.commit()
    session.refresh(doctor)
    return doctor_full(session, doctor)


@router.get("/doctors/{doctor_id}")
def get_doctor(doctor_id: int, session: Session = Depends(get_session)):
    doctor = session.get(Doctor, doctor_id)
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")
    upcoming = session.exec(
        select(Appointment)
        .where(
            Appointment.doctor_id == doctor_id,
            Appointment.start >= timeutil.now(),
            col(Appointment.status).in_(UPCOMING_STATUSES),
        )
        .order_by(Appointment.start)
        .limit(50)
    ).all()
    data = doctor_full(session, doctor)
    data["upcoming"] = appointments_out(session, upcoming)
    return data


@router.put("/doctors/{doctor_id}")
def update_doctor(doctor_id: int, body: DoctorIn, session: Session = Depends(get_session)):
    doctor = session.get(Doctor, doctor_id)
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")
    for key, value in body.model_dump(exclude={"service_ids"}).items():
        setattr(doctor, key, value)
    session.add(doctor)
    _set_services(session, doctor.id, body.service_ids)
    session.commit()
    session.refresh(doctor)
    return doctor_full(session, doctor)


@router.delete("/doctors/{doctor_id}")
def delete_doctor(doctor_id: int, session: Session = Depends(get_session)):
    doctor = session.get(Doctor, doctor_id)
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")
    has_appointments = session.exec(select(Appointment).where(Appointment.doctor_id == doctor_id)).first()
    if has_appointments:
        doctor.is_active = False  # keep history intact
        session.add(doctor)
        session.commit()
        return {"ok": True, "deactivated": True}
    session.delete(doctor)
    session.commit()
    return {"ok": True, "deactivated": False}


@router.put("/doctors/{doctor_id}/schedule")
def set_schedule(doctor_id: int, blocks: list[ScheduleBlockIn], session: Session = Depends(get_session)):
    doctor = session.get(Doctor, doctor_id)
    if not doctor:
        raise HTTPException(status_code=404, detail="Doctor not found")
    for block in blocks:
        try:
            start, end = timeutil.parse_hm(block.start_time), timeutil.parse_hm(block.end_time)
        except (ValueError, IndexError):
            raise HTTPException(status_code=400, detail="Times must look like 09:00")
        if not 0 <= block.weekday <= 6 or start >= end:
            raise HTTPException(status_code=400, detail="Each shift needs a start time before its end time")
    for row in session.exec(select(DoctorSchedule).where(DoctorSchedule.doctor_id == doctor_id)).all():
        session.delete(row)
    session.flush()
    for block in blocks:
        session.add(
            DoctorSchedule(
                doctor_id=doctor_id,
                weekday=block.weekday,
                start_time=timeutil.fmt_hm(timeutil.parse_hm(block.start_time)),
                end_time=timeutil.fmt_hm(timeutil.parse_hm(block.end_time)),
            )
        )
    session.commit()
    return doctor_full(session, doctor)


@router.post("/doctors/{doctor_id}/time-off")
def add_time_off(doctor_id: int, body: TimeOffIn, session: Session = Depends(get_session)):
    if not session.get(Doctor, doctor_id):
        raise HTTPException(status_code=404, detail="Doctor not found")
    if body.end_date < body.start_date:
        raise HTTPException(status_code=400, detail="End date must be on or after the start date")
    entry = DoctorTimeOff(doctor_id=doctor_id, **body.model_dump())
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry.model_dump()


@router.delete("/doctors/{doctor_id}/time-off/{entry_id}")
def delete_time_off(doctor_id: int, entry_id: int, session: Session = Depends(get_session)):
    entry = session.get(DoctorTimeOff, entry_id)
    if not entry or entry.doctor_id != doctor_id:
        raise HTTPException(status_code=404, detail="Time off entry not found")
    session.delete(entry)
    session.commit()
    return {"ok": True}


# ---------------------------------------------------------------- services


class ServiceIn(BaseModel):
    name: str
    category: str = "General"
    description: str = ""
    keywords: str = ""
    duration_minutes: int = 30
    price: float = 0
    is_emergency: bool = False
    is_active: bool = True
    doctor_ids: Optional[list[int]] = None


def service_full(session: Session, service: Service) -> dict:
    data = service.model_dump()
    data["doctor_ids"] = list(
        session.exec(select(DoctorService.doctor_id).where(DoctorService.service_id == service.id)).all()
    )
    data["upcoming_count"] = session.exec(
        select(func.count())
        .select_from(Appointment)
        .where(
            Appointment.service_id == service.id,
            Appointment.start >= timeutil.now(),
            col(Appointment.status).in_(UPCOMING_STATUSES),
        )
    ).one()
    return data


def _set_service_doctors(session: Session, service_id: int, doctor_ids: list[int]) -> None:
    for link in session.exec(select(DoctorService).where(DoctorService.service_id == service_id)).all():
        session.delete(link)
    session.flush()
    for did in sorted(set(doctor_ids)):
        if session.get(Doctor, did):
            session.add(DoctorService(doctor_id=did, service_id=service_id))


def _validate_service(body: ServiceIn) -> None:
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")
    if body.duration_minutes < 5 or body.duration_minutes > 480:
        raise HTTPException(status_code=400, detail="Duration must be between 5 and 480 minutes")


@router.get("/services")
def list_services(session: Session = Depends(get_session)):
    services = session.exec(select(Service).order_by(col(Service.is_active).desc(), Service.category, Service.name)).all()
    return [service_full(session, s) for s in services]


@router.post("/services")
def create_service(body: ServiceIn, session: Session = Depends(get_session)):
    _validate_service(body)
    service = Service(**body.model_dump(exclude={"doctor_ids"}))
    session.add(service)
    session.flush()
    if body.doctor_ids is not None:
        _set_service_doctors(session, service.id, body.doctor_ids)
    session.commit()
    session.refresh(service)
    return service_full(session, service)


@router.put("/services/{service_id}")
def update_service(service_id: int, body: ServiceIn, session: Session = Depends(get_session)):
    _validate_service(body)
    service = session.get(Service, service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    for key, value in body.model_dump(exclude={"doctor_ids"}).items():
        setattr(service, key, value)
    session.add(service)
    if body.doctor_ids is not None:
        _set_service_doctors(session, service.id, body.doctor_ids)
    session.commit()
    session.refresh(service)
    return service_full(session, service)


@router.delete("/services/{service_id}")
def delete_service(service_id: int, session: Session = Depends(get_session)):
    service = session.get(Service, service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    if session.exec(select(Appointment).where(Appointment.service_id == service_id)).first():
        service.is_active = False
        session.add(service)
        session.commit()
        return {"ok": True, "deactivated": True}
    session.delete(service)
    session.commit()
    return {"ok": True, "deactivated": False}
