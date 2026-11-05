"""Stage AI agents: start a run, follow its progress, answer its question,
cancel it. The run itself executes in the background (app/agents/jobs.py).

Every endpoint loads the venture through _load_venture, so it runs in the
caller's RLS scope; runs are looked up by id *and* venture.
"""

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.jobs import AgentLauncher, expire_stale_runs, get_agent_launcher
from app.agents.stages import AGENT_SPECS
from app.ai.base import AIProvider
from app.auth import AuthContext, get_auth_context
from app.db import get_session
from app.dependencies import get_ai_provider
from app.models import AgentRun, AgentRunStep, AuditLog, WizardStage
from app.models.agent import ACTIVE_STATUSES
from app.routers.ventures import _load_venture
from app.routers.wizard import _locked_by, _responses_by_slug
from app.tenancy import set_current_organization
from app.tokens import ensure_within_limits
from app.wizard.research_defs import ResearchPrecondition

router = APIRouter(prefix="/api/ventures", tags=["agents"])


class AgentRunRequest(BaseModel):
    language: Literal["en", "ko"] = "en"
    # Re-run: stop the stage's active run (if any) and start a new one.
    replace: bool = False


class AgentAnswerRequest(BaseModel):
    answer: str = Field(min_length=1, max_length=2000)


def _spec_or_404(stage_slug: str):
    spec = AGENT_SPECS.get(stage_slug)
    if spec is None:
        raise HTTPException(status_code=404, detail="This stage has no AI agent")
    return spec


async def _serialize(session: AsyncSession, run: AgentRun) -> dict:
    steps = (
        await session.execute(
            select(AgentRunStep).where(AgentRunStep.run_id == run.id).order_by(AgentRunStep.seq)
        )
    ).scalars().all()
    return {
        "id": str(run.id),
        "stage_slug": run.stage_slug,
        "status": run.status,
        "language": run.language,
        "model_turns": run.model_turns,
        "web_searches": run.web_searches,
        "tokens_used": run.tokens_used,
        "active_ms": run.active_ms,
        "pending_question": run.pending_question,
        "proposed_answers": run.proposed_answers,
        "error": run.error,
        "created_at": run.created_at.isoformat(),
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "steps": [
            {
                "seq": s.seq,
                "kind": s.kind,
                "tool_name": s.tool_name,
                "arguments": s.arguments,
                # What went wrong, for "Tell me why the agent stopped": only the
                # runner's own error and limit records (no model output).
                "result": s.result if s.kind in ("error", "limit") else None,
                "created_at": s.created_at.isoformat(),
            }
            for s in steps
        ],
    }


async def _run_or_404(session: AsyncSession, venture_id: uuid.UUID, run_id: uuid.UUID) -> AgentRun:
    run = (
        await session.execute(
            select(AgentRun).where(AgentRun.id == run_id, AgentRun.venture_id == venture_id)
        )
    ).scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail="Agent run not found")
    return run


def _audit(auth: AuthContext, action: str, run: AgentRun) -> AuditLog:
    return AuditLog(
        organization_id=auth.organization_id,
        actor_user_id=auth.user_id,
        action=action,
        resource_type="agent_run",
        resource_id=run.id,
    )


def _stop(run: AgentRun) -> None:
    run.status = "cancelled"
    run.finished_at = datetime.now(UTC)
    run.pending_call_id = None


