"""venture assets table (generated images) with row-level security

Revision ID: b3e7c1f5a920
Revises: a6d9e2b4f817
Create Date: 2026-10-13 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b3e7c1f5a920'
down_revision: Union[str, Sequence[str], None] = 'a6d9e2b4f817'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Same tenant condition as ed93609ca675 (see the NULLIF note there).
CURRENT_ORG = "NULLIF(current_setting('app.current_organization_id', true), '')::uuid"
CONDITION = f"organization_id = {CURRENT_ORG}"


def upgrade() -> None:
    op.create_table(
        "venture_assets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("venture_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ventures.id"), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "content_type IN ('image/webp', 'image/png', 'image/jpeg')",
            name="ck_venture_asset_content_type",
        ),
        sa.CheckConstraint("byte_size > 0 AND byte_size <= 5000000", name="ck_venture_asset_size"),
    )
    op.create_index("ix_venture_assets_organization_id", "venture_assets", ["organization_id"])
    op.create_index("ix_venture_assets_venture_id", "venture_assets", ["venture_id"])

    # Tenant isolation, as for ai_runs. Grants for venture_app/venture_service
    # come from the default privileges set in ed93609ca675; the Supabase API
    # roles get none (a7c3e5f9d218).
    op.execute("ALTER TABLE venture_assets ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE venture_assets FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY tenant_isolation ON venture_assets FOR ALL USING ({CONDITION}) WITH CHECK ({CONDITION})"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON venture_assets")
    op.drop_index("ix_venture_assets_venture_id", table_name="venture_assets")
    op.drop_index("ix_venture_assets_organization_id", table_name="venture_assets")
    op.drop_table("venture_assets")
