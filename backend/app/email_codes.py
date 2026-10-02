"""One-time 6-digit codes for email verification and password reset.

Only an HMAC of each code is stored (keyed with SESSION_SECRET), each code
expires, allows a limited number of guesses, and issuing a new code retires
the previous one.
"""

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import EmailCode
from app.sessions import signing_secret


def _digest(user_id: uuid.UUID, purpose: str, code: str) -> str:
    message = f"{user_id}:{purpose}:{code}".encode()
    return hmac.new(signing_secret().encode(), message, hashlib.sha256).hexdigest()


async def issue_code(session: AsyncSession, user_id: uuid.UUID, purpose: str) -> str | None:
    """Creates a new code and returns it, or None if one was issued too recently.

    The caller commits. Earlier codes for the same purpose stop working.
    """
    now = datetime.now(UTC)
    latest = (
        await session.execute(
            select(EmailCode.created_at)
            .where(EmailCode.user_id == user_id, EmailCode.purpose == purpose)
            .order_by(EmailCode.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if latest is not None and now - latest < timedelta(seconds=settings.email_code_resend_seconds):
        return None

    await session.execute(
        update(EmailCode)
        .where(
            EmailCode.user_id == user_id,
            EmailCode.purpose == purpose,
            EmailCode.consumed_at.is_(None),
        )
        .values(consumed_at=now)
    )
    code = f"{secrets.randbelow(1_000_000):06d}"
    session.add(
        EmailCode(
            user_id=user_id,
            purpose=purpose,
            code_hash=_digest(user_id, purpose, code),
            expires_at=now + timedelta(minutes=settings.email_code_ttl_minutes),
            attempts=0,
            created_at=now,
        )
    )
    await session.flush()
    return code


async def check_code(
    session: AsyncSession, user_id: uuid.UUID, purpose: str, code: str
) -> bool:
    """True and consumes the code if it matches the user's current code.

    Every check counts as an attempt, right or wrong. The caller commits.
    """
    now = datetime.now(UTC)
    current = (
        await session.execute(
            select(EmailCode)
            .where(
                EmailCode.user_id == user_id,
                EmailCode.purpose == purpose,
                EmailCode.consumed_at.is_(None),
                EmailCode.expires_at > now,
            )
            .order_by(EmailCode.created_at.desc())
            .limit(1)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if current is None or current.attempts >= settings.email_code_max_attempts:
        return False

    current.attempts += 1
    if not hmac.compare_digest(current.code_hash, _digest(user_id, purpose, code.strip())):
        return False
    current.consumed_at = now
    return True
