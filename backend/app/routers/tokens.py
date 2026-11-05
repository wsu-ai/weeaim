"""Token usage and limits for the caller's organization (Settings -> Token Usage).

Everyone in the organization can see the usage; only its owners/admins can
change the limits. Everything runs in the caller's RLS scope.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, find_membership, get_auth_context
from app.db import get_session
from app.models import AuditLog, OrganizationTokenLimits, TokenUsage, Venture
from app.tenancy import set_current_organization
from app.tokens import tokens_used
from app.venture_deletion import DELETER_ROLES

router = APIRouter(prefix="/api/token-usage", tags=["tokens"])

MAX_LIMIT = 10**12


class VentureTokens(BaseModel):
    # None: ventures that were permanently deleted (their usage still counts).
    venture_id: uuid.UUID | None
    title: str | None
    archived: bool
    tokens: int


class TokenLimits(BaseModel):
    # None means no limit.
    per_venture_limit: int | None = Field(default=None, gt=0, le=MAX_LIMIT)
    organization_limit: int | None = Field(default=None, gt=0, le=MAX_LIMIT)


class TokenUsageRead(BaseModel):
    ventures: list[VentureTokens]
    organization_total: int
    limits: TokenLimits
    updated_at: datetime | None
    can_edit: bool


async def _can_edit(session: AsyncSession, auth: AuthContext) -> bool:
    membership = await find_membership(session, auth.user_id, auth.organization_id)
    return membership is not None and membership.role in DELETER_ROLES


async def _read(session: AsyncSession, auth: AuthContext) -> TokenUsageRead:
    rows = (
        await session.execute(
            select(TokenUsage.venture_id, Venture.title, Venture.archived_at, func.sum(TokenUsage.tokens))
            .outerjoin(Venture, Venture.id == TokenUsage.venture_id)
            .group_by(TokenUsage.venture_id, Venture.title, Venture.archived_at)
        )
    ).all()
    used = {venture_id: (title, archived_at, int(total)) for venture_id, title, archived_at, total in rows}
    # Every live venture appears, even before it has used any tokens.
    for venture in (await session.execute(select(Venture))).scalars():
        used.setdefault(venture.id, (venture.title, venture.archived_at, 0))
    ventures = sorted(
        (
            VentureTokens(venture_id=vid, title=title, archived=archived_at is not None, tokens=total)
            for vid, (title, archived_at, total) in used.items()
        ),
        key=lambda v: (-v.tokens, v.title or ""),
    )
    limits = await session.get(OrganizationTokenLimits, auth.organization_id)
    return TokenUsageRead(
        ventures=ventures,
        organization_total=await tokens_used(session, auth.organization_id),
        limits=TokenLimits(
            per_venture_limit=limits.per_venture_limit if limits else None,
            organization_limit=limits.organization_limit if limits else None,
        ),
        updated_at=limits.updated_at if limits else None,
        can_edit=await _can_edit(session, auth),
    )


@router.get("", response_model=TokenUsageRead)
async def get_token_usage(
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> TokenUsageRead:
    await set_current_organization(session, auth.organization_id)
    return await _read(session, auth)


@router.put("/limits", response_model=TokenUsageRead)
async def update_token_limits(
    payload: TokenLimits,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> TokenUsageRead:
    await set_current_organization(session, auth.organization_id)
    if not await _can_edit(session, auth):
        raise HTTPException(status_code=403, detail="Only an organization owner or admin can change token limits")
    limits = await session.get(OrganizationTokenLimits, auth.organization_id)
    if limits is None:
        limits = OrganizationTokenLimits(organization_id=auth.organization_id)
        session.add(limits)
    before = {"per_venture_limit": limits.per_venture_limit, "organization_limit": limits.organization_limit}
    limits.per_venture_limit = payload.per_venture_limit
    limits.organization_limit = payload.organization_limit
    limits.updated_by = auth.user_id
    session.add(
        AuditLog(
            organization_id=auth.organization_id,
            actor_user_id=auth.user_id,
            action="token_limits.update",
            resource_type="organization",
            resource_id=auth.organization_id,
            log_metadata={"before": before, "after": payload.model_dump()},
        )
    )
    await session.commit()
    await set_current_organization(session, auth.organization_id)  # new transaction
    await session.refresh(limits)
    return await _read(session, auth)
