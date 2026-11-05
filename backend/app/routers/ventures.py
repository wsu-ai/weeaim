import json
import logging
import uuid
from typing import Literal
from urllib.parse import quote

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from starlette.concurrency import run_in_threadpool
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.base import AIProvider
from app.ai.schemas import IdeaInterpretation
from app.auth import AuthContext, find_membership, get_auth_context
from app.db import get_session
from app.deck import build_deck, deck_filename
from app import mail_templates
from app.config import settings
from app.dependencies import get_ai_provider, get_email_sender, get_storage_adapter
from app.email_codes import issue_code
from app.mailer import EmailSender
from app.models import AuditLog, IdeaVersion, User, Venture, VentureAsset, WizardResponse, WizardStage
from app.models.asset import ASSET_CONTENT_TYPES
from app.reauth import CODE_PURPOSE, ReauthRequest, verify_reauth
from app.schemas import ArchivedVentureSummary, VentureCreate, VentureRead, VentureSummary
from app.storage.base import StorageAdapter
from app.tenancy import set_current_organization
from app.tokens import metered
from app.venture_archive import cancel_active_agent_runs, export_filename, export_venture
from app.venture_deletion import DELETER_ROLES, can_delete_venture, delete_venture

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ventures", tags=["ventures"])


async def _load_venture(
    session: AsyncSession, auth: AuthContext, venture_id: uuid.UUID, allow_archived: bool = False
) -> Venture:
    await set_current_organization(session, auth.organization_id)
    venture = await session.get(Venture, venture_id)
    # RLS already hides other orgs' ventures; this also covers unknown ids.
    # An archived venture is hidden everywhere except the archive endpoints.
    if venture is None or (venture.archived_at is not None and not allow_archived):
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
    ventures = (await session.execute(select(Venture).where(Venture.archived_at.is_(None)))).scalars().all()
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


