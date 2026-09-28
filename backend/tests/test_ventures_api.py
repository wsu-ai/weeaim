import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app import config
from app.db import async_session
from app.main import app
from app.models import AuditLog, Organization, OrganizationMember, User, Venture
from app.tenancy import set_current_organization


async def _seed_org_user(session, suffix: str) -> tuple[str, str]:
    org = Organization(name=f"Test Org {suffix}", slug=f"test-org-{suffix}")
    user = User(email=f"user-{suffix}@test.dev", display_name="Test User")
    session.add_all([org, user])
    await session.flush()
    session.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="owner"))
    await session.commit()
    return org.slug, user.email


async def _cleanup(session, org_slug: str, user_email: str) -> None:
    org = (
        await session.execute(select(Organization).where(Organization.slug == org_slug))
    ).scalar_one_or_none()
    if org is not None:
        await set_current_organization(session, org.id)
        await session.execute(AuditLog.__table__.delete())
        await session.execute(Venture.__table__.delete())
        await session.execute(
            delete(OrganizationMember).where(OrganizationMember.organization_id == org.id)
        )
    await session.execute(delete(User).where(User.email == user_email))
    if org is not None:
        await session.execute(delete(Organization).where(Organization.id == org.id))
    await session.commit()


@pytest.mark.asyncio
async def test_create_venture_success():
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email = await _seed_org_user(session, suffix)

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/ventures",
                json={"idea": "An AI-powered cooking assistant for Korean recipes."},
                headers={
                    "X-Dev-User-Email": user_email,
                    "X-Dev-Organization-Slug": org_slug,
                },
            )
        assert response.status_code == 201
        body = response.json()
        assert body["title"].startswith("An AI-powered cooking assistant")
        assert body["status"] == "active"
        assert body["current_wizard_stage"] == "idea_discovery"
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_create_venture_rejects_missing_headers():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/ventures",
            json={"idea": "An AI-powered cooking assistant for Korean recipes."},
        )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_create_venture_rejects_unknown_identity():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/ventures",
            json={"idea": "An AI-powered cooking assistant for Korean recipes."},
            headers={
                "X-Dev-User-Email": "nobody@nowhere.test",
                "X-Dev-Organization-Slug": "no-such-org",
            },
        )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_create_venture_rejects_short_idea():
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email = await _seed_org_user(session, suffix)

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/ventures",
                json={"idea": "too short"},
                headers={
                    "X-Dev-User-Email": user_email,
                    "X-Dev-Organization-Slug": org_slug,
                },
            )
        assert response.status_code == 422
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_auth_disabled_in_production(monkeypatch):
    monkeypatch.setattr(config.settings, "environment", "production")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/ventures",
            json={"idea": "An AI-powered cooking assistant for Korean recipes."},
            headers={
                "X-Dev-User-Email": "dev@weeaim.local",
                "X-Dev-Organization-Slug": "dev-org",
            },
        )
    assert response.status_code == 501
