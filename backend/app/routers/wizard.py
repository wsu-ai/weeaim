import logging
import time
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from openai import OpenAIError
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.base import AIProvider
from app.ai.schemas import StageAnalysis
from app.auth import AuthContext, get_auth_context
from app.db import get_session
from app.dependencies import get_ai_provider
from app.models import AIRun, AuditLog, WizardResponse, WizardResponseRevision, WizardStage
from app.routers.ventures import _load_venture
from app.schemas import ResearchRunRead
from app.tenancy import set_current_organization
from app.wizard.idea_research import research_payload
from app.wizard.schemas import (
    IdeaResearchRequest,
    StageResponseRead,
    StageRevisionRead,
    StageStatus,
    StageUpdateRequest,
)
from app.wizard.alternatives_research import alternatives_payload, based_on, venture_context
from app.wizard.stages import RESEARCH_STAGES, STAGE_ANSWER_SCHEMAS, STAGE_PREREQUISITES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ventures", tags=["wizard"])


async def _get_stage_or_404(session: AsyncSession, stage_slug: str) -> WizardStage:
    stage = (
        await session.execute(select(WizardStage).where(WizardStage.slug == stage_slug))
    ).scalar_one_or_none()
    if stage is None or stage_slug not in STAGE_ANSWER_SCHEMAS:
        raise HTTPException(status_code=404, detail="Stage not implemented")
    return stage


async def _get_response(
    session: AsyncSession, venture_id: uuid.UUID, stage_id: uuid.UUID
) -> WizardResponse | None:
    return (
        await session.execute(
            select(WizardResponse).where(
                WizardResponse.venture_id == venture_id,
                WizardResponse.wizard_stage_id == stage_id,
            )
        )
    ).scalar_one_or_none()


async def _responses_by_slug(
    session: AsyncSession, venture_id: uuid.UUID
) -> dict[str, WizardResponse]:
    rows = await session.execute(
        select(WizardResponse, WizardStage.slug)
        .join(WizardStage, WizardStage.id == WizardResponse.wizard_stage_id)
        .where(WizardResponse.venture_id == venture_id)
    )
    return {slug: response for response, slug in rows.all()}


def _locked_by(stage_slug: str, responses: dict[str, WizardResponse]) -> list[str]:
    """Prerequisite stages that aren't completed yet (empty = unlocked)."""
    return [
        slug
        for slug in STAGE_PREREQUISITES.get(stage_slug, [])
        if slug not in responses or responses[slug].status != "completed"
    ]


async def _ensure_unlocked(session: AsyncSession, venture_id: uuid.UUID, stage_slug: str) -> None:
    if _locked_by(stage_slug, await _responses_by_slug(session, venture_id)):
        raise HTTPException(
            status_code=409, detail="Complete the earlier stages before this one"
        )


