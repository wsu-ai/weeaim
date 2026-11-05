"""token usage ledger and organization token limits, with row-level security

Revision ID: c5a8e2f1d904
Revises: b2f7c9e4a613
Create Date: 2026-10-20 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'c5a8e2f1d904'
down_revision: Union[str, Sequence[str], None] = 'b2f7c9e4a613'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Same tenant condition as ed93609ca675 (see the NULLIF note there).
CURRENT_ORG = "NULLIF(current_setting('app.current_organization_id', true), '')::uuid"
CONDITION = f"organization_id = {CURRENT_ORG}"


def upgrade() -> None:
    op.create_table(
        "token_usage",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "venture_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ventures.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("operation", sa.String(50), nullable=False),
        sa.Column("tokens", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("tokens >= 0", name="ck_token_usage_tokens"),
    )
    op.create_index("ix_token_usage_organization_id", "token_usage", ["organization_id"])
    op.create_index("ix_token_usage_venture_id", "token_usage", ["venture_id"])

    op.create_table(
        "organization_token_limits",
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("per_venture_limit", sa.BigInteger(), nullable=True),
        sa.Column("organization_limit", sa.BigInteger(), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("per_venture_limit IS NULL OR per_venture_limit > 0", name="ck_token_limits_venture"),
        sa.CheckConstraint("organization_limit IS NULL OR organization_limit > 0", name="ck_token_limits_org"),
    )

    # Agent runs already recorded their tokens: carry them over. (Before RLS is
    # forced, so this works for a non-superuser schema owner too.)
    op.execute(
        "INSERT INTO token_usage (organization_id, venture_id, user_id, operation, tokens, created_at) "
        "SELECT organization_id, venture_id, started_by, 'agent_turn', tokens_used, created_at "
        "FROM agent_runs WHERE tokens_used > 0"
    )

    # Tenant isolation, as for ai_runs. Grants come from the default privileges.
    for table in ("token_usage", "organization_token_limits"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(f"CREATE POLICY tenant_isolation ON {table} FOR ALL USING ({CONDITION}) WITH CHECK ({CONDITION})")


def downgrade() -> None:
    for table in ("organization_token_limits", "token_usage"):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
    op.drop_table("organization_token_limits")
    op.drop_index("ix_token_usage_venture_id", table_name="token_usage")
    op.drop_index("ix_token_usage_organization_id", table_name="token_usage")
    op.drop_table("token_usage")
