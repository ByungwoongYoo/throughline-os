"""Local-first authentication.

A desktop install has one researcher, but the account still exists: it scopes
projects, signs the audit trail, and means the same code runs unchanged if
this is later hosted. Sessions are opaque random tokens stored only as hashes,
so a stolen database file does not yield usable credentials.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from .events import audit
from .ids import new_id

SESSION_COOKIE = "throughline_session"
SESSION_DAYS = 30
PBKDF2_ROUNDS = 600_000  # OWASP guidance for PBKDF2-HMAC-SHA256, 2023 onwards.
_DUMMY_SALT = b"\x00" * 16


class AuthError(RuntimeError):
    pass


def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS).hex()


def set_password(cur, *, user_id: str, password: str) -> None:
    """
    Replace a password, re-salting it.

    A new salt every time on purpose: reusing the old one would make two
    password hashes for the same account comparable, which leaks whether a
    password was actually changed.
    """
    if len(password) < 12:
        raise AuthError("Password must contain at least 12 characters.")
    salt = secrets.token_bytes(16)
    cur.execute(
        "UPDATE users SET password_hash = %s, password_salt = %s WHERE id = %s",
        (_hash_password(password, salt), salt.hex(), user_id))
    audit(cur, project_id=None, actor=user_id, action="update",
          object_type="user", object_id=user_id,
          detail={"changed": "password"})


def destroy_other_sessions(cur, *, user_id: str,
                           keep_token: str | None = None) -> int:
    """
    Sign this user out everywhere except here.

    Called on a password change, because a change is usually a response to the
    suspicion that someone else has the old one — and leaving their session
    alive is the single thing that would make the change pointless.
    """
    if keep_token:
        cur.execute(
            "DELETE FROM sessions WHERE user_id = %s AND token_hash <> %s",
            (user_id,
             hashlib.sha256(keep_token.encode("utf-8")).hexdigest()))
    else:
        cur.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))
    return cur.rowcount


def set_password(cur, *, user_id: str, password: str) -> None:
    """
    Replace a password, re-salting it.

    A new salt every time on purpose: reusing the old one would make two
    password hashes for the same account comparable, which leaks whether a
    password was actually changed.
    """
    if len(password) < 12:
        raise AuthError("Password must contain at least 12 characters.")
    salt = secrets.token_bytes(16)
    cur.execute(
        "UPDATE users SET password_hash = %s, password_salt = %s WHERE id = %s",
        (_hash_password(password, salt), salt.hex(), user_id))
    audit(cur, project_id=None, actor=user_id, action="update",
          object_type="user", object_id=user_id,
          detail={"changed": "password"})


def destroy_other_sessions(cur, *, user_id: str,
                           keep_token: str | None = None) -> int:
    """
    Sign this user out everywhere except here.

    Called on a password change, because a change is usually a response to the
    suspicion that someone else has the old one — and leaving their session
    alive is the single thing that would make the change pointless.
    """
    if keep_token:
        cur.execute(
            "DELETE FROM sessions WHERE user_id = %s AND token_hash <> %s",
            (user_id,
             hashlib.sha256(keep_token.encode("utf-8")).hexdigest()))
    else:
        cur.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))
    return cur.rowcount


def create_user(
    cur, *, email: str, display_name: str, password: str, is_admin: bool = True
) -> dict[str, Any]:
    email = email.strip().lower()
    if len(password) < 12:
        # Longer than the usual 8: this password protects an entire research
        # corpus and is typed once on a machine the researcher already controls.
        raise AuthError("Password must contain at least 12 characters.")
    cur.execute("SELECT 1 FROM users WHERE email = %s", (email,))
    if cur.fetchone():
        raise AuthError("An account with this email already exists.")

    salt = secrets.token_bytes(16)
    user_id = new_id("usr")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt, is_admin) "
        "VALUES (%s, %s, %s, %s, %s, %s)",
        (
            user_id,
            email,
            display_name.strip() or email.split("@", 1)[0],
            _hash_password(password, salt),
            salt.hex(),
            is_admin,
        ),
    )
    audit(cur, project_id=None, actor=user_id, action="create", object_type="user",
          object_id=user_id)
    return {"id": user_id, "email": email, "display_name": display_name, "is_admin": is_admin}


def authenticate(cur, *, email: str, password: str) -> dict[str, Any] | None:
    cur.execute("SELECT * FROM users WHERE email = %s", (email.strip().lower(),))
    row = cur.fetchone()
    if not row:
        # Spend the same work on an unknown address so response time does not
        # disclose which emails have accounts.
        _hash_password(password, _DUMMY_SALT)
        return None
    expected = _hash_password(password, bytes.fromhex(row["password_salt"]))
    if not hmac.compare_digest(expected, row["password_hash"]):
        return None
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "is_admin": row["is_admin"],
    }


def create_session(cur, *, user_id: str) -> str:
    """Return the raw token. Only its hash is stored."""
    token = secrets.token_urlsafe(36)
    cur.execute(
        "INSERT INTO sessions(id, user_id, token_hash, expires_at) VALUES (%s, %s, %s, %s)",
        (
            new_id("ses"),
            user_id,
            hashlib.sha256(token.encode("utf-8")).hexdigest(),
            datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS),
        ),
    )
    return token


def resolve_session(cur, token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    cur.execute(
        """
        SELECT u.id, u.email, u.display_name, u.is_admin, s.id AS session_id
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = %s AND s.expires_at > now()
        """,
        (hashlib.sha256(token.encode("utf-8")).hexdigest(),),
    )
    row = cur.fetchone()
    if not row:
        return None
    cur.execute("UPDATE sessions SET last_seen_at = now() WHERE id = %s", (row["session_id"],))
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "is_admin": row["is_admin"],
    }


def destroy_session(cur, token: str | None) -> None:
    if token:
        cur.execute(
            "DELETE FROM sessions WHERE token_hash = %s",
            (hashlib.sha256(token.encode("utf-8")).hexdigest(),),
        )


def purge_expired_sessions(cur) -> int:
    cur.execute("DELETE FROM sessions WHERE expires_at <= now()")
    return cur.rowcount


def owns_project(cur, *, user_id: str, project_id: str) -> bool:
    """Project scoping, enforced server-side and never in the client."""
    cur.execute(
        "SELECT 1 FROM projects WHERE id = %s AND owner_user_id = %s", (project_id, user_id)
    )
    return cur.fetchone() is not None
