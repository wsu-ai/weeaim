import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app import config
from app.db import async_session
from app.main import app
from app.models import Organization, OrganizationMember, User


async def _seed_user(session, suffix: str, *, with_org: bool = True) -> tuple[str | None, str]:
    user = User(email=f"user-{suffix}@test.dev", display_name=f"Test User {suffix}")
    session.add(user)
    org_slug = None
    if with_org:
        org = Organization(name=f"Test Org {suffix}", slug=f"test-org-{suffix}")
        session.add(org)
        await session.flush()
        session.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="owner"))
        org_slug = org.slug
    await session.commit()
    return org_slug, user.email


async def _cleanup(session, org_slug: str | None, user_email: str) -> None:
    user_ids = select(User.id).where(User.email == user_email)
    await session.execute(
        delete(OrganizationMember).where(OrganizationMember.user_id.in_(user_ids))
    )
    await session.execute(delete(User).where(User.email == user_email))
    if org_slug is not None:
        await session.execute(delete(Organization).where(Organization.slug == org_slug))
    await session.commit()


async def _login(email: str):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post("/api/auth/dev-login", json={"email": email})


@pytest.mark.asyncio
async def test_dev_login_returns_user_and_organizations():
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email = await _seed_user(session, suffix)

    try:
        response = await _login(user_email)
        assert response.status_code == 200
        body = response.json()
        assert body["email"] == user_email
        assert body["display_name"] == f"Test User {suffix}"
        assert body["organizations"] == [
            {"slug": org_slug, "name": f"Test Org {suffix}", "role": "owner"}
        ]
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_dev_login_trims_whitespace():
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email = await _seed_user(session, suffix)

    try:
        response = await _login(f"  {user_email}  ")
        assert response.status_code == 200
        assert response.json()["email"] == user_email
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_dev_login_rejects_unknown_email():
    response = await _login(f"nobody-{uuid.uuid4().hex[:8]}@test.dev")
    assert response.status_code == 401
    assert response.json()["detail"] == "Unknown user or organization"


@pytest.mark.asyncio
async def test_dev_login_rejects_user_without_membership():
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email = await _seed_user(session, suffix, with_org=False)

    try:
        response = await _login(user_email)
        assert response.status_code == 401
        # Same message as an unknown email -- no account enumeration.
        assert response.json()["detail"] == "Unknown user or organization"
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_dev_login_rejects_empty_body():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/auth/dev-login", json={})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_dev_login_disabled_in_production(monkeypatch):
    monkeypatch.setattr(config.settings, "environment", "production")
    response = await _login("dev@weeaim.local")
    assert response.status_code == 501


@pytest.mark.asyncio
async def test_dev_login_lists_only_own_organizations():
    """Two tenants: each user's login must list only their own organization."""
    suffix_a = uuid.uuid4().hex[:8]
    suffix_b = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_a, email_a = await _seed_user(session, suffix_a)
    async with async_session() as session:
        org_b, email_b = await _seed_user(session, suffix_b)

    try:
        body_a = (await _login(email_a)).json()
        body_b = (await _login(email_b)).json()
        assert [o["slug"] for o in body_a["organizations"]] == [org_a]
        assert [o["slug"] for o in body_b["organizations"]] == [org_b]
    finally:
        async with async_session() as session:
            await _cleanup(session, org_a, email_a)
        async with async_session() as session:
            await _cleanup(session, org_b, email_b)
