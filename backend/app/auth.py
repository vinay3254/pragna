from datetime import datetime, timedelta, timezone
from typing import Optional
import jwt
from fastapi import Header, HTTPException, Request
from passlib.context import CryptContext
from app import repository

ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 30

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _pwd_context.verify(password, password_hash)


def create_access_token(user_id: int, email: str, secret: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=TOKEN_EXPIRE_DAYS)
    payload = {"sub": str(user_id), "email": email, "exp": expire}
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def decode_access_token(token: str, secret: str) -> Optional[dict]:
    try:
        return jwt.decode(token, secret, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None


async def get_current_user(request: Request, authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = authorization[len("Bearer "):]
    secret = request.app.state.settings.jwt_secret
    payload = decode_access_token(token, secret)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user = repository.get_user(request.app.state.conn, int(payload["sub"]))
    if not user:
        raise HTTPException(status_code=401, detail="User no longer exists")

    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "avatar_url": user["avatar_url"],
        "plan": user.get("plan", "free"),
    }


async def get_optional_current_user(request: Request, authorization: str = Header(None)) -> dict:
    if authorization and authorization.startswith("Bearer "):
        token = authorization[len("Bearer "):]
        secret = request.app.state.settings.jwt_secret
        payload = decode_access_token(token, secret)
        if payload and "sub" in payload:
            try:
                user = repository.get_user(request.app.state.conn, int(payload["sub"]))
                if user:
                    return {
                        "id": user["id"],
                        "email": user["email"],
                        "name": user["name"],
                        "avatar_url": user["avatar_url"],
                        "plan": user.get("plan", "free"),
                    }
            except Exception:
                pass

    conn = request.app.state.conn
    guest = repository.get_user_by_email(conn, "guest@pragna.ai")
    if not guest:
        uid = repository.create_user(conn, "guest@pragna.ai", hash_password("GuestPass2026!"), name="Guest")
        return {"id": uid, "email": "guest@pragna.ai", "name": "Guest", "avatar_url": None, "plan": "free"}
    return {
        "id": guest["id"],
        "email": guest["email"],
        "name": guest["name"],
        "avatar_url": guest.get("avatar_url"),
        "plan": guest.get("plan", "free"),
    }
