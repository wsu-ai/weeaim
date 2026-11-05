"""Professor Notes and Study Guide for a wizard stage.

AI-written teaching material about the stage's concepts, with the venture as
the worked example. Each kind is saved per stage and language in ai_runs, so
reopening it costs nothing; "generate" makes a fresh one. Runs in the
caller's RLS scope; token caps apply.
"""

import json
import time
import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from openai import OpenAIError
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.base import AIProvider
from app.auth import AuthContext, get_auth_context
from app.db import get_session
from app.dependencies import get_ai_provider
from app.models import AIRun, Venture, WizardStage
from app.routers.ventures import _load_venture
from app.routers.wizard import _get_stage_or_404, _responses_by_slug
from app.tokens import metered
from app.wizard.competitive_position import DATA_END, DATA_START
from app.wizard.personas import venture_brief

router = APIRouter(prefix="/api/ventures", tags=["learning"])

Kind = Literal["professor_notes", "study_guide"]


class LearningRequest(BaseModel):
    language: Literal["en", "ko"] = "en"


def stage_context(stage: WizardStage, venture: Venture, responses: dict) -> str:
    """The stage (title, objective, its questions) and a brief of the venture,
    as untrusted data."""
    questions = [
        field.get("label_en") or field.get("name")
        for field in (stage.question_schema or {}).get("fields", [])
    ]
    data = {
        "stage_number": stage.number,
        "stage": stage.title_en,
        "objective": stage.objective,
        "questions_the_founder_answers": questions,
        "venture": venture_brief(venture, responses),
    }
    body = json.dumps(data, ensure_ascii=False, indent=1).replace(DATA_END, "</ research_data>")
    return "\n".join([DATA_START, body, DATA_END])


def learning_payload(kind: str, result, stage: WizardStage, language: str, now: datetime) -> dict:
    content = result.model_dump()
    if kind == "study_guide":
        # A quiz question whose answer isn't one of its options is dropped.
        content["self_check"] = [
            q for q in content["self_check"] if 0 <= q["answer_index"] < len(q["options"])
        ]
    return {
        "kind": kind,
        "stage_slug": stage.slug,
        "language": language,
        "generated_at": now.isoformat(),
        **content,
    }


async def _latest(session: AsyncSession, venture_id: uuid.UUID, kind: str, stage_slug: str, language: str) -> dict | None:
    run = (
        await session.execute(
            select(AIRun)
            .where(
                AIRun.venture_id == venture_id,
                AIRun.operation == kind,
                AIRun.status == "succeeded",
                AIRun.input_payload["stage"].astext == stage_slug,
                AIRun.input_payload["language"].astext == language,
            )
            .order_by(AIRun.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return run.output_payload if run else None


@router.get("/{venture_id}/stages/{stage_slug}/learning/{kind}")
async def get_learning(
    venture_id: uuid.UUID,
    stage_slug: str,
    kind: Kind,
    language: Literal["en", "ko"] = "en",
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """The saved Professor Notes / Study Guide for this stage (404 if none yet)."""
    venture = await _load_venture(session, auth, venture_id)
    await _get_stage_or_404(session, stage_slug)
    saved = await _latest(session, venture.id, kind, stage_slug, language)
    if saved is None:
        raise HTTPException(status_code=404, detail="not_generated")
    return saved


@router.post("/{venture_id}/stages/{stage_slug}/learning/{kind}")
async def generate_learning(
    venture_id: uuid.UUID,
    stage_slug: str,
    kind: Kind,
    payload: LearningRequest,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    provider: AIProvider = Depends(get_ai_provider),
) -> dict:
    """Writes fresh Professor Notes / a fresh Study Guide for this stage."""
    venture = await _load_venture(session, auth, venture_id)
    stage = await _get_stage_or_404(session, stage_slug)
    context = stage_context(stage, venture, await _responses_by_slug(session, venture.id))
    run = AIRun(
        organization_id=auth.organization_id,
        venture_id=venture.id,
        operation=kind,
        provider=type(provider).__name__,
        model=getattr(provider, "model", "unknown"),
        input_payload={"stage": stage_slug, "language": payload.language, "context": context},
        status="pending",
    )
    call = provider.professor_notes if kind == "professor_notes" else provider.study_guide
    async with metered(
        session,
        organization_id=auth.organization_id,
        venture_id=venture.id,
        user_id=auth.user_id,
        operation=kind,
    ):
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
                raise
            raise HTTPException(status_code=503, detail="The material couldn't be written. Please try again.") from exc
    content = learning_payload(kind, result, stage, payload.language, datetime.now(UTC))
    run.status = "succeeded"
    run.output_payload = content
    run.latency_ms = int((time.monotonic() - started) * 1000)
    session.add(run)
    await session.commit()
    return content
