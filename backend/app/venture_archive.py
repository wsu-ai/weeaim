"""Archiving a venture, and its single-file export.

Archiving is in place: the venture gets archived_at and every row it owns --
all stages' answers and revisions, AI content and research runs, persona
chats, agent runs, documents and stored files -- stays where it is, under the
same row-level security. _load_venture hides archived ventures everywhere;
restoring clears archived_at and everything is back.

The export gathers the whole venture, all stages in order, into one JSON
document. Runs in the caller's RLS scope (set by _load_venture).
"""

import re
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AgentRun,
    AgentRunStep,
    AIRun,
    Document,
    IdeaVersion,
    PersonaMessage,
    Venture,
    WizardResponse,
    WizardResponseRevision,
    WizardStage,
)
from app.models.agent import ACTIVE_STATUSES

EXPORT_FORMAT = "weeaim.venture_archive.v1"


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


async def cancel_active_agent_runs(session: AsyncSession, venture: Venture) -> None:
    now = datetime.now(UTC)
    await session.execute(
        update(AgentRun)
        .where(AgentRun.venture_id == venture.id, AgentRun.status.in_(ACTIVE_STATUSES))
        .values(status="cancelled", finished_at=now, pending_call_id=None, error="venture_archived")
    )


async def export_venture(session: AsyncSession, venture: Venture) -> dict:
    stages = (await session.execute(select(WizardStage).order_by(WizardStage.number))).scalars().all()
    responses = {
        r.wizard_stage_id: r
        for r in (
            await session.execute(select(WizardResponse).where(WizardResponse.venture_id == venture.id))
        ).scalars()
    }
    revisions: dict = {}
    for rev in (
        await session.execute(
            select(WizardResponseRevision)
            .where(WizardResponseRevision.venture_id == venture.id)
            .order_by(WizardResponseRevision.version_number)
        )
    ).scalars():
        revisions.setdefault(rev.wizard_response_id, []).append(
            {
                "version": rev.version_number,
                "status": rev.status,
                "answers": rev.answers,
                "saved_at": _iso(rev.created_at),
            }
        )

    stage_entries = []
    for stage in stages:
        response = responses.get(stage.id)
        stage_entries.append(
            {
                "number": stage.number,
                "slug": stage.slug,
                "title_en": stage.title_en,
                "title_ko": stage.title_ko,
                "status": response.status if response else "not_started",
                "answers": response.answers if response else {},
                "ai_content": response.ai_analysis if response else None,
                "completed_at": _iso(response.completed_at) if response else None,
                "updated_at": _iso(response.updated_at) if response else None,
                "revisions": revisions.get(response.id, []) if response else [],
            }
        )

    async def rows(model, *order):
        return (
            await session.execute(select(model).where(model.venture_id == venture.id).order_by(*order))
        ).scalars().all()

    agent_runs = await rows(AgentRun, AgentRun.created_at)
    steps: dict = {}
    if agent_runs:
        for step in (
            await session.execute(
                select(AgentRunStep)
                .where(AgentRunStep.run_id.in_([r.id for r in agent_runs]))
                .order_by(AgentRunStep.seq)
            )
        ).scalars():
            steps.setdefault(step.run_id, []).append(
                {"seq": step.seq, "kind": step.kind, "tool": step.tool_name, "arguments": step.arguments}
            )

    return {
        "format": EXPORT_FORMAT,
        "exported_at": datetime.now(UTC).isoformat(),
        "venture": {
            "id": str(venture.id),
            "title": venture.title,
            "original_idea": venture.original_idea,
            "current_idea_statement": venture.current_idea_statement,
            "industry": venture.industry,
            "geography": venture.geography,
            "created_at": _iso(venture.created_at),
            "archived_at": _iso(venture.archived_at),
        },
        "idea_versions": [
            {"version": v.version_number, "idea": v.idea_text, "interpretation": v.structured_interpretation,
             "created_at": _iso(v.created_at)}
            for v in await rows(IdeaVersion, IdeaVersion.version_number)
        ],
        "stages": stage_entries,
        "research_runs": [
            {"operation": r.operation, "status": r.status, "model": r.model, "created_at": _iso(r.created_at),
             "output": r.output_payload}
            for r in await rows(AIRun, AIRun.created_at)
        ],
        "persona_chats": [
            {"persona_id": m.persona_id, "role": m.role, "content": m.content, "created_at": _iso(m.created_at)}
            for m in await rows(PersonaMessage, PersonaMessage.created_at, PersonaMessage.id)
        ],
        "agent_runs": [
            {"stage": r.stage_slug, "status": r.status, "proposed_answers": r.proposed_answers,
             "created_at": _iso(r.created_at), "steps": steps.get(r.id, [])}
            for r in agent_runs
        ],
        "documents": [
            {"filename": d.original_filename, "mime_type": d.mime_type, "size_bytes": d.size_bytes,
             "uploaded_at": _iso(d.created_at)}
            for d in await rows(Document, Document.created_at)
            if d.deleted_at is None
        ],
    }


def export_filename(venture: Venture) -> str:
    """ASCII-only, e.g. weeaim-archive-korean-recipe-cooking.json."""
    slug = re.sub(r"[^a-z0-9]+", "-", venture.title.lower()).strip("-")[:60] or "venture"
    return f"weeaim-archive-{slug}.json"
