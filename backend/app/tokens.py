"""Token accounting and limits.

Every AI call records the tokens it used in token_usage (a ledger, tenant-
isolated by RLS). An organization's owner/admin can cap tokens per venture
idea and for the whole organization; every AI action checks the caps first
(server-side) and is refused with 429 once one is reached. A call already
in flight is never cut off, so a cap can be passed by at most one call.
"""

import uuid
from contextlib import asynccontextmanager

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.usage import close_meter, open_meter
from app.db import async_session
from app.models import OrganizationTokenLimits, TokenUsage
from app.tenancy import set_current_organization

VENTURE_LIMIT = "venture_token_limit"
ORGANIZATION_LIMIT = "organization_token_limit"


async def tokens_used(
    session: AsyncSession, organization_id: uuid.UUID, venture_id: uuid.UUID | None = None
) -> int:
    query = select(func.coalesce(func.sum(TokenUsage.tokens), 0)).where(
        TokenUsage.organization_id == organization_id
    )
    if venture_id is not None:
        query = query.where(TokenUsage.venture_id == venture_id)
    return int((await session.execute(query)).scalar_one())


async def limits_for(session: AsyncSession, organization_id: uuid.UUID) -> OrganizationTokenLimits | None:
    return await session.get(OrganizationTokenLimits, organization_id)


async def cap_reached(
    session: AsyncSession, organization_id: uuid.UUID, venture_id: uuid.UUID | None
) -> dict | None:
    """The cap that's reached, if any: {"cap": VENTURE_LIMIT or
    ORGANIZATION_LIMIT, "used": tokens used so far, "limit": the cap}."""
    limits = await limits_for(session, organization_id)
    if limits is None:
        return None
    if limits.per_venture_limit and venture_id is not None:
        used = await tokens_used(session, organization_id, venture_id)
        if used >= limits.per_venture_limit:
            return {"cap": VENTURE_LIMIT, "used": used, "limit": limits.per_venture_limit}
    if limits.organization_limit:
        used = await tokens_used(session, organization_id)
        if used >= limits.organization_limit:
            return {"cap": ORGANIZATION_LIMIT, "used": used, "limit": limits.organization_limit}
    return None


async def limit_reached(
    session: AsyncSession, organization_id: uuid.UUID, venture_id: uuid.UUID | None
) -> str | None:
    """Which cap is reached, if any: VENTURE_LIMIT or ORGANIZATION_LIMIT."""
    reached = await cap_reached(session, organization_id, venture_id)
    return reached["cap"] if reached else None


async def ensure_within_limits(
    session: AsyncSession, organization_id: uuid.UUID, venture_id: uuid.UUID | None
) -> None:
    reached = await limit_reached(session, organization_id, venture_id)
    if reached is not None:
        raise HTTPException(status_code=429, detail=reached)


def record(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    venture_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
    operation: str,
    tokens: int,
) -> None:
    """Adds a ledger row (the caller commits). Nothing for zero tokens."""
    if tokens > 0:
        session.add(
            TokenUsage(
                organization_id=organization_id,
                venture_id=venture_id,
                user_id=user_id,
                operation=operation,
                tokens=tokens,
            )
        )


@asynccontextmanager
async def metered(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    venture_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
    operation: str,
):
    """Checks the caps, then counts the tokens the wrapped AI work uses and
    records them in the caller's session (the caller commits) -- or, when the
    work fails after using some, in a session of its own."""
    await ensure_within_limits(session, organization_id, venture_id)
    meter, token = open_meter()
    entry = dict(
        organization_id=organization_id, venture_id=venture_id, user_id=user_id, operation=operation
    )
    try:
        yield meter
    except BaseException:
        close_meter(token)
        # The caller's transaction may be rolled back: record what the failed
        # call used in a session of its own, in the same tenant scope.
        if meter[0] > 0:
            async with async_session() as own:
                await set_current_organization(own, organization_id)
                record(own, tokens=meter[0], **entry)
                await own.commit()
        raise
    close_meter(token)
    record(session, tokens=meter[0], **entry)