@router.post("/{venture_id}/stages/{stage_slug}/agent-runs", status_code=202)
async def start_agent_run(
    venture_id: uuid.UUID,
    stage_slug: str,
    payload: AgentRunRequest,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    provider: AIProvider = Depends(get_ai_provider),
    launch: AgentLauncher = Depends(get_agent_launcher),
) -> dict:
    spec = _spec_or_404(stage_slug)
    venture = await _load_venture(session, auth, venture_id)
    responses = await _responses_by_slug(session, venture.id)
    if _locked_by(stage_slug, responses):
        raise HTTPException(status_code=409, detail="Complete the earlier stages before this one")
    try:  # e.g. Stage 6 needs a location, Stage 7 a persona conversation
        await spec.prepare(session, venture, responses)
    except ResearchPrecondition as exc:
        raise HTTPException(status_code=422, detail=exc.detail)
    await ensure_within_limits(session, auth.organization_id, venture.id)  # 429 at a token cap
    await expire_stale_runs(session, venture.id)
    active = (
        await session.execute(
            select(AgentRun).where(
                AgentRun.venture_id == venture.id,
                AgentRun.stage_slug == stage_slug,
                AgentRun.status.in_(ACTIVE_STATUSES),
            )
        )
    ).scalar_one_or_none()
    if active is not None:
        if not payload.replace:
            raise HTTPException(status_code=409, detail="agent_running")
        _stop(active)
        session.add(_audit(auth, "agent_run.cancel", active))
        await session.flush()

    now = datetime.now(UTC)
    run = AgentRun(
        organization_id=auth.organization_id,
        venture_id=venture.id,
        stage_slug=stage_slug,
        started_by=auth.user_id,
        language=payload.language,
        status="queued",
        heartbeat_at=now,
    )
    session.add(run)
    try:
        await session.flush()
    except IntegrityError:  # another run started at the same moment
        await session.rollback()
        raise HTTPException(status_code=409, detail="agent_running")
    session.add(_audit(auth, "agent_run.start", run))
    await session.commit()
    await launch(run.id, auth.organization_id, provider, None)
    await set_current_organization(session, auth.organization_id)  # new transaction
    await session.refresh(run)
    return await _serialize(session, run)


