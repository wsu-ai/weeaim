"""Server-issued session tokens, carried in an HttpOnly cookie.

The token names the user and the active organization, both chosen
server-side after verifying identity and membership. The browser can't read
or forge it; get_auth_context still re-checks membership on every request,
so revoking a membership takes effect immediately.
"""

import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import lru_cache

import jwt
from fastapi import Response

from app.config import settings

logger = logging.getLogger(__name__)

SESSION_COOKIE = "weeaim_session"
_TOKEN_TYPE = "weeaim-session"
_MIN_SECRET_LENGTH = 32


class SessionConfigError(RuntimeError):
    """SESSION_SECRET is missing or too short in production."""


@dataclass(frozen=True)
class SessionClaims:
    user_id: uuid.UUID
    organization_id: uuid.UUID | None


@lru_cache
def _dev_fallback_secret() -> str:
    logger.warning(
        "SESSION_SECRET is not set; using a temporary secret. Sessions end "
        "whenever the server restarts. Set SESSION_SECRET in .env."
    )
    return secrets.token_urlsafe(48)


def signing_secret() -> str:
    secret = settings.session_secret
    if len(secret) >= _MIN_SECRET_LENGTH:
        return secret
    if settings.is_production:
        raise SessionConfigError(
            f"SESSION_SECRET must be set to at least {_MIN_SECRET_LENGTH} characters"
        )
    return _dev_fallback_secret()


def issue_session_token(user_id: uuid.UUID, organization_id: uuid.UUID | None) -> str:
    now = datetime.now(UTC)
    payload = {
        "typ": _TOKEN_TYPE,
        "sub": str(user_id),
        "org": str(organization_id) if organization_id else None,
        "iat": now,
        "exp": now + timedelta(minutes=settings.session_ttl_minutes),
    }
    return jwt.encode(payload, signing_secret(), algorithm="HS256")


def read_session_token(token: str) -> SessionClaims | None:
    """Returns None for any invalid, tampered or expired token."""
    secret = signing_secret()
    try:
        claims = jwt.decode(
            token, secret, algorithms=["HS256"], options={"require": ["exp", "iat", "sub"]}
        )
        if claims.get("typ") != _TOKEN_TYPE:
            return None
        org = claims.get("org")
        return SessionClaims(
            user_id=uuid.UUID(claims["sub"]),
            organization_id=uuid.UUID(org) if org else None,
        )
    except (jwt.PyJWTError, ValueError, TypeError):
        return None


def _cookie_secure() -> bool:
    if settings.session_cookie_secure is not None:
        return settings.session_cookie_secure
    return settings.is_production


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_ttl_minutes * 60,
        httponly=True,
        samesite="lax",
        secure=_cookie_secure(),
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        SESSION_COOKIE, path="/", httponly=True, samesite="lax", secure=_cookie_secure()
    )
