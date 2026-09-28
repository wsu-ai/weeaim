import uuid
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_session
from app.models import Organization, OrganizationMember, User


@dataclass
class AuthContext:
    user_id: uuid.UUID
    organization_id: uuid.UUID


async def get_auth_context(
    x_dev_user_email: str | None = Header(default=None),
    x_dev_organization_slug: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> AuthContext:
    """Temporary dev-only auth adapter.

    There is no real identity provider yet. This never activates outside
    local development, and it never creates an organization/user/membership
    from request headers -- it only resolves identity that already exists,
    seeded by scripts/seed_dev_org.py. Replace this whole function (not its
    callers) once a real IdP is wired up.
    """
    if settings.environment == "production":
        raise HTTPException(status_code=501, detail="Auth is not configured")

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
    if user is None or organization is None:
        raise HTTPException(status_code=401, detail="Unknown user or organization")

    membership = (
        await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.user_id == user.id,
                OrganizationMember.organization_id == organization.id,
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        raise HTTPException(status_code=401, detail="User is not a member of this organization")

    return AuthContext(user_id=user.id, organization_id=organization.id)
