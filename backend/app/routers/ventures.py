import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.base import AIProvider
from app.ai.schemas import IdeaInterpretation
from app.auth import AuthContext, find_membership, get_auth_context
from app.db import get_session
from app.dependencies import get_ai_provider, get_storage_adapter
from app.models import AuditLog, IdeaVersion, Venture, WizardResponse, WizardStage
from app.schemas import VentureCreate, VentureRead, VentureSummary
from app.storage.base import StorageAdapter
from app.tenancy import set_current_organization
from app.venture_deletion import DELETER_ROLES, can_delete_venture, delete_venture

logger = logging.getLogger(__name__)

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


@router.get("", response_model=list[VentureSummary])
async def list_ventures(
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> list[VentureSummary]:
    """The organization's ventures with their saved progress, most recently
    worked on first -- how a returning user finds their earlier work."""
    await set_current_organization(session, auth.organization_id)
    ventures = (await session.execute(select(Venture))).scalars().all()
    total_stages = (await session.execute(select(func.count()).select_from(WizardStage))).scalar_one()
    responses = (
        await session.execute(
            select(WizardResponse, WizardStage.slug).join(
                WizardStage, WizardStage.id == WizardResponse.wizard_stage_id
            )
        )
    ).all()

    membership = await find_membership(session, auth.user_id, auth.organization_id)
    is_org_admin = membership is not None and membership.role in DELETER_ROLES

    by_venture: dict[uuid.UUID, list[tuple[WizardResponse, str]]] = {}
    for response, slug in responses:
        by_venture.setdefault(response.venture_id, []).append((response, slug))

    summaries = []
    for venture in ventures:
        rows = by_venture.get(venture.id, [])
        research = next(
            (
                r.ai_analysis
                for r, slug in rows
                if slug == "idea_discovery"
                and isinstance(r.ai_analysis, dict)
                and r.ai_analysis.get("kind") == "idea_research"
            ),
            None,
        )
        updated_at = max([venture.updated_at, *(r.updated_at for r, _ in rows)])
        summaries.append(
            VentureSummary(
                **VentureRead.model_validate(venture).model_dump(),
                completed_stages=sum(1 for r, _ in rows if r.status == "completed"),
                total_stages=total_stages,
                feasibility_score=(research or {}).get("feasibility_score"),
                researched_at=(research or {}).get("researched_at"),
                updated_at=updated_at,
                can_delete=is_org_admin or venture.owner_id == auth.user_id,
            )
        )
    return sorted(summaries, key=lambda s: s.updated_at, reverse=True)


@router.get("/{venture_id}", response_model=VentureRead)
async def get_venture(
    venture_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> Venture:
    # RLS-scoped: another organization's venture is a 404, like unknown ids.
    return await _load_venture(session, auth, venture_id)


@router.delete("/{venture_id}", status_code=204)
async def delete_venture_endpoint(
    venture_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    storage: StorageAdapter = Depends(get_storage_adapter),
) -> None:
    """Permanently deletes a venture and everything it owns: answers and
    their history, research runs, idea versions, documents, their search
    vectors and stored files. Only the audit log keeps a record."""
    venture = await _load_venture(session, auth, venture_id)  # 404 across tenants
    if not await can_delete_venture(session, auth, venture):
        raise HTTPException(
            status_code=403,
            detail="Only the venture's creator or an organization admin can delete it",
        )

    title = venture.title
    storage_keys = await delete_venture(session, venture)
    session.add(
        AuditLog(
            organization_id=auth.organization_id,
            actor_user_id=auth.user_id,
            action="venture.delete",
            resource_type="venture",
            resource_id=venture_id,
            log_metadata={"title": title, "deleted_by": str(auth.user_id)},
        )
    )
    await session.commit()

    # Files go only after the rows are gone, so a failure here can leave an
    # orphaned file but never data pointing at a missing file.
    for key in storage_keys:
        try:
            await storage.delete(key)
        except Exception:
            logger.exception("Failed to delete stored file %s of venture %s", key, venture_id)


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
