"""Clinic-local time helpers.

All appointment times are stored as naive datetimes in the clinic's own
timezone (set in Settings). That keeps scheduling maths simple for a
single-site clinic.
"""

from datetime import date, datetime, time
from zoneinfo import ZoneInfo

_tz_name = "Europe/London"


def set_timezone(name: str) -> None:
    global _tz_name
    try:
        ZoneInfo(name)
        _tz_name = name
    except Exception:
        pass


def tz_name() -> str:
    return _tz_name


def now() -> datetime:
    return datetime.now(ZoneInfo(_tz_name)).replace(tzinfo=None, microsecond=0)


def today() -> date:
    return now().date()


def parse_hm(value: str) -> time:
    parts = value.strip().split(":")
    return time(int(parts[0]), int(parts[1]) if len(parts) > 1 else 0)


def fmt_hm(value: time | datetime) -> str:
    return value.strftime("%H:%M")


def spoken_time(dt: datetime | time) -> str:
    """'9:30 am', '2 pm' - friendly for speech."""
    hour = dt.hour % 12 or 12
    suffix = "am" if dt.hour < 12 else "pm"
    if dt.minute == 0:
        return f"{hour} {suffix}"
    return f"{hour}:{dt.minute:02d} {suffix}"


def spoken_date(d: date | datetime) -> str:
    """'Friday 23 October'"""
    return f"{d.strftime('%A')} {d.day} {d.strftime('%B')}"


def spoken_datetime(dt: datetime) -> str:
    return f"{spoken_date(dt)} at {spoken_time(dt)}"
