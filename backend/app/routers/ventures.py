import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.base import AIProvider
from app.ai.schemas import IdeaInterpretation
from app.auth import AuthContext, get_auth_context
from app.db import get_session
from app.dependencies import get_ai_provider
from app.models import AuditLog, IdeaVersion, Venture
from app.schemas import VentureCreate, VentureRead
from app.tenancy import set_current_organization

router = APIRouter(prefix="/api/ventures", tags=["ventures"])


async def _load_venture(session: AsyncSession, auth: AuthContext, venture_id: uuid.UUID) -> Venture:
    await set_current_organization(session, auth.organization_id)
    venture = await session.get(Venture, venture_id)
    if venture is None:
        # RLS already hides other orgs' ventures; this also covers unknown ids.
        raise HTTPException(status_code=404, detail="Venture not found")
    return venture


def derive_title(idea: str, max_length: int = 80) -> str:
    """Deterministic placeholder title until Phase 7's AI structuring exists."""
    normalized = " ".join(idea.split())
    if len(normalized) <= max_length:
        return normalized
    truncated = normalized[:max_length]
    last_space = truncated.rfind(" ")
    if last_space > 0:
        truncated = truncated[:last_space]
    return truncated + "..."


@router.post("", response_model=VentureRead, status_code=201)
async def create_venture(
    payload: VentureCreate,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> Venture:
    await set_current_organization(session, auth.organization_id)

    venture = Venture(
        organization_id=auth.organization_id,
        owner_id=auth.user_id,
        title=derive_title(payload.idea),
        original_idea=payload.idea,
        current_idea_statement=payload.idea,
    )
    session.add(venture)
    await session.flush()

    session.add(
        AuditLog(
            organization_id=auth.organization_id,
            actor_user_id=auth.user_id,
            action="venture.create",
            resource_type="venture",
            resource_id=venture.id,
        )
    )
    await session.commit()
    return venture


@router.post("/{venture_id}/interpret", response_model=IdeaInterpretation)
async def interpret_venture_idea(
    venture_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    provider: AIProvider = Depends(get_ai_provider),
) -> IdeaInterpretation:
    venture = await _load_venture(session, auth, venture_id)
    return await provider.structure_idea(venture.original_idea)


@router.post("/{venture_id}/confirm-idea", response_model=VentureRead)
async def confirm_venture_idea(
    venture_id: uuid.UUID,
    payload: IdeaInterpretation,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> Venture:
    venture = await _load_venture(session, auth, venture_id)

    next_version = (
        await session.execute(
            select(func.coalesce(func.max(IdeaVersion.version_number), 0) + 1).where(
                IdeaVersion.venture_id == venture.id
            )
        )
    ).scalar_one()

    session.add(
        IdeaVersion(
            venture_id=venture.id,
            version_number=next_version,
            idea_text=venture.original_idea,
            structured_interpretation=payload.model_dump(),
            created_by=auth.user_id,
        )
    )
    venture.title = payload.title
    venture.industry = payload.industry
    venture.geography = payload.geography

    session.add(
        AuditLog(
            organization_id=auth.organization_id,
            actor_user_id=auth.user_id,
            action="venture.idea_confirmed",
            resource_type="venture",
            resource_id=venture.id,
        )
    )
    await session.commit()
    return venture