@router.get("/archived", response_model=list[ArchivedVentureSummary])
async def list_archived_ventures(
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> list[ArchivedVentureSummary]:
    """Archived ventures the user may restore or delete: their own, or all
    of the organization's for an owner/admin. Most recently archived first."""
    await set_current_organization(session, auth.organization_id)
    membership = await find_membership(session, auth.user_id, auth.organization_id)
    is_org_admin = membership is not None and membership.role in DELETER_ROLES
    query = select(Venture).where(Venture.archived_at.is_not(None))
    if not is_org_admin:
        query = query.where(Venture.owner_id == auth.user_id)
    ventures = (await session.execute(query.order_by(Venture.archived_at.desc()))).scalars().all()
    if not ventures:
        return []
    total_stages = (await session.execute(select(func.count()).select_from(WizardStage))).scalar_one()
    completed = dict(
        (
            await session.execute(
                select(WizardResponse.venture_id, func.count())
                .where(
                    WizardResponse.venture_id.in_([v.id for v in ventures]),
                    WizardResponse.status == "completed",
                )
                .group_by(WizardResponse.venture_id)
            )
        ).all()
    )
    archivers = {v.archived_by for v in ventures if v.archived_by}
    names = dict(
        (await session.execute(select(User.id, User.display_name).where(User.id.in_(archivers)))).all()
    )
    return [
        ArchivedVentureSummary(
            **VentureRead.model_validate(v).model_dump(),
            archived_at=v.archived_at,
            archived_by_name=names.get(v.archived_by),
            completed_stages=completed.get(v.id, 0),
            total_stages=total_stages,
        )
        for v in ventures
    ]


@router.get("/{venture_id}", response_model=VentureRead)
async def get_venture(
    venture_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> Venture:
    # RLS-scoped: another organization's venture is a 404, like unknown ids.
    return await _load_venture(session, auth, venture_id)


# --- Archiving (see app/venture_archive.py) ----------------------------------------


async def _manageable(session: AsyncSession, auth: AuthContext, venture: Venture) -> None:
    if not await can_delete_venture(session, auth, venture):
        raise HTTPException(
            status_code=403,
            detail="Only the venture's creator or an organization admin can do this",
        )


async def _current_user(session: AsyncSession, auth: AuthContext) -> User:
    user = await session.get(User, auth.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return user


def _audit(auth: AuthContext, action: str, venture: Venture) -> AuditLog:
    return AuditLog(
        organization_id=auth.organization_id,
        actor_user_id=auth.user_id,
        action=action,
        resource_type="venture",
        resource_id=venture.id,
        log_metadata={"title": venture.title},
    )


@router.post("/{venture_id}/reauth-code", status_code=202)
async def send_reauth_code(
    venture_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    sender: EmailSender = Depends(get_email_sender),
) -> dict:
    """Emails the signed-in user a code to confirm archiving or deleting
    this venture -- for accounts without a password."""
    venture = await _load_venture(session, auth, venture_id, allow_archived=True)
    await _manageable(session, auth, venture)
    user = await _current_user(session, auth)
    title = venture.title
    code = await issue_code(session, user.id, CODE_PURPOSE)
    await session.commit()
    if code is not None:
        message = mail_templates.venture_action_code(
            user.email, user.preferred_language, code, settings.email_code_ttl_minutes, title
        )
        try:
            await run_in_threadpool(sender.send, message)
        except Exception:
            logger.exception("Failed to send a confirmation code to %s", user.email)
            raise HTTPException(status_code=503, detail="Email could not be sent. Please try again later.")
    return {"status": "sent"}


@router.post("/{venture_id}/archive", status_code=204)
async def archive_venture(
    venture_id: uuid.UUID,
    payload: ReauthRequest,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Archives the venture after the user re-confirms with their password
    or an emailed code. Everything is kept and can be restored."""
    venture = await _load_venture(session, auth, venture_id)
    await _manageable(session, auth, venture)
    await verify_reauth(session, await _current_user(session, auth), payload)
    venture.archived_at = datetime.now(UTC)
    venture.archived_by = auth.user_id
    await cancel_active_agent_runs(session, venture)
    session.add(_audit(auth, "venture.archive", venture))
    await session.commit()


@router.post("/{venture_id}/restore", response_model=VentureRead)
async def restore_venture(
    venture_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> Venture:
    venture = await _load_venture(session, auth, venture_id, allow_archived=True)
    await _manageable(session, auth, venture)
    if venture.archived_at is None:
        raise HTTPException(status_code=409, detail="This venture is not archived")
    venture.archived_at = None
    venture.archived_by = None
    session.add(_audit(auth, "venture.restore", venture))
    await session.commit()
    await set_current_organization(session, auth.organization_id)  # new transaction
    await session.refresh(venture)
    return venture


@router.get("/{venture_id}/archive/export")
async def export_venture_archive(
    venture_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """The whole archived venture -- every stage, its research, revisions and
    chats -- as one JSON file."""
    venture = await _load_venture(session, auth, venture_id, allow_archived=True)
    await _manageable(session, auth, venture)
    if venture.archived_at is None:
        raise HTTPException(status_code=409, detail="This venture is not archived")
    body = await export_venture(session, venture)
    filename = export_filename(venture)
    session.add(_audit(auth, "venture.archive_export", venture))
    await session.commit()
    return Response(
        content=json.dumps(body, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "private, no-store",
        },
    )


@router.post("/{venture_id}/delete-permanently", status_code=204)
async def delete_venture_permanently(
    venture_id: uuid.UUID,
    payload: ReauthRequest,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    storage: StorageAdapter = Depends(get_storage_adapter),
) -> None:
    """Permanently deletes an archived venture and everything it owns:
    answers and their history, research runs, idea versions, documents,
    their search vectors and stored files. Only the audit log keeps a
    record. Needs the user's password or an emailed code."""
    venture = await _load_venture(session, auth, venture_id, allow_archived=True)
    await _manageable(session, auth, venture)
    if venture.archived_at is None:
        raise HTTPException(status_code=409, detail="Archive the venture before deleting it permanently")
    await verify_reauth(session, await _current_user(session, auth), payload)

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
    async with metered(
        session,
        organization_id=auth.organization_id,
        venture_id=venture.id,
        user_id=auth.user_id,
        operation="idea_interpretation",
    ):
        interpretation = await provider.structure_idea(venture.original_idea)
    await session.commit()  # the token usage
    return interpretation


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


@router.get("/{venture_id}/assets/{asset_id}")
async def get_venture_asset(
    venture_id: uuid.UUID,
    asset_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """A generated file of this venture (e.g. the Stage 9 product image).

    Authorized server-side: the venture must be visible to the caller's
    organization (RLS scope), and the asset must belong to that venture.
    """
    venture = await _load_venture(session, auth, venture_id)
    asset = (
        await session.execute(
            select(VentureAsset).where(VentureAsset.id == asset_id, VentureAsset.venture_id == venture.id)
        )
    ).scalar_one_or_none()
    if asset is None or asset.content_type not in ASSET_CONTENT_TYPES:
        raise HTTPException(status_code=404, detail="Asset not found")
    return Response(
        content=asset.data,
        media_type=asset.content_type,
        headers={
            "Cache-Control": "private, max-age=86400",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
        },
    )


PPTX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


@router.get("/{venture_id}/deck.pptx")
async def download_deck(
    venture_id: uuid.UUID,
    language: Literal["en", "ko"] = Query("en"),
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """The venture's presentation deck, built from every stage's saved work.

    No AI call: the deck is assembled deterministically from what the wizard
    has saved (and the Stage 9 product image), in the caller's RLS scope.
    """
    venture = await _load_venture(session, auth, venture_id)
    stage_rows = (await session.execute(select(WizardStage))).scalars().all()
    responses = (
        await session.execute(select(WizardResponse).where(WizardResponse.venture_id == venture.id))
    ).scalars().all()
    slug_by_id = {stage.id: stage.slug for stage in stage_rows}
    stages = {
        slug_by_id[r.wizard_stage_id]: {"answers": r.answers, "ai_analysis": r.ai_analysis}
        for r in responses
        if r.wizard_stage_id in slug_by_id
    }

    image = None
    mvp_analysis = (stages.get("mvp") or {}).get("ai_analysis") or {}
    asset_ref = mvp_analysis.get("image") if isinstance(mvp_analysis, dict) else None
    if isinstance(asset_ref, dict) and asset_ref.get("asset_id"):
        try:
            asset_id = uuid.UUID(str(asset_ref["asset_id"]))
        except ValueError:
            asset_id = None
        if asset_id is not None:
            asset = (
                await session.execute(
                    select(VentureAsset).where(VentureAsset.id == asset_id, VentureAsset.venture_id == venture.id)
                )
            ).scalar_one_or_none()
            image = asset.data if asset is not None else None

    content = build_deck(
        venture.title,
        stages,
        {stage.slug: stage.number for stage in stage_rows},
        language=language,
        product_image=image,
        stage_titles={stage.slug: stage.title_ko if language == "ko" else stage.title_en for stage in stage_rows},
    )
    session.add(
        AuditLog(
            organization_id=auth.organization_id,
            actor_user_id=auth.user_id,
            action="venture.deck_export",
            resource_type="venture",
            resource_id=venture.id,
        )
    )
    await session.commit()

    filename = deck_filename(venture.title)
    return Response(
        content=content,
        media_type=PPTX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