@router.get("/{venture_id}/stages", response_model=list[StageStatus])
async def list_stages(
    venture_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> list[StageStatus]:
    venture = await _load_venture(session, auth, venture_id)

    stages = (
        await session.execute(select(WizardStage).order_by(WizardStage.number))
    ).scalars().all()
    responses = (
        await session.execute(select(WizardResponse).where(WizardResponse.venture_id == venture.id))
    ).scalars().all()
    responses_by_stage_id = {r.wizard_stage_id: r for r in responses}
    slug_by_stage_id = {stage.id: stage.slug for stage in stages}
    responses_by_slug = {slug_by_stage_id[r.wizard_stage_id]: r for r in responses}

    return [
        StageStatus(
            slug=stage.slug,
            number=stage.number,
            title_en=stage.title_en,
            title_ko=stage.title_ko,
            implemented=stage.slug in STAGE_ANSWER_SCHEMAS,
            status=(responses_by_stage_id[stage.id].status if stage.id in responses_by_stage_id else "not_started"),
            answers=(responses_by_stage_id[stage.id].answers if stage.id in responses_by_stage_id else None),
            ai_analysis=(
                responses_by_stage_id[stage.id].ai_analysis if stage.id in responses_by_stage_id else None
            ),
            question_schema=stage.question_schema,
            locked=bool(_locked_by(stage.slug, responses_by_slug)),
            locked_by=_locked_by(stage.slug, responses_by_slug),
        )
        for stage in stages
    ]


@router.put("/{venture_id}/stages/{stage_slug}", response_model=StageResponseRead)
async def update_stage(
    venture_id: uuid.UUID,
    stage_slug: str,
    payload: StageUpdateRequest,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> WizardResponse:
    schema_cls = STAGE_ANSWER_SCHEMAS.get(stage_slug)
    if schema_cls is None:
        raise HTTPException(status_code=404, detail="Stage not implemented")
    try:
        validated_answers = schema_cls.model_validate(payload.answers)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    venture = await _load_venture(session, auth, venture_id)
    stage = await _get_stage_or_404(session, stage_slug)
    await _ensure_unlocked(session, venture.id, stage_slug)
    response = await _get_response(session, venture.id, stage.id)

    was_completed = response is not None and response.status == "completed"

    if response is None:
        response = WizardResponse(
            venture_id=venture.id,
            wizard_stage_id=stage.id,
            answers=validated_answers.model_dump(),
            status="in_progress",
        )
        session.add(response)
    else:
        # Snapshot what's being replaced before overwriting -- CLAUDE.md:
        # "don't silently overwrite earlier answers."
        existing_revision_count = (
            await session.execute(
                select(func.count())
                .select_from(WizardResponseRevision)
                .where(WizardResponseRevision.wizard_response_id == response.id)
            )
        ).scalar_one()
        session.add(
            WizardResponseRevision(
                wizard_response_id=response.id,
                venture_id=venture.id,
                version_number=existing_revision_count + 1,
                answers=response.answers,
                status=response.status,
            )
        )
        response.answers = validated_answers.model_dump()
        response.status = "in_progress"

    if payload.complete:
        response.status = "completed"
        response.completed_at = datetime.now(UTC)

    await session.flush()

    if was_completed:
        later_responses = (
            await session.execute(
                select(WizardResponse)
                .join(WizardStage, WizardResponse.wizard_stage_id == WizardStage.id)
                .where(
                    WizardResponse.venture_id == venture.id,
                    WizardStage.number > stage.number,
                    WizardResponse.status == "completed",
                )
            )
        ).scalars().all()
        for later in later_responses:
            later.status = "needs_revision"

    session.add(
        AuditLog(
            organization_id=auth.organization_id,
            actor_user_id=auth.user_id,
            action="wizard_stage.update",
            resource_type="wizard_response",
            resource_id=response.id,
        )
    )
    await session.commit()

    return StageResponseRead(
        venture_id=venture.id,
        stage_slug=stage_slug,
        status=response.status,
        answers=response.answers,
        ai_analysis=response.ai_analysis,
        completed_at=response.completed_at,
    )


@router.post("/{venture_id}/stages/{stage_slug}/analyze", response_model=StageAnalysis)
async def analyze_stage(
    venture_id: uuid.UUID,
    stage_slug: str,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    provider: AIProvider = Depends(get_ai_provider),
) -> StageAnalysis:
    if stage_slug in RESEARCH_STAGES:
        # These stages' AI output is web research (see research_stage below);
        # generic feedback would overwrite it with a different shape.
        raise HTTPException(
            status_code=400, detail="Use research for this stage, not feedback"
        )
    venture = await _load_venture(session, auth, venture_id)
    stage = await _get_stage_or_404(session, stage_slug)
    response = await _get_response(session, venture.id, stage.id)
    if response is None or not response.answers:
        raise HTTPException(status_code=400, detail="No answers saved for this stage yet")

    analysis = await provider.analyze_stage(
        stage_slug,
        venture.current_idea_statement or venture.original_idea,
        response.answers,
    )
    response.ai_analysis = analysis.model_dump()
    response.status = "awaiting_user"

    session.add(
        AuditLog(
            organization_id=auth.organization_id,
            actor_user_id=auth.user_id,
            action="wizard_stage.analyze",
            resource_type="wizard_response",
            resource_id=response.id,
        )
    )
    await session.commit()
    return analysis


@router.get(
    "/{venture_id}/stages/{stage_slug}/revisions", response_model=list[StageRevisionRead]
)
async def list_stage_revisions(
    venture_id: uuid.UUID,
    stage_slug: str,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> list[WizardResponseRevision]:
    venture = await _load_venture(session, auth, venture_id)
    stage = await _get_stage_or_404(session, stage_slug)
    response = await _get_response(session, venture.id, stage.id)
    if response is None:
        return []

    revisions = (
        await session.execute(
            select(WizardResponseRevision)
            .where(WizardResponseRevision.wizard_response_id == response.id)
            .order_by(WizardResponseRevision.version_number)
        )
    ).scalars().all()
    return list(revisions)


RESEARCH_OPERATIONS = {
    "idea_discovery": "idea_research",
    "existing_alternatives": "alternatives_research",
}


def _research_slug_or_404(stage_slug: str) -> str:
    if stage_slug not in RESEARCH_OPERATIONS:
        raise HTTPException(status_code=404, detail="This stage has no research")
    return stage_slug


@router.post("/{venture_id}/stages/{stage_slug}/research")
async def research_stage(
    venture_id: uuid.UUID,
    stage_slug: str,
    payload: IdeaResearchRequest,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    provider: AIProvider = Depends(get_ai_provider),
) -> dict:
    """AI web research for a stage.

    Stage 1 (idea_discovery): expert view of the idea -- existing businesses,
    feasibility, viability, where to differentiate.
    Stage 4 (existing_alternatives): the alternatives customers use today,
    based on the founder's answers in stages 1-3. Locked until those are done.
    """
    _research_slug_or_404(stage_slug)
    venture = await _load_venture(session, auth, venture_id)
    stage = await _get_stage_or_404(session, stage_slug)
    responses = await _responses_by_slug(session, venture.id)
    if _locked_by(stage_slug, responses):
        raise HTTPException(status_code=409, detail="Complete the earlier stages before this one")
    response = responses.get(stage_slug)

    if stage_slug == "idea_discovery":
        saved_idea = ((response.answers or {}).get("idea_statement") or "").strip() if response else ""
        idea = saved_idea or venture.current_idea_statement or venture.original_idea
        context_lines = [f"Idea: {idea}"]
        for label, value in (
            ("Title", venture.title),
            ("Industry", venture.industry),
            ("Geography", venture.geography),
        ):
            if value:
                context_lines.append(f"{label}: {value}")
        context = "\n".join(context_lines)
        initial_answers = {"idea_statement": idea, "differentiation_plan": ""}
        call = provider.research_idea
    else:
        context = venture_context(venture, responses)
        initial_answers = {"current_solutions": "", "why_switch": "", "biggest_threat": ""}
        call = provider.research_alternatives

    # Every run is kept in ai_runs, so earlier research survives a re-run.
    run = AIRun(
        organization_id=auth.organization_id,
        venture_id=venture.id,
        operation=RESEARCH_OPERATIONS[stage_slug],
        provider=type(provider).__name__,
        model=getattr(provider, "model", "unknown"),
        input_payload={"context": context, "language": payload.language},
        status="pending",
    )
    started = time.monotonic()
    try:
        result = await call(context, payload.language)
    except Exception as exc:
        run.status = "failed"
        run.error_message = f"{type(exc).__name__}: {exc}"[:2000]
        run.latency_ms = int((time.monotonic() - started) * 1000)
        session.add(run)
        await session.commit()
        if isinstance(exc, OpenAIError):
            raise  # the app-wide handler turns this into a clean 503
        logger.exception("%s research failed for venture %s", stage_slug, venture.id)
        raise HTTPException(
            status_code=503, detail="AI research failed. Please try again."
        ) from exc

    now = datetime.now(UTC)
    if stage_slug == "idea_discovery":
        analysis = research_payload(result, payload.language, now)
    else:
        analysis = alternatives_payload(result, payload.language, now, based_on(responses))
    run.status = "succeeded"
    run.output_payload = analysis
    run.latency_ms = int((time.monotonic() - started) * 1000)
    session.add(run)

    if response is None:
        response = WizardResponse(
            venture_id=venture.id,
            wizard_stage_id=stage.id,
            answers=initial_answers,
            status="in_progress",
        )
        session.add(response)
    response.ai_analysis = analysis
    if response.status != "completed":
        response.status = "awaiting_user"
    await session.flush()

    session.add(
        AuditLog(
            organization_id=auth.organization_id,
            actor_user_id=auth.user_id,
            action="wizard_stage.research",
            resource_type="wizard_response",
            resource_id=response.id,
        )
    )
    await session.commit()
    return analysis


@router.get(
    "/{venture_id}/stages/{stage_slug}/research/history",
    response_model=list[ResearchRunRead],
)
async def research_history(
    venture_id: uuid.UUID,
    stage_slug: str,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> list[ResearchRunRead]:
    """Every successful research run for this stage, newest first.

    Re-running replaces what the stage shows, but each run stays in ai_runs,
    so earlier research is never lost and can be reopened in later sessions.
    """
    _research_slug_or_404(stage_slug)
    venture = await _load_venture(session, auth, venture_id)
    runs = (
        await session.execute(
            select(AIRun)
            .where(
                AIRun.venture_id == venture.id,
                AIRun.operation == RESEARCH_OPERATIONS[stage_slug],
                AIRun.status == "succeeded",
            )
            .order_by(AIRun.created_at.desc())
        )
    ).scalars().all()
    return [
        ResearchRunRead(id=run.id, created_at=run.created_at, research=run.output_payload)
        for run in runs
        if run.output_payload
    ]
