import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app.ai.embedding_provider import FakeEmbeddingProvider
from app.ai.fake import FakeAIProvider
from app.db import async_session
from app.dependencies import get_ai_provider, get_embedding_provider
from app.main import app
from app.models import (
    AuditLog,
    Document,
    DocumentChunk,
    Organization,
    OrganizationMember,
    User,
    Venture,
    WizardResponse,
    WizardStage,
)
from app.tenancy import set_current_organization

IDEA_TEXT = "An AI-powered cooking assistant for Korean recipes targeting U.S. households."
_FAKE_EMBEDDER = FakeEmbeddingProvider(dimensions=1024)


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
        title="Cooking Assistant",
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
        await session.execute(WizardResponse.__table__.delete())
        await session.execute(DocumentChunk.__table__.delete())
        await session.execute(Document.__table__.delete())
        await session.execute(Venture.__table__.delete())
        await session.execute(
            delete(OrganizationMember).where(OrganizationMember.organization_id == org.id)
        )
    await session.execute(delete(User).where(User.email == user_email))
    if org is not None:
        await session.execute(delete(Organization).where(Organization.id == org.id))
    await session.commit()


@pytest.fixture(autouse=True)
def _fake_providers():
    app.dependency_overrides[get_ai_provider] = lambda: FakeAIProvider()
    app.dependency_overrides[get_embedding_provider] = lambda: _FAKE_EMBEDDER
    yield
    app.dependency_overrides.pop(get_ai_provider, None)
    app.dependency_overrides.pop(get_embedding_provider, None)


@pytest.mark.asyncio
async def test_report_includes_stage_summary_and_evidence():
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    async with async_session() as session:
        org = (
            await session.execute(select(Organization).where(Organization.slug == org_slug))
        ).scalar_one()
        await set_current_organization(session, org.id)

        stage = (
            await session.execute(
                select(WizardStage).where(WizardStage.slug == "problem_definition")
            )
        ).scalar_one()
        session.add(
            WizardResponse(
                venture_id=venture_id,
                wizard_stage_id=stage.id,
                status="completed",
                answers={"problem_statement": "Hard to find authentic recipes."},
                ai_analysis={"summary": "Clear problem statement."},
            )
        )

        document = Document(
            organization_id=org.id,
            venture_id=venture_id,
            uploaded_by=(
                await session.execute(select(User).where(User.email == user_email))
            ).scalar_one().id,
            original_filename="notes.txt",
            storage_key=f"{org.id}/{venture_id}/{uuid.uuid4()}.txt",
            mime_type="text/plain",
            size_bytes=10,
        )
        session.add(document)
        await session.flush()

        embedding = (await _FAKE_EMBEDDER.embed([IDEA_TEXT]))[0]
        chunk = DocumentChunk(
            organization_id=org.id,
            venture_id=venture_id,
            document_id=document.id,
            chunk_index=0,
            content=IDEA_TEXT,
            embedding=embedding,
        )
        session.add(chunk)
        await session.commit()
        chunk_id = chunk.id

    try:
        transport = ASGITransport(app=app)
        headers = {"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(f"/api/ventures/{venture_id}/report", headers=headers)
        assert response.status_code == 200
        body = response.json()

        assert len(body["stages"]) == 1
        assert body["stages"][0]["slug"] == "problem_definition"
        assert body["stages"][0]["analysis_summary"] == "Clear problem statement."

        assert any(e["citation_id"] == str(chunk_id) for e in body["evidence"])
        assert body["synthesis"]["summary"]
        assert body["synthesis"]["recommendation"]
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_report_succeeds_with_no_stages_or_documents():
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    try:
        transport = ASGITransport(app=app)
        headers = {"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(f"/api/ventures/{venture_id}/report", headers=headers)
        assert response.status_code == 200
        body = response.json()
        assert body["stages"] == []
        assert body["evidence"] == []
        assert body["synthesis"]["summary"]
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_report_rejects_cross_org_venture():
    suffix_a = uuid.uuid4().hex[:8]
    suffix_b = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_a_slug, user_a_email, venture_a_id = await _seed_org_user_venture(session, suffix_a)
    async with async_session() as session:
        org_b_slug, user_b_email, _ = await _seed_org_user_venture(session, suffix_b)

    try:
        transport = ASGITransport(app=app)
        headers_b = {"X-Dev-User-Email": user_b_email, "X-Dev-Organization-Slug": org_b_slug}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                f"/api/ventures/{venture_a_id}/report", headers=headers_b
            )
        assert response.status_code == 404
    finally:
        async with async_session() as session:
            await _cleanup(session, org_a_slug, user_a_email)
        async with async_session() as session:
            await _cleanup(session, org_b_slug, user_b_email)
