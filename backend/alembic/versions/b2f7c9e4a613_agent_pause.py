"""agent runs can be paused; active_ms records time spent working

Revision ID: b2f7c9e4a613
Revises: a8e4d1c7b350
Create Date: 2026-10-16 14:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b2f7c9e4a613'
down_revision: Union[str, Sequence[str], None] = 'a8e4d1c7b350'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD_STATUSES = "'queued', 'running', 'waiting_for_founder', 'succeeded', 'failed', 'cancelled'"
NEW_STATUSES = OLD_STATUSES + ", 'paused'"
OLD_ACTIVE = "'queued', 'running', 'waiting_for_founder'"
NEW_ACTIVE = OLD_ACTIVE + ", 'paused'"


def _swap(statuses: str, active: str) -> None:
    op.drop_constraint("ck_agent_run_status", "agent_runs", type_="check")
    op.create_check_constraint("ck_agent_run_status", "agent_runs", f"status IN ({statuses})")
    op.drop_index("uq_agent_runs_active", table_name="agent_runs")
    op.create_index(
        "uq_agent_runs_active",
        "agent_runs",
        ["venture_id", "stage_slug"],
        unique=True,
        postgresql_where=sa.text(f"status IN ({active})"),
    )


def upgrade() -> None:
    op.add_column("agent_runs", sa.Column("active_ms", sa.Integer(), server_default="0", nullable=False))
    _swap(NEW_STATUSES, NEW_ACTIVE)


def downgrade() -> None:
    op.execute("UPDATE agent_runs SET status = 'cancelled' WHERE status = 'paused'")
    _swap(OLD_STATUSES, OLD_ACTIVE)
    op.drop_column("agent_runs", "active_ms")
