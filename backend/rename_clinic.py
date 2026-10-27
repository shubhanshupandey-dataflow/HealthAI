"""Renames the practice everywhere callers and staff see it (e.g. for a demo).

Run:  .venv\\Scripts\\python -m backend.rename_clinic "Good Dentist"
Server:  docker compose exec backend python -m backend.rename_clinic "Good Dentist"

Changes the clinic name, the demo email/website addresses (*.example, also the doctors'), and the
old name in saved call transcripts and summaries. Sophie uses the new name from the next call.
Real email addresses and websites are left alone - change those in Settings -> Clinic.
"""

import re
import sys

from sqlmodel import Session, select

from .db import engine, init_db
from .domain import get_clinic
from .models import CallLog, Doctor


def _demo_domain(name: str) -> str:
    return (re.sub(r"[^a-z0-9]", "", name.lower()) or "clinic") + ".example"


def rename(new_name: str) -> None:
    init_db()
    with Session(engine) as session:
        clinic = get_clinic(session)
        old_name = clinic.name
        old_domain = clinic.email.partition("@")[2]
        new_domain = _demo_domain(new_name)
        # Sophie sometimes shortens it: "here at Bright Smile"
        short_name = re.sub(r"(\s+dental)?\s+(hospital|clinic|practice|surgery|centre|center)$", "", old_name, flags=re.I)

        def swap(text: str) -> str:
            text = text.replace(old_name, new_name)
            if short_name != old_name:
                text = text.replace(short_name, new_name)
            if old_domain.endswith(".example"):
                text = text.replace(old_domain, new_domain)
            return text

        clinic.name = new_name
        clinic.email = swap(clinic.email)
        clinic.website = swap(clinic.website)
        session.add(clinic)

        for doctor in session.exec(select(Doctor)):
            if doctor.email != swap(doctor.email):
                doctor.email = swap(doctor.email)
                session.add(doctor)

        calls = 0
        for call in session.exec(select(CallLog)):
            transcript = [{**line, "text": swap(line.get("text") or "")} for line in call.transcript or []]
            summary = swap(call.summary)
            if transcript != call.transcript or summary != call.summary:
                call.transcript, call.summary = transcript, summary
                session.add(call)
                calls += 1

        session.commit()
    print(f'Renamed "{old_name}" to "{new_name}" ({calls} call transcripts updated).')


if __name__ == "__main__":
    if len(sys.argv) != 2 or not sys.argv[1].strip():
        sys.exit('Usage: python -m backend.rename_clinic "New Practice Name"')
    rename(sys.argv[1].strip())
