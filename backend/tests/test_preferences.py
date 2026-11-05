"""The user's default location (country and metropolitan city) for Stage 6."""

import pytest
import pytest_asyncio

from app.db import async_session
from app.models import User
from tests.test_admin_signups import World, client_for


@pytest_asyncio.fixture(loop_scope="session")
async def world():
    w = World()
    yield w
    await w.cleanup()


async def reload(user: User) -> User:
    async with async_session() as session:
        return await session.get(User, user.id)


@pytest.mark.asyncio
async def test_defaults_are_saved_trimmed_and_returned_by_me(world):
    org = await world.org("Woosong")
    user = await world.member("founder", [(org, "member")])

    async with client_for(user, org) as c:
        before = (await c.get("/api/auth/me")).json()
        assert before["default_country"] is None and before["default_metro_city"] is None

        response = await c.patch(
            "/api/auth/me/preferences",
            json={"default_country": "  South Korea ", "default_metro_city": "Seoul"},
        )
        assert response.status_code == 200
        assert response.json()["default_country"] == "South Korea"
        assert response.json()["active_organization"] == org.slug

        me = (await c.get("/api/auth/me")).json()
    assert (me["default_country"], me["default_metro_city"]) == ("South Korea", "Seoul")


@pytest.mark.asyncio
async def test_empty_values_clear_the_defaults(world):
    org = await world.org("Woosong")
    user = await world.member("founder", [(org, "member")])
    async with client_for(user, org) as c:
        await c.patch(
            "/api/auth/me/preferences", json={"default_country": "Japan", "default_metro_city": "Tokyo"}
        )
        response = await c.patch(
            "/api/auth/me/preferences", json={"default_country": " ", "default_metro_city": ""}
        )
    assert response.status_code == 200
    stored = await reload(user)
    assert stored.default_country is None and stored.default_metro_city is None


@pytest.mark.asyncio
async def test_only_the_callers_own_account_changes(world):
    org = await world.org("Woosong")
    alice = await world.member("alice", [(org, "member")])
    bob = await world.member("bob", [(org, "owner")])

    async with client_for(alice, org) as c:
        await c.patch(
            "/api/auth/me/preferences", json={"default_country": "Canada", "default_metro_city": "Toronto"}
        )
    assert (await reload(alice)).default_country == "Canada"
    assert (await reload(bob)).default_country is None


@pytest.mark.asyncio
async def test_preferences_validation_and_access(world):
    org = await world.org("Woosong")
    user = await world.member("founder", [(org, "member")])

    async with client_for(user, org) as c:
        too_long = await c.patch("/api/auth/me/preferences", json={"default_country": "x" * 101})
    async with client_for() as c:
        signed_out = await c.patch("/api/auth/me/preferences", json={"default_country": "Korea"})

    async with async_session() as session:
        stored = await session.get(User, user.id)
        stored.account_status = "disabled"
        await session.commit()
    async with client_for(user, org) as c:
        disabled = await c.patch("/api/auth/me/preferences", json={"default_country": "Korea"})

    assert too_long.status_code == 422
    assert signed_out.status_code == 401
    assert disabled.status_code == 401
    assert (await reload(user)).default_country is None
