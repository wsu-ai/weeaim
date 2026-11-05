import logging
import time
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from openai import OpenAIError
from pydantic import BaseModel, ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.base import AIProvider
from app.ai.schemas import StageAnalysis
from app.auth import AuthContext, get_auth_context
from app.db import get_session
from app.dependencies import get_ai_provider
from app.models import (
    AgentRun,
    AIRun,
    AuditLog,
    PersonaMessage,
    WizardResponse,
    WizardResponseRevision,
    WizardStage,
)
from app.routers.ventures import _load_venture
from app.schemas import ResearchRunRead
from app.tenancy import set_current_organization
from app.tokens import metered
from app.wizard.schemas import (
    IdeaResearchRequest,
    StageResponseRead,
    StageRevisionRead,
    StageStatus,
    StageUpdateRequest,
)
from app.wizard.research_defs import RESEARCH_DEFS, FinalizeArgs, ResearchPrecondition
from app.wizard.research_store import save_stage_research
from app.wizard import (
    financial_analysis,
    personas,
    translation,
    validation_plan,
)
from app.wizard.stages import (
    PROGRESS_FIELDS,
    RESEARCH_STAGES,
    STAGE_ANSWER_SCHEMAS,
    STAGE_PREREQUISITES,
)

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
        raise HTTPException(status_code=422, detail=exc.errors(include_url=False, include_context=False)) from exc

    venture = await _load_venture(session, auth, venture_id)
    stage = await _get_stage_or_404(session, stage_slug)
    await _ensure_unlocked(session, venture.id, stage_slug)
    response = await _get_response(session, venture.id, stage.id)

    was_completed = response is not None and response.status == "completed"
    new_answers = validated_answers.model_dump()
    if stage_slug == "validation_plan":
        # Outcomes are computed here from the saved plan, never taken from the client.
        new_answers = validation_plan.finalize_answers(new_answers, response.ai_analysis if response else None)
    elif stage_slug == "persona_validation":
        new_answers = personas.with_persona_ids(new_answers)
        kept = {p["id"] for p in new_answers["personas"]}
        removed = {
            p.get("id") for p in ((response.answers or {}) if response else {}).get("personas") or []
        } - kept - {None, ""}
        if removed:
            await session.execute(
                delete(PersonaMessage).where(
                    PersonaMessage.venture_id == venture.id, PersonaMessage.persona_id.in_(removed)
                )
            )
    elif stage_slug == "financial_analysis":
        # The projection is computed here from the inputs, never taken from the client.
        new_answers = financial_analysis.finalize_answers(new_answers, response.ai_analysis if response else None)
    progress = PROGRESS_FIELDS.get(stage_slug, set())
    # Only progress fields changed (e.g. a ticked action item): keep the status.
    progress_only = (
        response is not None
        and bool(progress)
        and not payload.complete
        and {k: v for k, v in new_answers.items() if k not in progress}
        == {k: v for k, v in (response.answers or {}).items() if k not in progress}
    )

    if response is None:
        response = WizardResponse(
            venture_id=venture.id,
            wizard_stage_id=stage.id,
            answers=new_answers,
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
        response.answers = new_answers
        if not progress_only:
            response.status = "in_progress"

    if payload.complete:
        response.status = "completed"
        response.completed_at = datetime.now(UTC)

    await session.flush()

    if was_completed and not progress_only:
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


class FeedbackRequest(BaseModel):
    # The answers on the page, which may not be saved yet; the saved answers
    # when omitted.
    answers: dict[str, str | list[str]] | None = None


def _feedback_answers(stage_slug: str, answers: dict) -> dict:
    """Only the stage's own questions, trimmed to a sane size."""
    fields = STAGE_ANSWER_SCHEMAS[stage_slug].model_fields
    cleaned: dict = {}
    for name, value in answers.items():
        if name not in fields:
            continue
        if isinstance(value, list):
            cleaned[name] = [str(item)[:2000] for item in value[:20]]
        elif isinstance(value, str):
            cleaned[name] = value[:5000]
    return cleaned


def _has_answer(answers: dict) -> bool:
    return any(
        (isinstance(v, str) and v.strip()) or (isinstance(v, list) and any(str(i).strip() for i in v))
        for v in answers.values()
    )


@router.post("/{venture_id}/stages/{stage_slug}/analyze", response_model=StageAnalysis)
async def analyze_stage(
    venture_id: uuid.UUID,
    stage_slug: str,
    payload: FeedbackRequest | None = None,
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

    # Feedback weighs the AI Mentor Agent's drafts against the founder's own
    # answers, so it needs both: a finished agent run for this stage, and at
    # least one answered question.
    agent_run = (
        await session.execute(
            select(AgentRun)
            .where(
                AgentRun.venture_id == venture.id,
                AgentRun.stage_slug == stage_slug,
                AgentRun.status == "succeeded",
            )
            .order_by(AgentRun.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if agent_run is None:
        raise HTTPException(status_code=422, detail="agent_not_run")
    given = payload.answers if payload and payload.answers is not None else (response.answers if response else {})
    answers = _feedback_answers(stage_slug, given or {})
    if not _has_answer(answers):
        raise HTTPException(status_code=422, detail="no_answers")
    drafts = agent_run.proposed_answers or {}

    async with metered(
        session,
        organization_id=auth.organization_id,
        venture_id=venture.id,
        user_id=auth.user_id,
        operation="stage_feedback",
    ):
        analysis = await provider.analyze_stage(
            stage_slug,
            venture.current_idea_statement or venture.original_idea,
            answers,
            agent_drafts=drafts,
        )
    if response is None:  # feedback on answers not saved yet
        response = WizardResponse(venture_id=venture.id, wizard_stage_id=stage.id, answers={}, status="in_progress")
        session.add(response)
        await session.flush()
    # When the mentor feedback was received (shown next to the feedback
    # button), and the agent run whose drafts it weighed.
    response.ai_analysis = {
        **analysis.model_dump(),
        "analyzed_at": datetime.now(UTC).isoformat(),
        "agent_run_id": str(agent_run.id),
    }
    # Feedback never un-completes a stage: later stages unlock only while it
    # stays completed (the research stages work the same way).
    if response.status != "completed":
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


def _research_slug_or_404(stage_slug: str) -> str:
    if stage_slug not in RESEARCH_DEFS:
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
    Stage 6 (market_evidence): TAM/SAM/SOM inputs for three geographies.
    Stage 7 (persona_validation): insights from the founder's conversations
    with AI personas (simulated). Needs at least one conversation.
    Stage 7 (competitive_position): a position and action items synthesized
    from stages 1-6 and their research. Locked until stages 1-6 are done.
    Stage 8 (dfv_assessment): desirability, feasibility and viability rated
    from stages 1-7 (no web search); scores are computed by app code.
    Stage 9 (mvp): the minimum viable product -- a concept image, a sample
    web page or a service description, by offering type. Never locked.
    Stage 10 (business_model): the recommended business model from stages
    1-9; unit economics are computed by app code. Never locked.
    Stage 11 (validation_plan): experiments with pass/fail bars set in
    advance; results are evaluated by app code. Never locked.
    Stage 12 (financial_analysis): drafted inputs (expenses, revenue drivers,
    funding); the 36-month projection is computed by app code. Never locked.
    Stage 13 (marketing_plan): a differentiated marketing plan; budget totals
    and funnel rates are computed by app code. Never locked.
    """
    _research_slug_or_404(stage_slug)
    venture = await _load_venture(session, auth, venture_id)
    stage = await _get_stage_or_404(session, stage_slug)
    responses = await _responses_by_slug(session, venture.id)
    if _locked_by(stage_slug, responses):
        raise HTTPException(status_code=409, detail="Complete the earlier stages before this one")
    definition = RESEARCH_DEFS[stage_slug]
    if definition.before is not None:
        await definition.before(session, provider, auth, venture, responses, payload.language)
    try:
        prepared = await definition.prepare(session, venture, responses)
    except ResearchPrecondition as exc:
        raise HTTPException(status_code=422, detail=exc.detail)

    # Every run is kept in ai_runs, so earlier research survives a re-run.
    run = AIRun(
        organization_id=auth.organization_id,
        venture_id=venture.id,
        operation=definition.operation,
        provider=type(provider).__name__,
        model=getattr(provider, "model", "unknown"),
        input_payload={"context": prepared.context, "language": payload.language},
        status="pending",
    )
    async with metered(
        session,
        organization_id=auth.organization_id,
        venture_id=venture.id,
        user_id=auth.user_id,
        operation=definition.operation,
    ):
        started = time.monotonic()
        try:
            result = await getattr(provider, definition.call)(prepared.context, payload.language)
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

        analysis = await definition.payload(
            FinalizeArgs(
                session=session,
                provider=provider,
                auth=auth,
                venture=venture,
                responses=responses,
                prepared=prepared,
                result=result,
                language=payload.language,
                now=datetime.now(UTC),
            )
        )
    run.latency_ms = int((time.monotonic() - started) * 1000)
    await save_stage_research(
        session,
        organization_id=auth.organization_id,
        actor_user_id=auth.user_id,
        venture=venture,
        stage=stage,
        response=responses.get(stage_slug),
        analysis=analysis,
        initial_answers=prepared.initial_answers,
        run=run,
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
                AIRun.operation == RESEARCH_DEFS[stage_slug].operation,
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


@router.post("/{venture_id}/stages/{stage_slug}/translate")
async def translate_stage_analysis(
    venture_id: uuid.UUID,
    stage_slug: str,
    payload: IdeaResearchRequest,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    provider: AIProvider = Depends(get_ai_provider),
) -> dict:
    """The stage's saved AI analysis in the requested language.

    Only human-readable text is translated (app/wizard/translation.py); every
    number, ID, link and computed figure is kept. The translation is cached
    with the analysis, so each language costs one AI call per analysis.
    """
    venture = await _load_venture(session, auth, venture_id)
    stage = await _get_stage_or_404(session, stage_slug)
    response = await _get_response(session, venture.id, stage.id)
    analysis = response.ai_analysis if response else None
    if not isinstance(analysis, dict) or not analysis:
        raise HTTPException(status_code=404, detail="Nothing to translate yet")

    target = payload.language
    source = translation.source_language(analysis)
    if source == target:
        return {k: v for k, v in analysis.items() if k != "translations"}
    cached = translation.cached_translation(analysis, target)
    if cached is not None:
        return cached

    texts = translation.translatable_texts(analysis)
    if len(texts) > translation.MAX_TEXTS or sum(len(t) for t in texts.values()) > translation.MAX_CHARS:
        raise HTTPException(status_code=413, detail="This analysis is too long to translate")

    run = AIRun(
        organization_id=auth.organization_id,
        venture_id=venture.id,
        operation="translation",
        provider=type(provider).__name__,
        model=getattr(provider, "model", "unknown"),
        input_payload={"stage": stage_slug, "from": source, "to": target, "texts": len(texts)},
        status="pending",
    )
    started = time.monotonic()
    translated: dict[str, str] = {}
    async with metered(
        session,
        organization_id=auth.organization_id,
        venture_id=venture.id,
        user_id=auth.user_id,
        operation="translation",
    ):
        try:
            for batch in translation.batches(texts):
                result = await provider.translate_texts(batch, target)
                # Only keys that were sent are accepted.
                translated.update({item.key: item.text for item in result.items if item.key in batch})
        except Exception as exc:
            run.status = "failed"
            run.error_message = f"{type(exc).__name__}: {exc}"[:2000]
            run.latency_ms = int((time.monotonic() - started) * 1000)
            session.add(run)
            await session.commit()
            if isinstance(exc, OpenAIError):
                raise
            logger.exception("Translating %s failed for venture %s", stage_slug, venture.id)
            raise HTTPException(status_code=503, detail="Translation failed. Please try again.") from exc

    view = translation.apply_translations(analysis, translated, target, source)
    run.status = "succeeded"
    run.output_payload = {"translated": len(translated), "of": len(texts)}
    run.latency_ms = int((time.monotonic() - started) * 1000)
    session.add(run)
    # A new dict, so the JSONB column is saved; the original stays as it was.
    response.ai_analysis = {**analysis, "translations": {**(analysis.get("translations") or {}), target: view}}
    await session.commit()
    return view
