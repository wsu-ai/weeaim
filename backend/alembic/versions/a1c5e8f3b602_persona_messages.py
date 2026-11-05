"""persona chat messages table with row-level security

Revision ID: a1c5e8f3b602
Revises: f6c1d9e3a274
Create Date: 2026-10-14 09:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a1c5e8f3b602'
down_revision: Union[str, Sequence[str], None] = 'f6c1d9e3a274'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Same tenant condition as ed93609ca675 (see the NULLIF note there).
CURRENT_ORG = "NULLIF(current_setting('app.current_organization_id', true), '')::uuid"
CONDITION = f"organization_id = {CURRENT_ORG}"


def upgrade() -> None:
    op.create_table(
        "persona_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("venture_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ventures.id"), nullable=False),
        sa.Column("persona_id", sa.String(36), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("role IN ('founder', 'persona')", name="ck_persona_message_role"),
        sa.CheckConstraint("char_length(content) <= 4000", name="ck_persona_message_length"),
    )
    op.create_index("ix_persona_messages_organization_id", "persona_messages", ["organization_id"])
    op.create_index("ix_persona_messages_venture_id", "persona_messages", ["venture_id"])
    op.create_index("ix_persona_messages_persona_id", "persona_messages", ["persona_id"])

    # Tenant isolation, as for ai_runs. Grants for venture_app/venture_service
    # come from the default privileges (ed93609ca675); the Supabase API roles
    # get none (a7c3e5f9d218).
    op.execute("ALTER TABLE persona_messages ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE persona_messages FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY tenant_isolation ON persona_messages FOR ALL USING ({CONDITION}) WITH CHECK ({CONDITION})"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON persona_messages")
    op.drop_index("ix_persona_messages_persona_id", table_name="persona_messages")
    op.drop_index("ix_persona_messages_venture_id", table_name="persona_messages")
    op.drop_index("ix_persona_messages_organization_id", table_name="persona_messages")
    op.drop_table("persona_messages")
