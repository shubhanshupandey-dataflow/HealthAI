"""Shareable "try the assistant" links.

Staff create a link that expires after a number of hours; anyone with it can call the assistant
from their browser without signing in. They call as an unknown number (no caller ID), so to see or
change appointments they verify themselves on the call like any new caller.
"""

import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, col, select

from .. import timeutil
from ..auth import require_admin
from ..db import get_session
from ..domain import get_agent_settings, get_clinic
from ..livekit_calls import web_call_token
from ..models import AdminUser, ShareLink

router = APIRouter(prefix="/api/share-links", tags=["share links"], dependencies=[Depends(require_admin)])
public_router = APIRouter(prefix="/api/public/try", tags=["public"])


class ShareLinkIn(BaseModel):
    hours: float = Field(default=6, gt=0, le=720)


def link_out(link: ShareLink) -> dict:
    return {
        "id": link.id,
        "token": link.token,
        "path": f"/try/{link.token}",
        "created_by": link.created_by,
        "created_at": link.created_at,
        "expires_at": link.expires_at,
    }


@router.get("")
def list_share_links(session: Session = Depends(get_session)):
    links = session.exec(
        select(ShareLink)
        .where(ShareLink.revoked == False, ShareLink.expires_at > timeutil.now())  # noqa: E712
        .order_by(col(ShareLink.expires_at))
    ).all()
    return [link_out(link) for link in links]


@router.post("")
def create_share_link(
    body: ShareLinkIn,
    user: AdminUser = Depends(require_admin),
    session: Session = Depends(get_session),
):
    link = ShareLink(
        token=secrets.token_urlsafe(16),
        created_by=user.email,
        expires_at=timeutil.now() + timedelta(hours=body.hours),
    )
    session.add(link)
    session.commit()
    session.refresh(link)
    return link_out(link)


@router.delete("/{link_id}")
def stop_share_link(link_id: int, session: Session = Depends(get_session)):
    link = session.get(ShareLink, link_id)
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    link.revoked = True
    session.add(link)
    session.commit()
    return {"ok": True}


# ---------------------------------------------------------------- public (no sign-in)


def active_link(token: str, session: Session) -> ShareLink:
    link = session.exec(select(ShareLink).where(ShareLink.token == token)).first()
    if not link or link.revoked:
        raise HTTPException(status_code=404, detail="This test link isn't valid. Ask the clinic team for a new one.")
    if link.expires_at <= timeutil.now():
        raise HTTPException(status_code=410, detail="This test link has expired. Ask the clinic team for a new one.")
    return link


@public_router.get("/{token}")
def share_link_info(token: str, session: Session = Depends(get_session)):
    link = active_link(token, session)
    return {
        "agent_name": get_agent_settings(session).agent_name,
        "clinic_name": get_clinic(session).name,
        "expires_at": link.expires_at,
    }


@public_router.post("/{token}/call")
def share_link_call(token: str, session: Session = Depends(get_session)):
    active_link(token, session)
    return web_call_token("Test caller")
