"""Re-authentication before destructive venture actions (archive, permanent
delete): the signed-in user's password, or -- for accounts without one,
e.g. Google sign-in -- a 6-digit code emailed to them.

Wrong passwords count toward the same lockout as sign-in, so this can't be
used to guess a password around the login limit.
"""

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.email_codes import check_code
from app.models import User
from app.passwords import verify_password

CODE_PURPOSE = "confirm_venture_action"
WRONG_PASSWORD = "wrong_password"
WRONG_CODE = "wrong_code"
TOO_MANY_ATTEMPTS = "too_many_attempts"


class ReauthRequest(BaseModel):
    password: str | None = Field(default=None, max_length=200)
    code: str | None = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def exactly_one(self) -> "ReauthRequest":
        if bool(self.password) == bool(self.code):
            raise ValueError("Send either your password or the emailed code")
        return self


async def verify_reauth(session: AsyncSession, user: User, request: ReauthRequest) -> None:
    """Raises 403/429 unless the request proves it's the signed-in user.
    A failed attempt is committed before raising."""
    now = datetime.now(UTC)
    if request.code is not None:
        if not await check_code(session, user.id, CODE_PURPOSE, request.code):
            await session.commit()  # records the attempt
            raise HTTPException(status_code=403, detail=WRONG_CODE)
        return

    if user.locked_until is not None and user.locked_until > now:
        await run_in_threadpool(verify_password, None, request.password)  # same timing
        raise HTTPException(status_code=429, detail=TOO_MANY_ATTEMPTS)
    if not await run_in_threadpool(verify_password, user.password_hash, request.password):
        if user.password_hash is not None:
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= settings.login_max_failed_attempts:
                user.locked_until = now + timedelta(minutes=settings.login_lockout_minutes)
                user.failed_login_attempts = 0
            await session.commit()
        raise HTTPException(status_code=403, detail=WRONG_PASSWORD)
    if user.failed_login_attempts or user.locked_until is not None:
        user.failed_login_attempts = 0
        user.locked_until = None
