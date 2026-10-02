"""A stopped database must surface as a clear 503, not a bare 500.

Never touches the real database: get_session is replaced by one that fails
the way asyncpg/SQLAlchemy do when Postgres isn't running.
"""

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import OperationalError

from app.db import get_session
from app.main import app

UNAVAILABLE = "A required service is temporarily unavailable. Please try again shortly."


def failing_session(exc: Exception):
    async def _get_session():
        raise exc
        yield  # pragma: no cover -- makes this an async generator like get_session

    return _get_session


@pytest.fixture
def database_down():
    def set_failure(exc: Exception) -> None:
        app.dependency_overrides[get_session] = failing_session(exc)

    yield set_failure
    app.dependency_overrides.pop(get_session, None)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc",
    [
        ConnectionRefusedError(10061, "Connect call failed ('127.0.0.1', 5432)"),
        TimeoutError("connect timed out"),
        OperationalError("SELECT 1", {}, Exception("server closed the connection")),
    ],
    ids=["refused", "timeout", "dropped"],
)
async def test_database_unavailable_returns_503(database_down, exc):
    database_down(exc)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        sign_in = await client.post("/api/auth/dev-login", json={"email": "dev@weeaim.local"})
        venture = await client.post(
            "/api/ventures",
            json={"idea": "An AI-powered cooking assistant for Korean recipes."},
            headers={"X-Dev-User-Email": "dev@weeaim.local", "X-Dev-Organization-Slug": "dev-org"},
        )

    for response in (sign_in, venture):
        assert response.status_code == 503
        assert response.json() == {"detail": UNAVAILABLE}