@router.get("/{venture_id}/stages/{stage_slug}/agent-runs/latest")
async def latest_agent_run(
    venture_id: uuid.UUID,
    stage_slug: str,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> dict | None:
    _spec_or_404(stage_slug)
    venture = await _load_venture(session, auth, venture_id)
    await expire_stale_runs(session, venture.id)
    await session.commit()
    await set_current_organization(session, auth.organization_id)  # new transaction
    run = (
        await session.execute(
            select(AgentRun)
            .where(AgentRun.venture_id == venture.id, AgentRun.stage_slug == stage_slug)
            .order_by(AgentRun.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return await _serialize(session, run) if run else None


@router.post("/{venture_id}/agent-runs/{run_id}/answer", status_code=202)
async def answer_agent_run(
    venture_id: uuid.UUID,
    run_id: uuid.UUID,
    payload: AgentAnswerRequest,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    provider: AIProvider = Depends(get_ai_provider),
    launch: AgentLauncher = Depends(get_agent_launcher),
) -> dict:
    venture = await _load_venture(session, auth, venture_id)
    run = await _run_or_404(session, venture.id, run_id)
    if run.status != "waiting_for_founder":
        raise HTTPException(status_code=409, detail="This agent run is not waiting for an answer")
    await ensure_within_limits(session, auth.organization_id, venture.id)
    run.status = "queued"
    run.heartbeat_at = datetime.now(UTC)
    last = (
        await session.execute(
            select(AgentRunStep.seq)
            .where(AgentRunStep.run_id == run.id)
            .order_by(AgentRunStep.seq.desc())
            .limit(1)
        )
    ).scalar_one_or_none() or 0
    session.add(
        AgentRunStep(
            organization_id=auth.organization_id,
            run_id=run.id,
            seq=last + 1,
            kind="answer",
            tool_name="ask_founder",
            arguments={"answer": payload.answer},
        )
    )
    session.add(_audit(auth, "agent_run.answer", run))
    await session.commit()
    await launch(run.id, auth.organization_id, provider, payload.answer)
    await set_current_organization(session, auth.organization_id)
    await session.refresh(run)
    return await _serialize(session, run)


@router.post("/{venture_id}/agent-runs/{run_id}/cancel")
async def cancel_agent_run(
    venture_id: uuid.UUID,
    run_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> dict:
    venture = await _load_venture(session, auth, venture_id)
    run = await _run_or_404(session, venture.id, run_id)
    if run.status in ACTIVE_STATUSES:
        _stop(run)
        session.add(_audit(auth, "agent_run.cancel", run))
        await session.commit()
        await set_current_organization(session, auth.organization_id)
        await session.refresh(run)
    return await _serialize(session, run)


@router.post("/{venture_id}/agent-runs/{run_id}/pause")
async def pause_agent_run(
    venture_id: uuid.UUID,
    run_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Pauses a run between steps; it keeps its place and can be resumed."""
    venture = await _load_venture(session, auth, venture_id)
    run = await _run_or_404(session, venture.id, run_id)
    if run.status not in ("queued", "running"):
        raise HTTPException(status_code=409, detail="Only a running agent can be paused")
    run.status = "paused"
    session.add(_audit(auth, "agent_run.pause", run))
    await session.commit()
    await set_current_organization(session, auth.organization_id)
    await session.refresh(run)
    return await _serialize(session, run)


@router.post("/{venture_id}/agent-runs/{run_id}/resume", status_code=202)
async def resume_agent_run(
    venture_id: uuid.UUID,
    run_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
    provider: AIProvider = Depends(get_ai_provider),
    launch: AgentLauncher = Depends(get_agent_launcher),
) -> dict:
    """Continues a paused run from where it stopped."""
    venture = await _load_venture(session, auth, venture_id)
    run = await _run_or_404(session, venture.id, run_id)
    if run.status != "paused":
        raise HTTPException(status_code=409, detail="This agent run is not paused")
    await ensure_within_limits(session, auth.organization_id, venture.id)
    run.status = "queued"
    run.heartbeat_at = datetime.now(UTC)
    session.add(_audit(auth, "agent_run.resume", run))
    await session.commit()
    await launch(run.id, auth.organization_id, provider, None)
    await set_current_organization(session, auth.organization_id)
    await session.refresh(run)
    return await _serialize(session, run)


@router.get("/{venture_id}/agents")
async def venture_agents(
    venture_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Every stage's agent for this venture: whether it exists, whether the
    stage is locked, its latest run, and totals over all its runs."""
    venture = await _load_venture(session, auth, venture_id)
    await expire_stale_runs(session, venture.id)
    await session.commit()
    await set_current_organization(session, auth.organization_id)  # new transaction

    responses = await _responses_by_slug(session, venture.id)
    totals = {
        slug: (count, active_ms, tokens)
        for slug, count, active_ms, tokens in (
            await session.execute(
                select(
                    AgentRun.stage_slug,
                    func.count(),
                    func.coalesce(func.sum(AgentRun.active_ms), 0),
                    func.coalesce(func.sum(AgentRun.tokens_used), 0),
                )
                .where(AgentRun.venture_id == venture.id)
                .group_by(AgentRun.stage_slug)
            )
        ).all()
    }
    latest: dict[str, AgentRun] = {}
    for run in (
        await session.execute(
            select(AgentRun).where(AgentRun.venture_id == venture.id).order_by(AgentRun.created_at.desc())
        )
    ).scalars():
        latest.setdefault(run.stage_slug, run)

    stages = (await session.execute(select(WizardStage).order_by(WizardStage.number))).scalars().all()
    rows = []
    for stage in stages:
        count, active_ms, tokens = totals.get(stage.slug, (0, 0, 0))
        run = latest.get(stage.slug)
        rows.append(
            {
                "stage_number": stage.number,
                "slug": stage.slug,
                "title_en": stage.title_en,
                "title_ko": stage.title_ko,
                "available": stage.slug in AGENT_SPECS,
                "locked_by": _locked_by(stage.slug, responses),
                "runs": count,
                "total_active_ms": int(active_ms),
                "total_tokens": int(tokens),
                "latest": None
                if run is None
                else {
                    "id": str(run.id),
                    "status": run.status,
                    "error": run.error,
                    "pending_question": run.pending_question,
                    "created_at": run.created_at.isoformat(),
                },
            }
        )
    return rows
