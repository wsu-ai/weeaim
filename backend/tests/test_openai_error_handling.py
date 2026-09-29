import uuid

import httpx2
import pytest
from httpx import ASGITransport, AsyncClient
from openai import APIConnectionError
from sqlalchemy import delete, select

from app.ai.schemas import IdeaInterpretation
from app.db import async_session
from app.dependencies import get_ai_provider
from app.main import app
from app.models import Organization, OrganizationMember, User, Venture
from app.tenancy import set_current_organization

IDEA_TEXT = "An AI-powered cooking assistant for Korean recipes targeting U.S. households."


class _RaisingAIProvider:
    async def structure_idea(self, idea_text: str) -> IdeaInterpretation:
        raise APIConnectionError(request=httpx2.Request("POST", "https://api.openai.com/v1/responses"))


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
        await session.execute(Venture.__table__.delete())
        await session.execute(
            delete(OrganizationMember).where(OrganizationMember.organization_id == org.id)
        )
    await session.execute(delete(User).where(User.email == user_email))
    if org is not None:
        await session.execute(delete(Organization).where(Organization.id == org.id))
    await session.commit()


@pytest.mark.asyncio
async def test_openai_error_returns_clean_503_not_raw_500():
    app.dependency_overrides[get_ai_provider] = lambda: _RaisingAIProvider()
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    try:
        transport = ASGITransport(app=app)
        headers = {"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                f"/api/ventures/{venture_id}/interpret", headers=headers
            )
        assert response.status_code == 503
        assert "temporarily unavailable" in response.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_ai_provider, None)
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)
