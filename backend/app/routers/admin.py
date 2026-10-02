"""Admin dashboard API: review self-service sign-ups.

Access: any active user who is an owner or admin of at least one
organization. They may approve sign-ups only into organizations they own or
administer -- checked here, server-side, from the session cookie and the
database; nothing the browser sends decides authorization.
"""

import logging
import uuid
from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import signup_review
from app.db import get_session
from app.dependencies import get_email_sender
from app.mailer import EmailSender, OutgoingEmail
from app.models import Organization, OrganizationMember, User
from app.schemas import (
    AdminOrganization,
    ApproveSignupRequest,
    RejectSignupRequest,
    ReviewResult,
    SignupReviewItem,
)
from app.sessions import SESSION_COOKIE, read_session_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])

ADMIN_ROLES = ("owner", "admin")
# Owners may hand out any role; admins may not create owners.
GRANTABLE_ROLES = {"owner": ["member", "admin", "owner"], "admin": ["member", "admin"]}


@dataclass
class AdminContext:
    user_id: uuid.UUID
    # Organizations this user administers, keyed by slug, with their role.
    organizations: dict[str, tuple[Organization, str]]


async def get_admin_context(
    request: Request, session: AsyncSession = Depends(get_session)
) -> AdminContext:
    token = request.cookies.get(SESSION_COOKIE)
    claims = read_session_token(token) if token else None
    if claims is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    user = await session.get(User, claims.user_id)
    if user is None or user.account_status != "active":
        raise HTTPException(status_code=401, detail="Not signed in")

    rows = await session.execute(
        select(Organization, OrganizationMember.role)
        .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
        .where(OrganizationMember.user_id == user.id, OrganizationMember.role.in_(ADMIN_ROLES))
        .order_by(Organization.name)
    )
    organizations = {org.slug: (org, role) for org, role in rows.all()}
    if not organizations:
        raise HTTPException(status_code=403, detail="Admin access required")
    return AdminContext(user_id=user.id, organizations=organizations)


async def _send(sender: EmailSender, message: OutgoingEmail | None) -> bool:
    """Sends after the decision is committed; a failure is reported, not raised."""
    if message is None:
        return False
    try:
        await run_in_threadpool(sender.send, message)
        return True
    except Exception:
        logger.exception("Failed to send email %r to %s", message.subject, message.to)
        return False


@router.get("/organizations", response_model=list[AdminOrganization])
async def admin_organizations(
    admin: AdminContext = Depends(get_admin_context),
) -> list[AdminOrganization]:
    return [
        AdminOrganization(slug=org.slug, name=org.name, grantable_roles=GRANTABLE_ROLES[role])
        for org, role in admin.organizations.values()
    ]


@router.get("/signups", response_model=list[SignupReviewItem])
async def list_signups(
    status: Literal["pending", "approved", "rejected"] = "pending",
    admin: AdminContext = Depends(get_admin_context),
    session: AsyncSession = Depends(get_session),
) -> list[SignupReviewItem]:
    if status == "pending":
        users = await signup_review.list_pending(session)
    else:
        users = await signup_review.list_reviewed(
            session, "active" if status == "approved" else "rejected"
        )

    reviewer_ids = {u.reviewed_by_user_id for u in users if u.reviewed_by_user_id}
    reviewers = dict(
        (await session.execute(select(User.id, User.email).where(User.id.in_(reviewer_ids)))).all()
    ) if reviewer_ids else {}

    organizations: dict[uuid.UUID, list[str]] = {}
    if status == "approved" and users:
        rows = await session.execute(
            select(OrganizationMember.user_id, Organization.name)
            .join(Organization, Organization.id == OrganizationMember.organization_id)
            .where(OrganizationMember.user_id.in_([u.id for u in users]))
            .order_by(Organization.name)
        )
        for user_id, name in rows.all():
            organizations.setdefault(user_id, []).append(name)

    return [
        SignupReviewItem(
            id=u.id,
            full_name=u.display_name,
            email=u.email,
            affiliation=u.affiliation,
            affiliation_name=u.affiliation_name,
            department=u.department,
            preferred_language=u.preferred_language,
            access_reason=u.access_reason,
            registered_at=u.created_at,
            verified_at=u.email_verified_at,
            status=status,
            reviewed_at=u.reviewed_at,
            reviewed_by=reviewers.get(u.reviewed_by_user_id),
            review_note=u.review_note,
            organizations=organizations.get(u.id, []),
        )
        for u in users
    ]


def _review_error(exc: signup_review.SignupError) -> HTTPException:
    if isinstance(exc, signup_review.SignupNotFound):
        return HTTPException(status_code=404, detail="Sign-up not found")
    if isinstance(exc, signup_review.SignupNotPending):
        return HTTPException(status_code=409, detail="already_reviewed")
    return HTTPException(status_code=422, detail=str(exc))


@router.post("/signups/{user_id}/approve", response_model=ReviewResult)
async def approve_signup(
    user_id: uuid.UUID,
    payload: ApproveSignupRequest,
    admin: AdminContext = Depends(get_admin_context),
    session: AsyncSession = Depends(get_session),
    sender: EmailSender = Depends(get_email_sender),
) -> ReviewResult:
    target = admin.organizations.get(payload.organization_slug)
    if target is None:
        raise HTTPException(
            status_code=403, detail="You can only approve into organizations you administer"
        )
    organization, admin_role = target
    if payload.role not in GRANTABLE_ROLES[admin_role]:
        raise HTTPException(status_code=403, detail="You can't grant that role")

    try:
        message = await signup_review.approve(
            session, user_id, organization, payload.role, reviewer_id=admin.user_id
        )
    except signup_review.SignupError as exc:
        raise _review_error(exc)
    return ReviewResult(status="approved", email_sent=await _send(sender, message))


@router.post("/signups/{user_id}/reject", response_model=ReviewResult)
async def reject_signup(
    user_id: uuid.UUID,
    payload: RejectSignupRequest,
    admin: AdminContext = Depends(get_admin_context),
    session: AsyncSession = Depends(get_session),
    sender: EmailSender = Depends(get_email_sender),
) -> ReviewResult:
    try:
        message = await signup_review.reject(
            session, user_id, reviewer_id=admin.user_id, note=payload.note
        )
    except signup_review.SignupError as exc:
        raise _review_error(exc)
    return ReviewResult(status="rejected", email_sent=await _send(sender, message))
