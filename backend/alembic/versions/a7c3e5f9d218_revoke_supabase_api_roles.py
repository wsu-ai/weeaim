"""revoke supabase data api roles

Revision ID: a7c3e5f9d218
Revises: f4b81d0e2c57
Create Date: 2026-10-06 10:00:00.000000

Supabase exposes the public schema through its Data API (PostgREST) and
grants the `anon` and `authenticated` roles default privileges on new
tables. WEEAIM's tables are reached only through the backend -- several
(users, email_codes, user_consents, organizations, organization_members)
have no row-level security -- so those roles must have no access at all.
On plain Postgres (local, tests) the roles don't exist and this is a no-op.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a7c3e5f9d218'
down_revision: Union[str, Sequence[str], None] = 'f4b81d0e2c57'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

REVOKE_SQL = """
DO $revoke$
DECLARE
    api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', api_role);
            EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
            EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', api_role);
            -- Tables created later by this (migration) role get no grants either.
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', api_role);
        END IF;
    END LOOP;
END
$revoke$
"""


def upgrade() -> None:
    op.execute(REVOKE_SQL)


def downgrade() -> None:
    # Deliberately not re-granted: the API roles should never reach these tables.
    pass
