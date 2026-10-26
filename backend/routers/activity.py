from collections import Counter
from datetime import datetime, time, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, col, func, or_, select

from .. import timeutil
from ..auth import require_admin
from ..db import get_session
from ..domain import UPCOMING_STATUSES, appointments_out, calls_out, messages_out
from ..message_categories import CATEGORIES
from ..models import Appointment, CallLog, Message, Patient, Service

router = APIRouter(prefix="/api", tags=["activity"], dependencies=[Depends(require_admin)])


def _count(session: Session, model, *where) -> int:
    stmt = select(func.count()).select_from(model)
    if where:
        stmt = stmt.where(*where)
    return session.exec(stmt).one()


@router.get("/dashboard")
def dashboard(session: Session = Depends(get_session)):
    now = timeutil.now()
    today = now.date()
    day_start = datetime.combine(today, time.min)
    day_end = day_start + timedelta(days=1)
    month_ago = now - timedelta(days=30)

    not_cancelled = col(Appointment.status) != "cancelled"
    stats = {
        "patients_total": _count(session, Patient),
        "patients_new_30d": _count(session, Patient, Patient.created_at >= month_ago),
        "appointments_today": _count(
            session, Appointment, Appointment.start >= day_start, Appointment.start < day_end, not_cancelled
        ),
        "appointments_upcoming_7d": _count(
            session,
            Appointment,
            Appointment.start >= now,
            Appointment.start < now + timedelta(days=7),
            col(Appointment.status).in_(UPCOMING_STATUSES),
        ),
        "calls_today": _count(session, CallLog, CallLog.started_at >= day_start),
        "calls_30d": _count(session, CallLog, CallLog.started_at >= month_ago),
        "ai_bookings_30d": _count(
            session, Appointment, Appointment.source == "ai_agent", Appointment.created_at >= month_ago
        ),
        "pending_messages": _count(session, Message, Message.status == "new"),
        "cancellations_30d": _count(
            session, Appointment, Appointment.status == "cancelled", Appointment.updated_at >= month_ago
        ),
    }
    revenue = session.exec(
        select(func.coalesce(func.sum(Service.price), 0))
        .select_from(Appointment)
        .join(Service, Service.id == Appointment.service_id)
        .where(Appointment.status == "completed", Appointment.start >= month_ago)
    ).one()
    stats["revenue_30d"] = float(revenue or 0)

    # Daily activity: 14 days back -> 13 days ahead
    range_start = day_start - timedelta(days=13)
    range_end = day_start + timedelta(days=14)
    appts = session.exec(
        select(Appointment).where(
            Appointment.start >= range_start, Appointment.start < range_end, not_cancelled
        )
    ).all()
    calls = session.exec(select(CallLog).where(CallLog.started_at >= range_start)).all()
    by_day_ai, by_day_staff, by_day_calls = Counter(), Counter(), Counter()
    for a in appts:
        (by_day_ai if a.source == "ai_agent" else by_day_staff)[a.start.date()] += 1
    for c in calls:
        by_day_calls[c.started_at.date()] += 1
    daily = []
    for i in range(27):
        d = (range_start + timedelta(days=i)).date()
        daily.append(
            {
                "date": d,
                "label": d.strftime("%d %b"),
                "is_today": d == today,
                "ai": by_day_ai[d],
                "staff": by_day_staff[d],
                "calls": by_day_calls[d],
            }
        )

    upcoming_30 = session.exec(
        select(Appointment).where(
            Appointment.start >= now,
            Appointment.start < now + timedelta(days=30),
            col(Appointment.status).in_(UPCOMING_STATUSES),
        )
    ).all()
    service_names = {s.id: s.name for s in session.exec(select(Service)).all()}
    service_counts = Counter(service_names.get(a.service_id, "Other") for a in upcoming_30)

    today_appts = session.exec(
        select(Appointment)
        .where(Appointment.start >= day_start, Appointment.start < day_end)
        .order_by(Appointment.start)
    ).all()
    recent_calls = session.exec(select(CallLog).order_by(col(CallLog.started_at).desc()).limit(6)).all()
    new_messages = session.exec(
        select(Message).where(Message.status == "new").order_by(col(Message.created_at).desc()).limit(5)
    ).all()

    return {
        "now": now,
        "stats": stats,
        "daily": daily,
        "services": [{"name": n, "count": c} for n, c in service_counts.most_common(6)],
        "today": appointments_out(session, today_appts),
        "recent_calls": calls_out(session, recent_calls),
        "messages": messages_out(session, new_messages),
    }


# ---------------------------------------------------------------- calls


@router.get("/calls")
def list_calls(
    search: str = "",
    channel: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
    session: Session = Depends(get_session),
):
    stmt = select(CallLog)
    if channel:
        stmt = stmt.where(CallLog.channel == channel)
    if search.strip():
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                col(CallLog.caller_number).ilike(like),
                col(CallLog.outcome).ilike(like),
                col(CallLog.summary).ilike(like),
            )
        )
    total = session.exec(select(func.count()).select_from(stmt.subquery())).one()
    page = max(1, page)
    rows = session.exec(
        stmt.order_by(col(CallLog.started_at).desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return {"items": calls_out(session, rows), "total": total, "page": page, "page_size": page_size}


@router.get("/calls/{call_id}")
def get_call(call_id: int, session: Session = Depends(get_session)):
    call = session.get(CallLog, call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    data = calls_out(session, [call], include_transcript=True)[0]
    data["appointments"] = appointments_out(
        session, session.exec(select(Appointment).where(Appointment.call_id == call_id)).all()
    )
    data["messages"] = messages_out(session, session.exec(select(Message).where(Message.call_id == call_id)).all())
    return data


# ---------------------------------------------------------------- messages


class MessageUpdate(BaseModel):
    status: Optional[str] = None
    category: Optional[str] = None
    urgency: Optional[str] = None


@router.get("/messages")
def list_messages(status: Optional[str] = None, session: Session = Depends(get_session)):
    stmt = select(Message)
    if status:
        stmt = stmt.where(Message.status == status)
    rows = session.exec(stmt.order_by(col(Message.created_at).desc()).limit(300)).all()
    return messages_out(session, rows)


@router.put("/messages/{message_id}")
def update_message(message_id: int, body: MessageUpdate, session: Session = Depends(get_session)):
    msg = session.get(Message, message_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if body.status is not None:
        if body.status not in ("new", "done"):
            raise HTTPException(status_code=400, detail="Status must be new or done")
        msg.status = body.status
    if body.category is not None:
        if body.category not in CATEGORIES:
            raise HTTPException(status_code=400, detail="Category must be appointment, complaint, issue or general")
        msg.category = body.category
    if body.urgency is not None:
        if body.urgency not in ("normal", "urgent"):
            raise HTTPException(status_code=400, detail="Urgency must be normal or urgent")
        msg.urgency = body.urgency
    session.add(msg)
    session.commit()
    return messages_out(session, [msg])[0]


@router.delete("/messages/{message_id}")
def delete_message(message_id: int, session: Session = Depends(get_session)):
    msg = session.get(Message, message_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    session.delete(msg)
    session.commit()
    return {"ok": True}
