import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app.ai.fake import FakeAIProvider
from app.db import async_session
from app.dependencies import get_ai_provider
from app.main import app
from app.models import (
    AuditLog,
    IdeaVersion,
    Organization,
    OrganizationMember,
    User,
    Venture,
)
from app.tenancy import set_current_organization

IDEA_TEXT = "An AI-powered cooking assistant for Korean recipes targeting U.S. households."


async def _seed_org_user_venture(session, suffix: str) -> tuple[str, str, uuid.UUID]:
    org = Organization(name=f"Test Org {suffix}", slug=f"test-org-{suffix}")
    user = User(email=f"user-{suffix}@test.dev", display_name="Test User")
    session.add_all([org, user])
    await session.flush()
    session.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="owner"))
    await set_current_organization(session, org.id)
    venture = Venture(
        organization_id=org.id,
        owner_id=user.id,
        title="placeholder",
        original_idea=IDEA_TEXT,
        current_idea_statement=IDEA_TEXT,
    )
    session.add(venture)
    await session.flush()
    venture_id = venture.id
    await session.commit()
    return org.slug, user.email, venture_id


async def _cleanup(session, org_slug: str, user_email: str) -> None:
    org = (
        await session.execute(select(Organization).where(Organization.slug == org_slug))
    ).scalar_one_or_none()
    if org is not None:
        await set_current_organization(session, org.id)
        await session.execute(AuditLog.__table__.delete())
        await session.execute(IdeaVersion.__table__.delete())
        await session.execute(Venture.__table__.delete())
        await session.execute(
            delete(OrganizationMember).where(OrganizationMember.organization_id == org.id)
        )
    await session.execute(delete(User).where(User.email == user_email))
    if org is not None:
        await session.execute(delete(Organization).where(Organization.id == org.id))
    await session.commit()


@pytest.fixture(autouse=True)
def _fake_ai_provider():
    app.dependency_overrides[get_ai_provider] = lambda: FakeAIProvider()
    yield
    app.dependency_overrides.pop(get_ai_provider, None)


@pytest.mark.asyncio
async def test_interpret_returns_fake_interpretation_without_persisting():
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                f"/api/ventures/{venture_id}/interpret",
                headers={"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug},
            )
        assert response.status_code == 200
        body = response.json()
        assert body["title"]
        assert 0 <= body["confidence"] <= 1

        async with async_session() as session:
            await set_current_organization(session, (await _org_id(session, org_slug)))
            count = (
                await session.execute(
                    select(IdeaVersion).where(IdeaVersion.venture_id == venture_id)
                )
            ).scalars().all()
            assert count == []
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_confirm_idea_persists_version_and_updates_venture():
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                f"/api/ventures/{venture_id}/confirm-idea",
                json={
                    "title": "Korean Recipe Cooking Assistant",
                    "summary": IDEA_TEXT,
                    "industry": "Food tech",
                    "geography": "United States",
                    "target_customer": "U.S. households",
                    "problem_hypothesis": "Hard to find authentic Korean recipes",
                    "confidence": 0.7,
                },
                headers={"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug},
            )
        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "Korean Recipe Cooking Assistant"

        async with async_session() as session:
            org_id = await _org_id(session, org_slug)
            await set_current_organization(session, org_id)
            versions = (
                await session.execute(
                    select(IdeaVersion).where(IdeaVersion.venture_id == venture_id)
                )
            ).scalars().all()
            assert len(versions) == 1
            assert versions[0].version_number == 1
            assert versions[0].structured_interpretation["industry"] == "Food tech"
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_interpret_rejects_cross_org_venture():
    suffix_a = uuid.uuid4().hex[:8]
    suffix_b = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_a_slug, user_a_email, venture_a_id = await _seed_org_user_venture(session, suffix_a)
    async with async_session() as session:
        org_b_slug, user_b_email, _ = await _seed_org_user_venture(session, suffix_b)

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                f"/api/ventures/{venture_a_id}/interpret",
                headers={"X-Dev-User-Email": user_b_email, "X-Dev-Organization-Slug": org_b_slug},
            )
        assert response.status_code == 404
    finally:
        async with async_session() as session:
            await _cleanup(session, org_a_slug, user_a_email)
        async with async_session() as session:
            await _cleanup(session, org_b_slug, user_b_email)


async def _org_id(session, org_slug: str) -> uuid.UUID:
    org = (
        await session.execute(select(Organization).where(Organization.slug == org_slug))
    ).scalar_one()
    return org.id
