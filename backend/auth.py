"""FILE: backend/auth.py
PURPOSE: Password hashing and opaque database-backed login tokens.
HOW IT FITS: main.py /auth routes -> crud users/auth_sessions -> this module
  hashes passwords (scrypt) and mints/validates random tokens (only the SHA-256
  hash is stored, so a DB leak cannot be replayed as a login).
WHERE TO EDIT: Password rules in validate_password; token lifetime in
  TOKEN_TTL_DAYS. No third-party crypto dependency on purpose.
"""
import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

import crud
from models_db import User

TOKEN_TTL_DAYS: int = 30

# scrypt cost: 16MB per hash (128 * N * r). Deliberately slow enough to make
# offline guessing expensive, cheap enough for a free-tier single worker.
_SCRYPT_N: int = 2 ** 14
_SCRYPT_R: int = 8
_SCRYPT_P: int = 1
_SCRYPT_DKLEN: int = 32

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(raw: str) -> str:
    return (raw or "").strip().lower()


def email_error(email: str) -> str:
    if not email:
        return "Enter your email address"
    if len(email) > 254:
        return "Email address is too long"
    if not _EMAIL_RE.match(email):
        return "Enter a valid email address"
    local, _, _domain = email.partition("@")
    if len(local) > 64:
        return "Email address is too long"
    return ""


def validate_password(password: str) -> str:
    if len(password) < 8:
        return "Password must be at least 8 characters"
    if len(password) > 128:
        return "Password must be at most 128 characters"
    return ""


def hash_password(password: str) -> str:
    salt: bytes = secrets.token_bytes(16)
    key: bytes = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_SCRYPT_DKLEN,
    )
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${key.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n_raw, r_raw, p_raw, salt_hex, key_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        n, r, p = int(n_raw), int(r_raw), int(p_raw)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(key_hex)
        if not expected:
            return False
        actual: bytes = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=n,
            r=r,
            p=p,
            dklen=len(expected),
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, MemoryError):
        return False


# Hash a dummy password once so a login for an unknown email spends roughly
# the same time as a real verification (no cheap account-enumeration signal).
_DUMMY_HASH: str = hash_password("sieve-not-a-real-password")


def verify_login(password: str, user: Optional[User]) -> bool:
    if user is None:
        verify_password(password, _DUMMY_HASH)
        return False
    return verify_password(password, user.password_hash)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_token(db: Session, user: User) -> str:
    raw: str = secrets.token_urlsafe(32)
    now: datetime = datetime.now(timezone.utc)
    crud.create_auth_session(
        db,
        token_hash=_hash_token(raw),
        user_id=user.id,
        created_at=now,
        expires_at=now + timedelta(days=TOKEN_TTL_DAYS),
    )
    return raw


def resolve_token(db: Session, token: Optional[str]) -> Optional[User]:
    if not token:
        return None
    row = crud.get_auth_session(db, _hash_token(token))
    if row is None:
        return None
    expires = row.expires_at
    # SQLite returns naive datetimes even though they were stored as UTC.
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= datetime.now(timezone.utc):
        crud.delete_auth_session(db, row.token_hash)
        return None
    return crud.get_user(db, row.user_id)


def revoke_token(db: Session, token: Optional[str]) -> int:
    if not token:
        return 0
    return crud.delete_auth_session(db, _hash_token(token))


def purge_expired_sessions(db: Session) -> int:
    # Naive UTC matches the stored DateTime columns (see crud.purge_old_records).
    cutoff: datetime = datetime.now(timezone.utc).replace(tzinfo=None)
    return crud.delete_expired_auth_sessions(db, cutoff)
