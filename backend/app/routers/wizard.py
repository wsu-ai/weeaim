import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.base import AIProvider
from app.ai.schemas import StageAnalysis
from app.auth import AuthContext, get_auth_context
from app.db import get_session
from app.dependencies import get_ai_provider
from app.models import AuditLog, WizardResponse, WizardResponseRevision, WizardStage
from app.routers.ventures import _load_venture
from app.tenancy import set_current_organization
from app.wizard.schemas import (
    StageResponseRead,
    StageRevisionRead,
    StageStatus,
    StageUpdateRequest,
)
from app.wizard.stages import STAGE_ANSWER_SCHEMAS

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
