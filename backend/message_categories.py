"""Categories for the team's message inbox, with a keyword fallback.

Sophie picks the category (and whether it's urgent) herself when she takes a message. The keyword
rules here are only used when no category was given - and for messages saved before categories
existed - plus a safety net that flags clear emergencies as urgent.
"""

from __future__ import annotations

import re

CATEGORIES = ("appointment", "complaint", "issue", "general")

# Checked in this order: a complaint about an appointment is a complaint, and an appointment
# problem ("my booking is missing") is an appointment rather than a general issue.
_RULES = [
    (
        "complaint",
        r"complain|unhappy|not happy|dissatisf|disappoint|\brude\b|unprofessional|unacceptable|"
        r"poor (service|care|treatment|experience)|bad experience|\bangry\b|furious|compensation|negligen|"
        r"(speak|talk) (to|with) (the )?(practice )?manager",
    ),
    (
        "appointment",
        r"appointment|\bbook(s|ing|ed)?\b|re-?book|re-?schedul|\bcancel|\bslots?\b|check-?up|availability|"
        r"offered times|\bconsultations?\b",
    ),
    (
        "issue",
        r"\bissue|problem|\berror\b|\bwrong\b|not working|broken|\bbroke\b|came off|fell out|cracked|chipped|"
        r"lost (a |my |her |his |their )?(filling|crown|tooth)|\bpain|ache\b|aching|hurt|\bsore\b|bleed|swell|"
        r"charged twice|double[- ]charg|overcharg|invoice|\bbill(s|ing|ed)?\b|payment|insurance|\bclaim\b|refund",
    ),
]
_COMPILED = [(category, re.compile(pattern, re.IGNORECASE)) for category, pattern in _RULES]

_URGENT = re.compile(
    r"\burgent|emergenc|severe|swelling|swollen|bleeding|unbearable|excruciating|knocked out|abscess|"
    r"can[’']?t (sleep|eat|breathe|swallow)",
    re.IGNORECASE,
)
_NOT_URGENT = re.compile(r"\bnot (urgent|an emergency)|\bno rush|isn[’']?t urgent|non-urgent|nothing urgent", re.IGNORECASE)


def categorize(text: str) -> str:
    """Best guess from the wording of a message."""
    for category, pattern in _COMPILED:
        if pattern.search(text or ""):
            return category
    return "general"


def looks_urgent(text: str) -> bool:
    """True when the message clearly describes something that can't wait."""
    text = text or ""
    return bool(_URGENT.search(text)) and not _NOT_URGENT.search(text)
