import datetime as dt
from datetime import date, datetime
from typing import Optional

from pydantic import NaiveDatetime
from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel

# All timestamps are naive clinic-local times (see timeutil.py), so fields use
# NaiveDatetime; SQLModel otherwise insists on timezone-aware UTC values.

from . import timeutil


def _now() -> datetime:
    return timeutil.now()


# ---------------------------------------------------------------- settings


class ClinicSettings(SQLModel, table=True):
    __tablename__ = "clinic_settings"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = "Bright Smile Dental Hospital"
    phone: str = ""
    email: str = ""
    address: str = ""
    website: str = ""
    timezone: str = "Europe/London"
    currency_symbol: str = "£"
    slot_interval_minutes: int = 15
    min_notice_minutes: int = 60
    max_days_ahead: int = 90
    emergency_info: str = ""
    knowledge_base: str = ""  # FAQs the receptionist can answer (parking, payment...)
    transfer_number: str = ""  # front-desk number for live call transfers (phone calls only)


class AgentSettings(SQLModel, table=True):
    __tablename__ = "agent_settings"

    id: Optional[int] = Field(default=None, primary_key=True)
    agent_name: str = "Sophie"
    greeting: str = (
        "Hello, thank you for calling {clinic_name}, you're speaking with {agent_name}. "
        "How can I help you today?"
    )
    personality: str = ""
    llm_model: str = "gemini-3.5-flash-lite"  # free tier on Google AI Studio, fastest Gemini
    tts_provider: str = "deepgram"  # deepgram | elevenlabs | cartesia
    tts_voice: str = "aura-2-pandora-en"
    tts_model: str = ""  # provider model override (elevenlabs/cartesia)
    tts_speed: float = 1.0  # Cartesia Sonic: 0.6 - 1.5
    stt_model: str = "deepgram-flux"  # deepgram-flux | cartesia-ink-2 | deepgram-nova-3
    stt_language: str = "en-GB"
    allow_booking: bool = True
    allow_reschedule: bool = True
    allow_cancel: bool = True
    allow_registration: bool = True
    allow_messages: bool = True
    allow_transfer: bool = False
    max_call_minutes: int = 15
    updated_at: Optional[NaiveDatetime] = None


class ClinicHours(SQLModel, table=True):
    __tablename__ = "clinic_hours"

    id: Optional[int] = Field(default=None, primary_key=True)
    weekday: int = Field(index=True)  # 0 = Monday ... 6 = Sunday
    is_open: bool = True
    open_time: str = "09:00"
    close_time: str = "17:00"


class Closure(SQLModel, table=True):
    __tablename__ = "closures"

    id: Optional[int] = Field(default=None, primary_key=True)
    date: dt.date = Field(index=True)  # dt.date: the field name would shadow the type
    reason: str = ""


# ---------------------------------------------------------------- catalogue


class Service(SQLModel, table=True):
    __tablename__ = "services"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    category: str = "General"
    description: str = ""
    keywords: str = ""  # comma separated synonyms callers might use
    duration_minutes: int = 30
    price: float = 0
    is_emergency: bool = False
    is_active: bool = True


class Doctor(SQLModel, table=True):
    __tablename__ = "doctors"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    title: str = "Dentist"  # e.g. "Orthodontist"
    bio: str = ""
    email: str = ""
    phone: str = ""
    color: str = "#0d9298"
    is_active: bool = True
    created_at: NaiveDatetime = Field(default_factory=_now)


class DoctorService(SQLModel, table=True):
    __tablename__ = "doctor_services"

    doctor_id: int = Field(foreign_key="doctors.id", primary_key=True, ondelete="CASCADE")
    service_id: int = Field(foreign_key="services.id", primary_key=True, ondelete="CASCADE")


class DoctorSchedule(SQLModel, table=True):
    """Weekly working hours. Several rows per weekday = split shifts / lunch break."""

    __tablename__ = "doctor_schedules"

    id: Optional[int] = Field(default=None, primary_key=True)
    doctor_id: int = Field(foreign_key="doctors.id", index=True, ondelete="CASCADE")
    weekday: int
    start_time: str
    end_time: str


class DoctorTimeOff(SQLModel, table=True):
    __tablename__ = "doctor_time_off"

    id: Optional[int] = Field(default=None, primary_key=True)
    doctor_id: int = Field(foreign_key="doctors.id", index=True, ondelete="CASCADE")
    start_date: date
    end_date: date
    reason: str = ""


# ---------------------------------------------------------------- people & bookings


class Patient(SQLModel, table=True):
    __tablename__ = "patients"

    id: Optional[int] = Field(default=None, primary_key=True)
    first_name: str
    last_name: str = ""
    phone: str = ""
    phone_key: str = Field(default="", index=True)  # last 10 digits, for caller-ID matching
    email: str = ""
    date_of_birth: Optional[date] = None
    gender: str = ""
    address: str = ""
    notes: str = ""
    source: str = "admin"  # admin | ai_agent
    created_at: NaiveDatetime = Field(default_factory=_now)


class Appointment(SQLModel, table=True):
    __tablename__ = "appointments"

    id: Optional[int] = Field(default=None, primary_key=True)
    patient_id: int = Field(foreign_key="patients.id", index=True, ondelete="CASCADE")
    doctor_id: int = Field(foreign_key="doctors.id", index=True)
    service_id: int = Field(foreign_key="services.id")
    start: NaiveDatetime = Field(index=True)
    end: NaiveDatetime
    status: str = "scheduled"  # scheduled | confirmed | completed | cancelled | no_show
    notes: str = ""
    source: str = "admin"  # admin | ai_agent
    call_id: Optional[int] = None
    cancel_reason: str = ""
    created_at: NaiveDatetime = Field(default_factory=_now)
    updated_at: NaiveDatetime = Field(default_factory=_now)


class CallLog(SQLModel, table=True):
    __tablename__ = "calls"

    id: Optional[int] = Field(default=None, primary_key=True)
    room_name: str = ""
    channel: str = "web"  # web | phone
    caller_number: str = ""
    patient_id: Optional[int] = Field(default=None, index=True)
    started_at: NaiveDatetime = Field(default_factory=_now, index=True)
    ended_at: Optional[NaiveDatetime] = None
    duration_seconds: int = 0
    status: str = "in_progress"  # in_progress | completed
    outcome: str = ""
    summary: str = ""
    transcript: list = Field(default_factory=list, sa_column=Column(JSON))
    actions: list = Field(default_factory=list, sa_column=Column(JSON))


class Message(SQLModel, table=True):
    """Callback requests / messages the receptionist takes for staff."""

    __tablename__ = "messages"

    id: Optional[int] = Field(default=None, primary_key=True)
    caller_name: str = ""
    phone: str = ""
    message: str = ""
    category: str = "general"  # appointment | complaint | issue | general
    urgency: str = "normal"  # normal | urgent
    status: str = "new"  # new | done
    patient_id: Optional[int] = None
    call_id: Optional[int] = None
    created_at: NaiveDatetime = Field(default_factory=_now)


class AdminUser(SQLModel, table=True):
    __tablename__ = "admin_users"

    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    name: str = "Admin"
    password_hash: str
    created_at: NaiveDatetime = Field(default_factory=_now)
