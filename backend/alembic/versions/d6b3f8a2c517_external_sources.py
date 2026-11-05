"""external data sources per organization, with row-level security

Revision ID: d6b3f8a2c517
Revises: c5a8e2f1d904
Create Date: 2026-10-29 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd6b3f8a2c517'
down_revision: Union[str, Sequence[str], None] = 'c5a8e2f1d904'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Same tenant condition as ed93609ca675 (see the NULLIF note there).
CURRENT_ORG = "NULLIF(current_setting('app.current_organization_id', true), '')::uuid"
CONDITION = f"organization_id = {CURRENT_ORG}"


def upgrade() -> None:
    op.create_table(
        "external_sources",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("url_template", sa.String(500), nullable=False),
        sa.Column("header_name", sa.String(60), nullable=True),
        sa.Column("encrypted_key", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("last_status", sa.String(10), nullable=True),
        sa.Column("last_error", sa.String(300), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("url_template LIKE 'https://%'", name="ck_external_source_https"),
    )
    op.create_index("ix_external_sources_organization_id", "external_sources", ["organization_id"])
    # Tenant isolation, as for ai_runs. Grants come from the default privileges.
    op.execute("ALTER TABLE external_sources ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE external_sources FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY tenant_isolation ON external_sources FOR ALL USING ({CONDITION}) WITH CHECK ({CONDITION})"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON external_sources")
    op.drop_index("ix_external_sources_organization_id", table_name="external_sources")
    op.drop_table("external_sources")
