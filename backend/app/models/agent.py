import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import CreatedAtMixin, TimestampMixin, UUIDPKMixin

RUN_STATUSES = ("queued", "running", "waiting_for_founder", "paused", "succeeded", "failed", "cancelled")
ACTIVE_STATUSES = ("queued", "running", "waiting_for_founder", "paused")
STEP_KINDS = ("model", "tool", "web_search", "question", "answer", "limit", "error")


class AgentRun(Base, UUIDPKMixin, TimestampMixin):
    """One run of a stage's AI agent (see app/agents/).

    Tenant-isolated by row-level security on organization_id, like ai_runs.
    At most one active run per venture and stage.
    """

    __tablename__ = "agent_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN (" + ", ".join(f"'{s}'" for s in RUN_STATUSES) + ")", name="ck_agent_run_status"
        ),
        Index(
            "uq_agent_runs_active",
            "venture_id",
            "stage_slug",
            unique=True,
            postgresql_where=text("status IN (" + ", ".join(f"'{s}'" for s in ACTIVE_STATUSES) + ")"),
        ),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True
    )
    venture_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ventures.id"), nullable=False, index=True
    )
    stage_slug: Mapped[str] = mapped_column(String(50), nullable=False)
    started_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    language: Mapped[str] = mapped_column(String(5), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    model_turns: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    web_searches: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    questions_asked: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    tokens_used: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # Time spent working (not waiting for the founder or paused).
    active_ms: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    last_response_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    pending_call_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    pending_question: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Sources gathered across turns; the final payload's link checks use them.
    gathered: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    proposed_answers: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentRunStep(Base, UUIDPKMixin, CreatedAtMixin):
    """One step of an agent run: a model turn, a tool call, a question..."""

    __tablename__ = "agent_run_steps"
    __table_args__ = (
        CheckConstraint(
            "kind IN (" + ", ".join(f"'{k}'" for k in STEP_KINDS) + ")", name="ck_agent_run_step_kind"
        ),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agent_runs.id"), nullable=False, index=True
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    tool_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    arguments: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
