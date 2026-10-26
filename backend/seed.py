"""Demo data for a UK private dental hospital.

Runs automatically on first start (empty database).
Reset everything with:  .venv\\Scripts\\python -m backend.seed --reset
"""

import random
import sys
from datetime import date, datetime, timedelta

from sqlmodel import Session, SQLModel, select

from . import timeutil
from .auth import hash_password
from .config import ADMIN_EMAIL, ADMIN_PASSWORD
from .db import engine, init_db
from .domain import compute_slots, phone_key
from .models import (
    AdminUser,
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

KNOWLEDGE_BASE = """\
- Parking: pay-and-display parking on Riverside Walk. Nearest station is London Bridge, a 5 minute walk.
- Payment: we accept card, Apple Pay, Google Pay and cash. Payment is taken at the end of each visit.
- We are a private practice and do not offer NHS treatment. We accept Bupa, AXA and Denplan.
- 0% finance is available for treatment over £1,000, such as implants and Invisalign.
- Cancellation policy: please give at least 24 hours' notice. Late cancellations may be charged £25.
- New patients should arrive 10 minutes early to fill in a medical history form.
- Accessibility: step-free entrance and a ground-floor surgery.
- Children under 16 must attend with a parent or guardian.
- X-rays are included in the New Patient Examination fee.
"""

EMERGENCY_INFO = """\
If the caller has severe facial swelling spreading to the eye or neck, difficulty breathing or swallowing, \
uncontrolled bleeding, or a head or facial injury after an accident: tell them to call 999 or go to A&E \
immediately. Outside opening hours they can call NHS 111 for urgent dental advice. For toothache, a broken \
tooth, a lost filling or crown, offer the earliest Emergency Appointment."""

PERSONALITY = """\
You are warm, upbeat and genuinely kind, like a friendly receptionist in her late twenties from London. \
Use natural British English ("lovely", "brilliant", "no worries", "bear with me one moment"). \
Be reassuring with nervous patients and never rush anyone."""

# name, category, minutes, price, keywords, description, emergency
SERVICES = [
    ("New Patient Examination", "General", 30, 65, "new patient, first visit, initial exam, first appointment",
     "Full examination for new patients, including X-rays if needed.", False),
    ("Routine Check-up", "General", 30, 55, "check up, checkup, routine, exam, examination, six month",
     "Regular check-up for existing patients.", False),
    ("Scale & Polish", "Hygiene", 30, 75, "cleaning, clean, hygienist, hygiene, scale, polish, plaque, tartar",
     "Professional clean with our hygienist.", False),
    ("Teeth Whitening", "Cosmetic", 60, 350, "whitening, whiten, bleaching, white teeth, stains",
     "In-chair professional whitening.", False),
    ("Filling", "Restorative", 45, 120, "filling, cavity, hole, decay, white filling",
     "Tooth-coloured composite filling.", False),
    ("Root Canal Treatment", "Restorative", 90, 450, "root canal, endodontic, nerve treatment, abscess",
     "Root canal treatment with our endodontist.", False),
    ("Tooth Extraction", "Surgery", 45, 150, "extraction, pull tooth, remove tooth, tooth out, wisdom tooth",
     "Simple or surgical tooth removal.", False),
    ("Emergency Appointment", "Emergency", 30, 85,
     "emergency, urgent, toothache, tooth pain, pain, broken tooth, swelling, chipped, lost filling",
     "Same-day appointment for pain, swelling or broken teeth.", True),
    ("Dental Implant Consultation", "Implants", 30, 0, "implant, implants, missing tooth, replace tooth",
     "Free consultation to discuss dental implants.", False),
    ("Invisalign Consultation", "Orthodontics", 30, 0, "invisalign, braces, aligners, straighten, crooked teeth",
     "Free consultation for clear aligners.", False),
    ("Children's Check-up", "General", 30, 35, "child, children, kids, son, daughter, paediatric",
     "Gentle check-up for under 16s.", False),
]

WEEKDAY_SPLIT = [("08:30", "13:00"), ("14:00", "18:00")]

# name, title, colour, bio, services, schedule {weekday: [(start, end)]}
DOCTORS = [
    ("Dr Emily Carter", "General Dentist", "#0d9298",
     "Friendly general dentist with ten years' experience. Brilliant with nervous patients.",
     ["New Patient Examination", "Routine Check-up", "Filling", "Tooth Extraction", "Emergency Appointment",
      "Children's Check-up"],
     {0: WEEKDAY_SPLIT, 1: WEEKDAY_SPLIT, 2: WEEKDAY_SPLIT, 3: WEEKDAY_SPLIT, 4: [("08:30", "13:00"), ("14:00", "17:00")]}),
    ("Dr James Whitmore", "Endodontist", "#1b5e96",
     "Root canal specialist with a gentle, precise approach.",
     ["Root Canal Treatment", "Filling", "Emergency Appointment", "New Patient Examination"],
     {0: [("09:00", "17:00")], 2: [("09:00", "17:00")], 3: [("09:00", "17:00")]}),
    ("Dr Priya Sharma", "Orthodontist", "#7a5fc2",
     "Specialist orthodontist for Invisalign and braces, for adults and children.",
     ["Invisalign Consultation", "Children's Check-up", "Routine Check-up"],
     {1: [("10:00", "18:00")], 3: [("10:00", "18:00")], 5: [("09:00", "14:00")]}),
    ("Dr Oliver Bennett", "Oral Surgeon & Implantologist", "#e0752a",
     "Oral surgeon specialising in implants and complex extractions.",
     ["Dental Implant Consultation", "Tooth Extraction", "Emergency Appointment"],
     {0: [("09:00", "17:00")], 1: [("09:00", "17:00")], 4: [("09:00", "16:00")]}),
    ("Sarah Collins", "Dental Hygienist", "#2f9e6e",
     "Hygienist focused on gum health, whitening and prevention.",
     ["Scale & Polish", "Teeth Whitening"],
     {0: [("08:30", "17:30")], 1: [("08:30", "17:30")], 2: [("08:30", "17:30")], 3: [("08:30", "17:30")],
      4: [("08:30", "17:30")], 5: [("09:00", "14:00")]}),
]

PATIENTS = [
    ("Olivia", "Smith", "F"), ("Amelia", "Jones", "F"), ("Isla", "Taylor", "F"), ("Ava", "Brown", "F"),
    ("Mia", "Williams", "F"), ("Grace", "Wilson", "F"), ("Freya", "Davies", "F"), ("Lily", "Evans", "F"),
    ("Emily", "Thomas", "F"), ("Sophie", "Johnson", "F"), ("Charlotte", "Roberts", "F"), ("Poppy", "Walker", "F"),
    ("Oliver", "Wright", "M"), ("George", "Robinson", "M"), ("Harry", "Thompson", "M"), ("Noah", "White", "M"),
    ("Jack", "Hughes", "M"), ("Leo", "Edwards", "M"), ("Arthur", "Green", "M"), ("Muhammad", "Khan", "M"),
    ("Oscar", "Hall", "M"), ("Charlie", "Wood", "M"), ("Thomas", "Clarke", "M"), ("William", "Patel", "M"),
    ("Henry", "Lewis", "M"), ("Daniel", "Murphy", "M"), ("Ella", "Turner", "F"), ("Ruby", "Hill", "F"),
    ("Priya", "Shah", "F"), ("James", "O'Connor", "M"),
]

NOTES = ["", "", "", "Nervous patient - prefers a gentle approach.", "Allergic to penicillin.",
         "Prefers morning appointments.", "", "Denplan member.", "", "Bupa insurance."]


def _wipe(session: Session) -> None:
    with engine.begin() as conn:
        for table in reversed(SQLModel.metadata.sorted_tables):
            conn.execute(table.delete())


def seed(reset: bool = False) -> None:
    init_db()
    rng = random.Random(42)
    with Session(engine) as session:
        if reset:
            _wipe(session)
        elif session.exec(select(ClinicSettings)).first():
            return

        clinic = ClinicSettings(
            name="Bright Smile Dental Hospital",
            phone="020 7946 0958",
            email="reception@brightsmile.example",
            address="12 Riverside Walk, London SE1 7PB",
            website="www.brightsmile.example",
            timezone="Europe/London",
            currency_symbol="£",
            slot_interval_minutes=15,
            min_notice_minutes=60,
            max_days_ahead=90,
            emergency_info=EMERGENCY_INFO,
            knowledge_base=KNOWLEDGE_BASE,
        )
        session.add(clinic)
        session.add(AgentSettings(personality=PERSONALITY))
        timeutil.set_timezone(clinic.timezone)

        for wd in range(7):
            if wd < 5:
                session.add(ClinicHours(weekday=wd, is_open=True, open_time="08:30", close_time="18:00"))
            elif wd == 5:
                session.add(ClinicHours(weekday=wd, is_open=True, open_time="09:00", close_time="14:00"))
            else:
                session.add(ClinicHours(weekday=wd, is_open=False, open_time="09:00", close_time="13:00"))
        for d, reason in [
            (date(2026, 12, 25), "Christmas Day"),
            (date(2026, 12, 28), "Boxing Day bank holiday"),
            (date(2027, 1, 1), "New Year's Day"),
        ]:
            session.add(Closure(date=d, reason=reason))

        services: dict[str, Service] = {}
        for name, cat, mins, price, kw, desc, emergency in SERVICES:
            s = Service(name=name, category=cat, duration_minutes=mins, price=price, keywords=kw,
                        description=desc, is_emergency=emergency)
            session.add(s)
            services[name] = s
        session.flush()

        doctors: list[Doctor] = []
        for name, title, color, bio, svc_names, schedule in DOCTORS:
            first = name.replace("Dr ", "").split()[0].lower()
            doc = Doctor(name=name, title=title, color=color, bio=bio,
                         email=f"{first}@brightsmile.example")
            session.add(doc)
            session.flush()
            doctors.append(doc)
            for sn in svc_names:
                session.add(DoctorService(doctor_id=doc.id, service_id=services[sn].id))
            for wd, blocks in schedule.items():
                for start, end in blocks:
                    session.add(DoctorSchedule(doctor_id=doc.id, weekday=wd, start_time=start, end_time=end))

        now = timeutil.now()
        today = now.date()
        session.add(DoctorTimeOff(doctor_id=doctors[1].id, start_date=today + timedelta(days=9),
                                  end_date=today + timedelta(days=11), reason="Annual leave"))

        patients: list[Patient] = []
        for i, (first, last, gender) in enumerate(PATIENTS):
            phone = f"07700 900{100 + i * 7:03d}"
            dob = date(rng.randint(1952, 2014), rng.randint(1, 12), rng.randint(1, 28))
            p = Patient(
                first_name=first, last_name=last, gender=gender, phone=phone, phone_key=phone_key(phone),
                email=f"{first.lower()}.{last.lower().replace(chr(39), '')}@example.com", date_of_birth=dob,
                address=f"{rng.randint(1, 140)} {rng.choice(['Elm Grove', 'Station Road', 'Park Lane', 'Church Street', 'Mill Road'])}, London",
                notes=rng.choice(NOTES),
                source="ai_agent" if i % 4 == 0 else "admin",
                created_at=now - timedelta(days=rng.randint(3, 400), hours=rng.randint(0, 8)),
            )
            session.add(p)
            patients.append(p)
        session.flush()

        service_list = list(services.values())
        ai_appointments: list[Appointment] = []
        for offset in range(-30, 22):
            day = today + timedelta(days=offset)
            per_day = rng.randint(2, 4) if offset < 0 else rng.randint(3, 6) if offset == 0 else rng.randint(2, 5)
            for _ in range(per_day):
                service = rng.choice(service_list)
                slots = compute_slots(session, day, service, respect_notice=False)
                if not slots:
                    continue
                slot = rng.choice(slots)
                patient = rng.choice(patients)
                source = "ai_agent" if rng.random() < (0.3 if offset < 0 else 0.45) else "admin"
                if slot["start"] < now:
                    status = rng.choices(["completed", "no_show", "cancelled"], [82, 7, 11])[0]
                else:
                    status = rng.choices(["scheduled", "confirmed"], [65, 35])[0]
                created = min(now, slot["start"] - timedelta(days=rng.randint(1, 14), hours=rng.randint(0, 9)))
                appt = Appointment(
                    patient_id=patient.id, doctor_id=slot["doctor_id"], service_id=service.id,
                    start=slot["start"], end=slot["end"], status=status, source=source,
                    created_at=created, updated_at=created,
                    cancel_reason="Patient unwell" if status == "cancelled" else "",
                )
                session.add(appt)
                session.flush()
                if source == "ai_agent" and slot["start"] > now:
                    ai_appointments.append(appt)

        _seed_calls(session, rng, now, patients, ai_appointments, services)

        session.add(AdminUser(email=ADMIN_EMAIL.lower(), name="Practice Manager",
                              password_hash=hash_password(ADMIN_PASSWORD)))
        session.commit()


def _seed_calls(session, rng, now, patients, ai_appointments, services) -> None:
    def call(days_ago: float, minutes: float, channel: str, number: str, patient, outcome: str,
             transcript: list, actions: list) -> CallLog:
        start = now - timedelta(days=days_ago)
        c = CallLog(room_name=f"demo-{rng.randint(1000, 9999)}", channel=channel, caller_number=number,
                    patient_id=patient.id if patient else None, started_at=start,
                    ended_at=start + timedelta(minutes=minutes), duration_seconds=int(minutes * 60),
                    status="completed", outcome=outcome, transcript=transcript, actions=actions)
        session.add(c)
        session.flush()
        return c

    p0 = patients[1]
    appt = ai_appointments[0] if ai_appointments else None
    when = timeutil.spoken_datetime(appt.start) if appt else "Friday at 10 am"
    c1 = call(0.2, 2.6, "phone", p0.phone, p0, "Appointment booked", [
        {"role": "assistant", "text": "Hello, thank you for calling Bright Smile Dental Hospital, you're speaking with Sophie. How can I help you today?"},
        {"role": "user", "text": f"Hi, it's {p0.first_name} {p0.last_name}, I'd like to book in for a clean please."},
        {"role": "assistant", "text": "Lovely, of course. Could I just take your date of birth to find your record?"},
        {"role": "user", "text": p0.date_of_birth.strftime("%d %B %Y") if p0.date_of_birth else "Sure"},
        {"role": "assistant", "text": f"Brilliant, thank you {p0.first_name}. I've got {when} with our hygienist, would that suit?"},
        {"role": "user", "text": "Yes, perfect."},
        {"role": "assistant", "text": f"Done! You're booked in for {when}. Is there anything else I can help with?"},
        {"role": "user", "text": "No that's all, thanks!"},
        {"role": "assistant", "text": "You're very welcome, have a lovely day. Bye now!"},
    ], [
        {"tool": "lookup_patient", "ok": True, "summary": f"Found {p0.first_name} {p0.last_name}"},
        {"tool": "check_availability", "ok": True, "summary": "Scale & Polish slots offered"},
        {"tool": "book_appointment", "ok": True, "summary": f"Booked for {when}"},
    ])
    if appt:
        appt.call_id = c1.id
        appt.patient_id = p0.id
        session.add(appt)

    call(0.9, 1.4, "web", "", None, "Enquiry", [
        {"role": "assistant", "text": "Hello, thank you for calling Bright Smile Dental Hospital, you're speaking with Sophie. How can I help you today?"},
        {"role": "user", "text": "Hi, are you open on Saturdays, and do you take Bupa?"},
        {"role": "assistant", "text": "We are, yes, from 9 am until 2 pm on Saturdays. And we do accept Bupa, as well as AXA and Denplan."},
        {"role": "user", "text": "Great, thank you."},
        {"role": "assistant", "text": "No worries at all. Would you like me to book you in while you're on the line?"},
        {"role": "user", "text": "Not right now, I'll call back. Thanks!"},
        {"role": "assistant", "text": "Of course. Have a lovely day!"},
    ], [])

    p2 = patients[13]
    call(1.3, 1.9, "phone", p2.phone, p2, "Message taken", [
        {"role": "assistant", "text": "Hello, thank you for calling Bright Smile Dental Hospital, you're speaking with Sophie. How can I help you today?"},
        {"role": "user", "text": "Hi, I had a question about my last invoice, I think I was charged twice."},
        {"role": "assistant", "text": "Oh, I'm sorry about that. I can't see billing details myself, but I'll take a message for our accounts team and they'll call you back today. Is this number the best one to reach you on?"},
        {"role": "user", "text": "Yes, that's fine."},
        {"role": "assistant", "text": "Lovely, I've passed that on. Someone will be in touch shortly."},
    ], [{"tool": "take_message", "ok": True, "summary": "Billing query - possible double charge"}])
    session.add(Message(caller_name=f"{p2.first_name} {p2.last_name}", phone=p2.phone,
                        message="Thinks they were charged twice for their last visit. Please call back.",
                        category="issue", urgency="normal", patient_id=p2.id, created_at=now - timedelta(days=1.3)))

    p3 = patients[20]
    call(2.4, 3.1, "phone", p3.phone, p3, "Appointment booked", [
        {"role": "assistant", "text": "Hello, thank you for calling Bright Smile Dental Hospital, you're speaking with Sophie. How can I help you today?"},
        {"role": "user", "text": "Hi, I've got really bad toothache since last night."},
        {"role": "assistant", "text": "Oh no, I'm so sorry, that sounds really uncomfortable. Is there any swelling in your face, or any trouble breathing or swallowing?"},
        {"role": "user", "text": "No, just the pain."},
        {"role": "assistant", "text": "Okay, thank you. Let me find you the earliest emergency appointment."},
    ], [
        {"tool": "lookup_patient", "ok": True, "summary": f"Found {p3.first_name} {p3.last_name}"},
        {"tool": "check_availability", "ok": True, "summary": "Emergency slots offered"},
        {"tool": "book_appointment", "ok": True, "summary": "Emergency appointment booked"},
    ])

    session.add(Message(caller_name="Rebecca Moore", phone="07700 900987",
                        message="Wants to know if implant consultations can be done on a Saturday. Please call back.",
                        category="appointment", urgency="normal", created_at=now - timedelta(hours=5)))
    session.add(Message(caller_name="Tom Fletcher", phone="07700 900654",
                        message="Crown came off this morning, can't make any of the offered times. Asked for a call back ASAP.",
                        category="appointment", urgency="urgent", created_at=now - timedelta(hours=2)))
    session.add(Message(caller_name="Daniel Hughes", phone="07700 900432",
                        message="Unhappy that his hygiene appointment last week started 40 minutes late and felt rushed. "
                                "Would like the practice manager to call him.",
                        category="complaint", urgency="normal", created_at=now - timedelta(hours=26)))
    session.add(Message(caller_name="Hannah Price", phone="07700 900321",
                        message="Asked for a copy of her X-rays to be emailed.", category="general", urgency="normal",
                        status="done", created_at=now - timedelta(days=4)))


if __name__ == "__main__":
    seed(reset="--reset" in sys.argv)
    print("Database seeded with demo data.")
