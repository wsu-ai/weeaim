"""Point the whole test suite at its own database.

Tests create and delete users, organizations and ventures, so they must
never run against the development database (venture_platform). Before any
test module imports app.db (which creates the engine from settings), this
rewrites every database URL to the same server with "_test" appended to the
database name, creates that database if needed, and migrates it to head.
"""

import asyncio
from pathlib import Path

import asyncpg
from alembic import command
from alembic.config import Config
from sqlalchemy.engine import make_url

from app.config import settings

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_SUFFIX = "_test"


def _to_test_url(url: str) -> str:
    parsed = make_url(url)
    name = parsed.database or ""
    if not name.endswith(TEST_SUFFIX):
        name += TEST_SUFFIX
    return parsed.set(database=name).render_as_string(hide_password=False)


async def _ensure_database(owner_url: str) -> None:
    url = make_url(owner_url)
    connection = await asyncpg.connect(
        user=url.username,
        password=url.password,
        host=url.host,
        port=url.port or 5432,
        database="postgres",
    )
    try:
        exists = await connection.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = $1", url.database
        )
        if not exists:
            # Identifier can't be a bind parameter; it's derived from .env
            # and validated to end in _test below.
            await connection.execute(f'CREATE DATABASE "{url.database}" OWNER "{url.username}"')
    finally:
        await connection.close()


settings.database_url = _to_test_url(settings.database_url)
settings.app_database_url = _to_test_url(settings.app_database_url)
if settings.service_database_url:
    settings.service_database_url = _to_test_url(settings.service_database_url)

for _url in (settings.database_url, settings.app_database_url):
    if not (make_url(_url).database or "").endswith(TEST_SUFFIX):
        raise RuntimeError(f"Refusing to run tests against a non-test database: {_url}")

asyncio.run(_ensure_database(settings.database_url))

# alembic/env.py reads settings.database_url, which now names the test DB.
_alembic_config = Config(str(BACKEND_DIR / "alembic.ini"))
_alembic_config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
command.upgrade(_alembic_config, "head")
