"""agent runs and steps tables with row-level security

Revision ID: f9a2c6d4e817
Revises: b4d7f2a9c815
Create Date: 2026-10-14 19:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'f9a2c6d4e817'
down_revision: Union[str, Sequence[str], None] = 'b4d7f2a9c815'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Same tenant condition as ed93609ca675 (see the NULLIF note there).
CURRENT_ORG = "NULLIF(current_setting('app.current_organization_id', true), '')::uuid"
CONDITION = f"organization_id = {CURRENT_ORG}"

RUN_STATUSES = "'queued', 'running', 'waiting_for_founder', 'succeeded', 'failed', 'cancelled'"
ACTIVE_STATUSES = "'queued', 'running', 'waiting_for_founder'"
STEP_KINDS = "'model', 'tool', 'web_search', 'question', 'answer', 'limit', 'error'"


def _uuid_pk() -> sa.Column:
    return sa.Column(
        "id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
    )


def _org() -> sa.Column:
    return sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False)


def upgrade() -> None:
    op.create_table(
        "agent_runs",
        _uuid_pk(),
        _org(),
        sa.Column("venture_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ventures.id"), nullable=False),
        sa.Column("stage_slug", sa.String(50), nullable=False),
        sa.Column("started_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("language", sa.String(5), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("model_turns", sa.Integer(), server_default="0", nullable=False),
        sa.Column("web_searches", sa.Integer(), server_default="0", nullable=False),
        sa.Column("questions_asked", sa.Integer(), server_default="0", nullable=False),
        sa.Column("tokens_used", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_response_id", sa.String(100), nullable=True),
        sa.Column("pending_call_id", sa.String(100), nullable=True),
        sa.Column("pending_question", sa.Text(), nullable=True),
        sa.Column("gathered", postgresql.JSONB(), nullable=True),
        sa.Column("proposed_answers", postgresql.JSONB(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(f"status IN ({RUN_STATUSES})", name="ck_agent_run_status"),
    )
    op.create_index("ix_agent_runs_organization_id", "agent_runs", ["organization_id"])
    op.create_index("ix_agent_runs_venture_id", "agent_runs", ["venture_id"])
    op.create_index(
        "uq_agent_runs_active",
        "agent_runs",
        ["venture_id", "stage_slug"],
        unique=True,
        postgresql_where=sa.text(f"status IN ({ACTIVE_STATUSES})"),
    )

    op.create_table(
        "agent_run_steps",
        _uuid_pk(),
        _org(),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agent_runs.id"), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("tool_name", sa.String(50), nullable=True),
        sa.Column("arguments", postgresql.JSONB(), nullable=True),
        sa.Column("result", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(f"kind IN ({STEP_KINDS})", name="ck_agent_run_step_kind"),
    )
    op.create_index("ix_agent_run_steps_organization_id", "agent_run_steps", ["organization_id"])
    op.create_index("ix_agent_run_steps_run_id", "agent_run_steps", ["run_id"])

    # Tenant isolation, as for ai_runs. Grants for venture_app/venture_service
    # come from the default privileges (ed93609ca675); the Supabase API roles
    # get none (a7c3e5f9d218).
    for table in ("agent_runs", "agent_run_steps"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(f"CREATE POLICY tenant_isolation ON {table} FOR ALL USING ({CONDITION}) WITH CHECK ({CONDITION})")


def downgrade() -> None:
    for table in ("agent_run_steps", "agent_runs"):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
    op.drop_index("ix_agent_run_steps_run_id", table_name="agent_run_steps")
    op.drop_index("ix_agent_run_steps_organization_id", table_name="agent_run_steps")
    op.drop_table("agent_run_steps")
    op.drop_index("uq_agent_runs_active", table_name="agent_runs")
    op.drop_index("ix_agent_runs_venture_id", table_name="agent_runs")
    op.drop_index("ix_agent_runs_organization_id", table_name="agent_runs")
    op.drop_table("agent_runs")
