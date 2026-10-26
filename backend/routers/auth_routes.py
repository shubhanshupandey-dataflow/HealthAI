from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import create_token, hash_password, require_admin, verify_password
from ..db import get_session
from ..models import AdminUser

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


class PasswordIn(BaseModel):
    current_password: str
    new_password: str


def user_out(user: AdminUser) -> dict:
    return {"id": user.id, "email": user.email, "name": user.name}


@router.post("/login")
def login(body: LoginIn, session: Session = Depends(get_session)):
    user = session.exec(select(AdminUser).where(AdminUser.email == body.email.strip().lower())).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    return {"token": create_token(user), "user": user_out(user)}


@router.get("/me")
def me(user: AdminUser = Depends(require_admin)):
    return user_out(user)


@router.post("/password")
def change_password(
    body: PasswordIn,
    user: AdminUser = Depends(require_admin),
    session: Session = Depends(get_session),
):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    user.password_hash = hash_password(body.new_password)
    session.add(user)
    session.commit()
    return {"ok": True}
