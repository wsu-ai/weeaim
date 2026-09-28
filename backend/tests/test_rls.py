import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError

from app.db import async_session
from app.models import Document, Organization, User, Venture, WizardResponse, WizardStage
from app.tenancy import set_current_organization


async def _make_org_and_venture(session, org_slug: str) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    org = Organization(name=org_slug, slug=org_slug)
    user = User(email=f"{org_slug}@test.dev", display_name=org_slug)
    session.add_all([org, user])
    await session.flush()
    await set_current_organization(session, org.id)

    venture = Venture(
        organization_id=org.id,
        owner_id=user.id,
        title=f"{org_slug} venture",
        original_idea="Some idea.",
    )
    session.add(venture)
    await session.flush()
    return org.id, user.id, venture.id


async def _cleanup_org(session, org_id: uuid.UUID, user_id: uuid.UUID) -> None:
    # Setting context to this org means RLS scopes every delete below to
    # exactly this org's rows, regardless of what else exists in the tables.
    await set_current_organization(session, org_id)
    for table in (
        WizardResponse.__table__,
        Document.__table__,
        Venture.__table__,
    ):
        await session.execute(table.delete())
    # organizations/users carry no RLS -- delete directly, now that their
    # RLS-protected children are gone (FK constraints would otherwise block this).
    await session.execute(User.__table__.delete().where(User.id == user_id))
    await session.execute(Organization.__table__.delete().where(Organization.id == org_id))


@pytest.mark.asyncio
async def test_org_cannot_see_or_reach_another_orgs_venture():
    async with async_session() as session:
        org_a, user_a, venture_a = await _make_org_and_venture(session, "org-a")
        org_b, user_b, venture_b = await _make_org_and_venture(session, "org-b")
        await session.commit()

    try:
        async with async_session() as session:
            await set_current_organization(session, org_a)

            visible = (await session.execute(select(Venture))).scalars().all()
            visible_ids = {v.id for v in visible}
            assert venture_a in visible_ids
            assert venture_b not in visible_ids

            direct_lookup = await session.get(Venture, venture_b)
            assert direct_lookup is None
    finally:
        async with async_session() as session:
            await _cleanup_org(session, org_a, user_a)
            await _cleanup_org(session, org_b, user_b)
            await session.commit()


@pytest.mark.asyncio
async def test_cross_org_insert_rejected_direct_and_fk_chain_tables():
    async with async_session() as session:
        org_a, user_a, venture_a = await _make_org_and_venture(session, "org-direct-a")
        org_b, user_b, venture_b = await _make_org_and_venture(session, "org-direct-b")
        await session.commit()

    stage_id = None
    try:
        # Direct-column table: documents.organization_id must match context.
        async with async_session() as session:
            await set_current_organization(session, org_a)
            session.add(
                Document(
                    organization_id=org_b,  # mismatched on purpose
                    venture_id=venture_b,
                    uploaded_by=user_a,
                    original_filename="pitch.pdf",
                    storage_key=str(uuid.uuid4()),
                    mime_type="application/pdf",
                    size_bytes=1024,
                )
            )
            with pytest.raises(DBAPIError):
                await session.flush()
            await session.rollback()

        # FK-chain table: wizard_responses scoped via venture_id -> ventures.organization_id.
        async with async_session() as session:
            stage = WizardStage(
                number=999,
                slug="rls-test-stage",
                title_en="Test",
                title_ko="Test",
            )
            session.add(stage)
            await session.flush()
            stage_id = stage.id
            await session.commit()

        async with async_session() as session:
            await set_current_organization(session, org_a)
            session.add(WizardResponse(venture_id=venture_b, wizard_stage_id=stage_id))
            with pytest.raises(DBAPIError):
                await session.flush()
            await session.rollback()
    finally:
        async with async_session() as session:
            await _cleanup_org(session, org_a, user_a)
            await _cleanup_org(session, org_b, user_b)
            if stage_id is not None:
                await session.execute(
                    WizardStage.__table__.delete().where(WizardStage.id == stage_id)
                )
            await session.commit()


@pytest.mark.asyncio
async def test_missing_organization_context_denies_all_access():
    async with async_session() as session:
        org_id, user_id, venture_id = await _make_org_and_venture(session, "org-deny-default")
        await session.commit()

    try:
        async with async_session() as session:
            # No set_current_organization call at all in this fresh session/transaction.
            ventures = (await session.execute(select(Venture))).scalars().all()
            documents = (await session.execute(select(Document))).scalars().all()
            assert ventures == []
            assert documents == []
    finally:
        async with async_session() as session:
            await _cleanup_org(session, org_id, user_id)
            await session.commit()
