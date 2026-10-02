"""Approving and rejecting self-service sign-ups.

Shared by the admin dashboard (app/routers/admin.py) and the command-line
tool (scripts/manage_signups.py). Callers decide who may review and into
which organization; this module applies the decision. Each function commits
and returns the email to send (or None), which the caller sends afterwards
so an email failure can't undo a decision.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import mail_templates
from app.mailer import OutgoingEmail
from app.models import AuditLog, Organization, OrganizationMember, User
from app.tenancy import set_current_organization

ROLES = ("owner", "admin", "member")


class SignupError(Exception):
    pass


class SignupNotFound(SignupError):
    pass


class SignupNotPending(SignupError):
    pass


async def find_user_id(session: AsyncSession, email: str) -> uuid.UUID:
    user_id = (
        await session.execute(
            select(User.id).where(func.lower(User.email) == email.strip().lower())
        )
    ).scalar_one_or_none()
    if user_id is None:
        raise SignupNotFound(f"No user with email {email}")
    return user_id


async def _lock_pending(session: AsyncSession, user_id: uuid.UUID) -> User:
    # Row lock: two reviewers acting at once can't both decide.
    user = (
        await session.execute(
            select(User).where(User.id == user_id).with_for_update().execution_options(
                populate_existing=True
            )
        )
    ).scalar_one_or_none()
    if user is None:
        raise SignupNotFound("No such sign-up")
    if user.account_status != "pending":
        raise SignupNotPending(f"{user.email} is not pending (status: {user.account_status})")
    return user


async def list_pending(session: AsyncSession) -> list[User]:
    """Verified sign-ups awaiting a decision, oldest first."""
    return list(
        (
            await session.execute(
                select(User)
                .where(User.account_status == "pending", User.email_verified_at.is_not(None))
                .order_by(User.created_at)
            )
        ).scalars()
    )


async def list_reviewed(session: AsyncSession, status: str, limit: int = 100) -> list[User]:
    """Recently approved ("active") or "rejected" sign-ups, newest decision first."""
    return list(
        (
            await session.execute(
                select(User)
                .where(User.account_status == status, User.reviewed_at.is_not(None))
                .order_by(User.reviewed_at.desc())
                .limit(limit)
            )
        ).scalars()
    )


async def approve(
    session: AsyncSession,
    user_id: uuid.UUID,
    organization: Organization,
    role: str,
    reviewer_id: uuid.UUID | None,
) -> OutgoingEmail:
    if role not in ROLES:
        raise SignupError(f"Role must be one of {', '.join(ROLES)}")
    user = await _lock_pending(session, user_id)
    if user.email_verified_at is None:
        raise SignupError(f"{user.email} hasn't verified their email yet")

    user.account_status = "active"
    user.reviewed_at = datetime.now(UTC)
    user.reviewed_by_user_id = reviewer_id
    user.review_note = None

    existing = (
        await session.execute(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == organization.id,
                OrganizationMember.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        session.add(
            OrganizationMember(organization_id=organization.id, user_id=user.id, role=role)
        )

    # The approval belongs to the organization the user joins.
    await set_current_organization(session, organization.id)
    session.add(
        AuditLog(
            organization_id=organization.id,
            actor_user_id=reviewer_id,
            action="signup.approved",
            resource_type="user",
            resource_id=user.id,
            log_metadata={"email": user.email, "role": role},
        )
    )
    await session.commit()
    return mail_templates.account_approved(user.email, user.preferred_language, organization.name)


async def reject(
    session: AsyncSession,
    user_id: uuid.UUID,
    reviewer_id: uuid.UUID | None,
    note: str | None = None,
) -> OutgoingEmail | None:
    user = await _lock_pending(session, user_id)
    user.account_status = "rejected"
    user.reviewed_at = datetime.now(UTC)
    user.reviewed_by_user_id = reviewer_id
    user.review_note = note or None
    await session.commit()
    # Only email addresses that were proven to belong to the applicant.
    if user.email_verified_at is None:
        return None
    return mail_templates.account_rejected(user.email, user.preferred_language, note)
