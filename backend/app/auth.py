import uuid
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_session
from app.models import Organization, OrganizationMember, User
from app.sessions import SESSION_COOKIE, read_session_token


@dataclass
class AuthContext:
    user_id: uuid.UUID
    organization_id: uuid.UUID


async def find_membership(
    session: AsyncSession, user_id: uuid.UUID, organization_id: uuid.UUID
) -> OrganizationMember | None:
    return (
        await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == organization_id,
            )
        )
    ).scalar_one_or_none()


async def get_auth_context(
    request: Request,
    x_dev_user_email: str | None = Header(default=None),
    x_dev_organization_slug: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> AuthContext:
    """Resolves the signed-in user and active organization for a request.

    Normal path: the HttpOnly session cookie issued at sign-in (see
    app/routers/auth.py). The organization comes from that server-signed
    token -- never from the client -- and membership is re-checked here on
    every request, so removing a member locks them out immediately.

    Dev-only fallback: the X-Dev-* headers, still used by the backend test
    suite. Ignored entirely in production. They only resolve identity that
    already exists (seeded by scripts/seed_dev_org.py), never create it.
    """
    token = request.cookies.get(SESSION_COOKIE)
    if token is not None:
        claims = read_session_token(token)
        if claims is None:
            raise HTTPException(status_code=401, detail="Session expired or invalid")
        if claims.organization_id is None:
            raise HTTPException(status_code=401, detail="Organization not selected")
        user = await session.get(User, claims.user_id)
        membership = await find_membership(session, claims.user_id, claims.organization_id)
        # Re-checked on every request: disabling an account or removing a
        # membership ends access immediately, without waiting for expiry.
        if user is None or user.account_status != "active" or membership is None:
            raise HTTPException(status_code=401, detail="Session is no longer valid")
        return AuthContext(user_id=claims.user_id, organization_id=claims.organization_id)

    if settings.is_production:
        raise HTTPException(status_code=401, detail="Not signed in")

    if not x_dev_user_email or not x_dev_organization_slug:
        raise HTTPException(status_code=401, detail="Missing dev auth headers")

    user = (
        await session.execute(select(User).where(User.email == x_dev_user_email))
    ).scalar_one_or_none()
    organization = (
        await session.execute(
            select(Organization).where(Organization.slug == x_dev_organization_slug)
        )
    ).scalar_one_or_none()
    if user is None or organization is None or user.account_status != "active":
        raise HTTPException(status_code=401, detail="Unknown user or organization")

    if await find_membership(session, user.id, organization.id) is None:
        raise HTTPException(status_code=401, detail="User is not a member of this organization")

    return AuthContext(user_id=user.id, organization_id=organization.id)
