"""row level security

Revision ID: ed93609ca675
Revises: 1d239d74f4b4
Create Date: 2026-09-28 13:08:53.790037

"""
from typing import Sequence, Union

from alembic import op

from app.config import settings

# revision identifiers, used by Alembic.
revision: str = 'ed93609ca675'
down_revision: Union[str, Sequence[str], None] = '1d239d74f4b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Direct organization_id column: simple equality policy.
DIRECT_TABLES = ["ventures", "documents", "document_chunks", "ai_runs", "audit_logs"]

# Scoped via venture_id -> ventures.organization_id: subquery policy.
FK_CHAIN_TABLES = ["venture_members", "wizard_responses", "idea_versions", "evidence_items"]

# NULLIF(..., '') matters here: once a pooled physical connection has had
# app.current_organization_id set (even transaction-locally) by any session,
# Postgres resets a custom GUC to '' (not NULL) after that transaction ends,
# for any later session reusing the same connection. Casting '' straight to
# ::uuid throws a hard error instead of denying cleanly, so every read must
# be guarded through NULLIF first.
CURRENT_ORG = "NULLIF(current_setting('app.current_organization_id', true), '')::uuid"

TENANT_CONDITION = {
    True: f"organization_id = {CURRENT_ORG}",
    False: (
        "venture_id IN ("
        "SELECT id FROM ventures "
        f"WHERE organization_id = {CURRENT_ORG}"
        ")"
    ),
}


def _pg_quote_literal(value: str) -> str:
    # Postgres DDL (CREATE ROLE ... PASSWORD) requires a string literal here,
    # not a bind parameter, so we quote it ourselves. The value itself is
    # never hardcoded in this file -- it's read from settings (.env) at
    # migration-run time.
    return "'" + value.replace("'", "''") + "'"


def _create_role_if_missing(name: str, options: str, password: str) -> None:
    # Roles are cluster-wide, not per-database: a second database on the
    # same server (e.g. the test database, see tests/conftest.py) finds them
    # already created by the first, so only create when missing.
    op.execute(
        f"DO $roles$ BEGIN "
        f"IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{name}') THEN "
        f"CREATE ROLE {name} {options} PASSWORD {_pg_quote_literal(password)}; "
        f"END IF; END $roles$"
    )


def upgrade() -> None:
    _create_role_if_missing("venture_app", "LOGIN", settings.app_db_password)
    _create_role_if_missing("venture_service", "LOGIN BYPASSRLS", settings.service_db_password)

    op.execute("GRANT USAGE ON SCHEMA public TO venture_app, venture_service")
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public "
        "TO venture_app, venture_service"
    )
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO venture_app, venture_service"
    )

    for table in DIRECT_TABLES:
        condition = TENANT_CONDITION[True]
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            f"FOR ALL USING ({condition}) WITH CHECK ({condition})"
        )

    for table in FK_CHAIN_TABLES:
        condition = TENANT_CONDITION[False]
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            f"FOR ALL USING ({condition}) WITH CHECK ({condition})"
        )


def downgrade() -> None:
    for table in DIRECT_TABLES + FK_CHAIN_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.execute(
        "REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM venture_app, venture_service"
    )
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        "REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM venture_app, venture_service"
    )
    op.execute("REVOKE USAGE ON SCHEMA public FROM venture_app, venture_service")
    op.execute("DROP OWNED BY venture_app, venture_service")
    op.execute("DROP ROLE venture_app")
    op.execute("DROP ROLE venture_service")
