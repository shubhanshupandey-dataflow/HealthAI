import base64
import hashlib
import hmac
import os
import time
from typing import Optional

import jwt
from fastapi import Depends, Header, HTTPException
from sqlmodel import Session

from .config import AGENT_API_KEY, JWT_SECRET
from .db import get_session
from .models import AdminUser

TOKEN_TTL_SECONDS = 7 * 24 * 3600


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"pbkdf2${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_b64, digest_b64 = stored.split("$")
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
    except ValueError:
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return hmac.compare_digest(actual, expected)


def create_token(user: AdminUser) -> str:
    payload = {"sub": str(user.id), "email": user.email, "exp": int(time.time()) + TOKEN_TTL_SECONDS}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def require_admin(
    authorization: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
) -> AdminUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not signed in")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Session expired, please sign in again")
    user = session.get(AdminUser, int(payload["sub"]))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_agent(x_agent_key: Optional[str] = Header(default=None)) -> None:
    if not x_agent_key or not hmac.compare_digest(x_agent_key, AGENT_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid agent key")
