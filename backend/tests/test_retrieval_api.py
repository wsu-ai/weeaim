import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app import config
from app.ai.embedding_provider import FakeEmbeddingProvider
from app.db import async_session
from app.dependencies import get_embedding_provider
from app.main import app
from app.models import (
    AuditLog,
    Document,
    DocumentChunk,
    Organization,
    OrganizationMember,
    User,
    Venture,
)
from app.tenancy import set_current_organization

IDEA_TEXT = "An AI-powered cooking assistant for Korean recipes targeting U.S. households."
_FAKE_PROVIDER = FakeEmbeddingProvider(dimensions=1024)


async def _seed_org_user_venture(session, suffix: str) -> tuple[str, str, uuid.UUID, uuid.UUID]:
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

    document = Document(
        organization_id=org.id,
        venture_id=venture.id,
        uploaded_by=user.id,
        original_filename="notes.txt",
        storage_key=f"{org.id}/{venture.id}/{uuid.uuid4()}.txt",
        mime_type="text/plain",
        size_bytes=10,
    )
    session.add(document)
    await session.flush()

    org_id, venture_id, document_id = org.id, venture.id, document.id
    await session.commit()
    return org.slug, user.email, venture_id, document_id


async def _add_chunk(
    session, org_id: uuid.UUID, venture_id: uuid.UUID, document_id: uuid.UUID, content: str,
    index: int, embed: bool = True,
) -> DocumentChunk:
    embedding = (await _FAKE_PROVIDER.embed([content]))[0] if embed else None
    chunk = DocumentChunk(
        organization_id=org_id,
        venture_id=venture_id,
        document_id=document_id,
        chunk_index=index,
        content=content,
        embedding=embedding,
    )
    session.add(chunk)
    await session.flush()
    return chunk


async def _cleanup(session, org_slug: str, user_email: str) -> None:
    org = (
        await session.execute(select(Organization).where(Organization.slug == org_slug))
    ).scalar_one_or_none()
    if org is not None:
        await set_current_organization(session, org.id)
        await session.execute(AuditLog.__table__.delete())
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
def _fake_embedder():
    app.dependency_overrides[get_embedding_provider] = lambda: _FAKE_PROVIDER
    yield
    app.dependency_overrides.pop(get_embedding_provider, None)


@pytest.mark.asyncio
async def test_retrieve_never_leaks_across_organizations():
    suffix_a = uuid.uuid4().hex[:8]
    suffix_b = uuid.uuid4().hex[:8]
    shared_content = "Apple pie recipe secrets for grandma's kitchen."

    async with async_session() as session:
        org_a_slug, user_a_email, venture_a_id, doc_a_id = await _seed_org_user_venture(
            session, suffix_a
        )
    async with async_session() as session:
        org_b_slug, user_b_email, venture_b_id, doc_b_id = await _seed_org_user_venture(
            session, suffix_b
        )

    async with async_session() as session:
        org_a = (
            await session.execute(select(Organization).where(Organization.slug == org_a_slug))
        ).scalar_one()
        await set_current_organization(session, org_a.id)
        await _add_chunk(session, org_a.id, venture_a_id, doc_a_id, shared_content, 0)
        await session.commit()

    async with async_session() as session:
        org_b = (
            await session.execute(select(Organization).where(Organization.slug == org_b_slug))
        ).scalar_one()
        await set_current_organization(session, org_b.id)
        await _add_chunk(session, org_b.id, venture_b_id, doc_b_id, shared_content, 0)
        await session.commit()

    try:
        transport = ASGITransport(app=app)
        headers_a = {"X-Dev-User-Email": user_a_email, "X-Dev-Organization-Slug": org_a_slug}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                f"/api/ventures/{venture_a_id}/retrieve",
                json={"query": shared_content, "limit": 10},
                headers=headers_a,
            )
        assert response.status_code == 200
        results = response.json()
        assert len(results) == 1
        assert results[0]["document_id"] == str(doc_a_id)
    finally:
        async with async_session() as session:
            await _cleanup(session, org_a_slug, user_a_email)
        async with async_session() as session:
            await _cleanup(session, org_b_slug, user_b_email)


