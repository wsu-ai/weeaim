"""Starting agent runs in the background, inside the API process.

A run is an asyncio task; its state lives in agent_runs, so any API worker
can report progress. A server restart kills running tasks: such a run stops
sending heartbeats and is marked failed ("interrupted") the next time its
venture's runs are read or started. Moving to a job queue later only means
replacing launch_in_background.
"""

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, or_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.runner import run_agent
from app.ai.base import AIProvider
from app.models import AgentRun

# Longer than one model turn can take, so a live run is never expired.
STALE_AFTER = timedelta(minutes=6)

AgentLauncher = Callable[[uuid.UUID, uuid.UUID, AIProvider, str | None], Awaitable[None]]

_tasks: set[asyncio.Task] = set()


async def launch_in_background(
    run_id: uuid.UUID, organization_id: uuid.UUID, provider: AIProvider, founder_answer: str | None = None
) -> None:
    task = asyncio.create_task(run_agent(run_id, organization_id, provider, founder_answer))
    _tasks.add(task)  # keep a reference until it finishes
    task.add_done_callback(_tasks.discard)


def get_agent_launcher() -> AgentLauncher:
    return launch_in_background


async def expire_stale_runs(session: AsyncSession, venture_id: uuid.UUID) -> None:
    """Marks the venture's queued/running runs with no recent heartbeat as
    failed. Runs in the caller's RLS scope; the caller commits."""
    now = datetime.now(UTC)
    cutoff = now - STALE_AFTER
    await session.execute(
        update(AgentRun)
        .where(
            AgentRun.venture_id == venture_id,
            AgentRun.status.in_(("queued", "running")),
            or_(
                AgentRun.heartbeat_at < cutoff,
                and_(AgentRun.heartbeat_at.is_(None), AgentRun.created_at < cutoff),
            ),
        )
        .values(status="failed", error="interrupted", finished_at=now, pending_call_id=None)
    )
