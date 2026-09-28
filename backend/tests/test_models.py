import pytest
from sqlalchemy.exc import IntegrityError

from app.db import async_session
from app.models import Organization, User, Venture
from app.tenancy import set_current_organization


@pytest.mark.asyncio
async def test_venture_requires_organization_and_owner():
    async with async_session() as session:
        org = Organization(name="Acme Inc", slug="acme-inc")
        user = User(email="founder@acme.test", display_name="Founder")
        session.add_all([org, user])
        await session.flush()
        await set_current_organization(session, org.id)

        venture = Venture(
            organization_id=org.id,
            owner_id=user.id,
            title="AI cooking assistant",
            original_idea="An AI-powered cooking assistant for Korean recipes.",
        )
        session.add(venture)
        await session.flush()

        assert venture.id is not None
        assert venture.status == "active"
        assert venture.language == "en"
        assert venture.current_wizard_stage == "idea_discovery"

        await session.rollback()


@pytest.mark.asyncio
async def test_organization_slug_must_be_unique():
    async with async_session() as session:
        session.add(Organization(name="Acme Inc", slug="dup-slug"))
        await session.flush()

        session.add(Organization(name="Other Inc", slug="dup-slug"))
        with pytest.raises(IntegrityError):
            await session.flush()

        await session.rollback()