@pytest.mark.asyncio
async def test_retrieve_ranks_exact_vector_match_first():
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id, document_id = await _seed_org_user_venture(
            session, suffix
        )

    match_content = "apple banana cherry smoothie recipe"
    async with async_session() as session:
        org = (
            await session.execute(select(Organization).where(Organization.slug == org_slug))
        ).scalar_one()
        await set_current_organization(session, org.id)
        match_chunk = await _add_chunk(
            session, org.id, venture_id, document_id, match_content, 0
        )
        await _add_chunk(
            session, org.id, venture_id, document_id, "completely unrelated zebra topic", 1
        )
        match_chunk_id = match_chunk.id
        await session.commit()

    try:
        transport = ASGITransport(app=app)
        headers = {"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                f"/api/ventures/{venture_id}/retrieve",
                json={"query": match_content, "limit": 10},
                headers=headers,
            )
        results = response.json()
        assert results[0]["citation_id"] == str(match_chunk_id)
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_retrieve_finds_unembedded_chunk_via_fulltext():
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id, document_id = await _seed_org_user_venture(
            session, suffix
        )

    async with async_session() as session:
        org = (
            await session.execute(select(Organization).where(Organization.slug == org_slug))
        ).scalar_one()
        await set_current_organization(session, org.id)
        unembedded_chunk = await _add_chunk(
            session,
            org.id,
            venture_id,
            document_id,
            "zteste unique keyword content",
            0,
            embed=False,
        )
        unembedded_chunk_id = unembedded_chunk.id
        await session.commit()

    try:
        transport = ASGITransport(app=app)
        headers = {"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                f"/api/ventures/{venture_id}/retrieve",
                json={"query": "zteste", "limit": 10},
                headers=headers,
            )
        results = response.json()
        assert any(r["citation_id"] == str(unembedded_chunk_id) for r in results)
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_retrieve_clamps_limit_to_configured_max(monkeypatch):
    monkeypatch.setattr(config.settings, "retrieval_max_chunks", 1)
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id, document_id = await _seed_org_user_venture(
            session, suffix
        )

    async with async_session() as session:
        org = (
            await session.execute(select(Organization).where(Organization.slug == org_slug))
        ).scalar_one()
        await set_current_organization(session, org.id)
        await _add_chunk(session, org.id, venture_id, document_id, "shared keyword one", 0)
        await _add_chunk(session, org.id, venture_id, document_id, "shared keyword two", 1)
        await session.commit()

    try:
        transport = ASGITransport(app=app)
        headers = {"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                f"/api/ventures/{venture_id}/retrieve",
                json={"query": "shared keyword", "limit": 10},
                headers=headers,
            )
        assert len(response.json()) <= 1
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_retrieve_rejects_cross_org_venture():
    suffix_a = uuid.uuid4().hex[:8]
    suffix_b = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_a_slug, user_a_email, venture_a_id, _ = await _seed_org_user_venture(
            session, suffix_a
        )
    async with async_session() as session:
        org_b_slug, user_b_email, _, _ = await _seed_org_user_venture(session, suffix_b)

    try:
        transport = ASGITransport(app=app)
        headers_b = {"X-Dev-User-Email": user_b_email, "X-Dev-Organization-Slug": org_b_slug}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                f"/api/ventures/{venture_a_id}/retrieve",
                json={"query": "anything", "limit": 10},
                headers=headers_b,
            )
        assert response.status_code == 404
    finally:
        async with async_session() as session:
            await _cleanup(session, org_a_slug, user_a_email)
        async with async_session() as session:
            await _cleanup(session, org_b_slug, user_b_email)
