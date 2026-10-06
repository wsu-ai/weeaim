"""The Supabase Data API roles must have no access to WEEAIM tables.

Simulates Supabase locally: inside a transaction that is rolled back, create
the `anon`/`authenticated` roles, grant them access the way Supabase's
defaults do, run the migration's SQL, and check the access is gone.
"""

import importlib.util
from pathlib import Path

import asyncpg
import pytest
from sqlalchemy.engine import make_url

from app.config import settings

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "a7c3e5f9d218_revoke_supabase_api_roles.py"
)


def _revoke_sql() -> str:
    spec = importlib.util.spec_from_file_location("revoke_migration", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.REVOKE_SQL


@pytest.mark.asyncio
async def test_revoke_removes_api_role_access_and_is_harmless_without_them():
    url = make_url(settings.database_url)  # the test database (conftest)
    connection = await asyncpg.connect(
        user=url.username, password=url.password, host=url.host, port=url.port or 5432,
        database=url.database,
    )
    try:
        # Without the roles (plain Postgres): runs cleanly.
        await connection.execute(_revoke_sql())

        transaction = connection.transaction()
        await transaction.start()
        try:
            for role in ("anon", "authenticated"):
                exists = await connection.fetchval("SELECT 1 FROM pg_roles WHERE rolname = $1", role)
                if not exists:
                    await connection.execute(f"CREATE ROLE {role} NOLOGIN")
                await connection.execute(f"GRANT SELECT, INSERT ON users, email_codes TO {role}")
            assert await connection.fetchval("SELECT has_table_privilege('anon', 'users', 'SELECT')")

            await connection.execute(_revoke_sql())

            for role in ("anon", "authenticated"):
                for table in ("users", "email_codes"):
                    for privilege in ("SELECT", "INSERT"):
                        assert not await connection.fetchval(
                            "SELECT has_table_privilege($1, $2, $3)", role, table, privilege
                        ), (role, table, privilege)
        finally:
            await transaction.rollback()
    finally:
        await connection.close()
