import uuid
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app import config
from app.ai.embedding_provider import FakeEmbeddingProvider
from app.db import async_session
from app.dependencies import get_embedding_provider, get_storage_adapter
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
from app.storage.local import LocalFilesystemStorageAdapter
from app.tenancy import set_current_organization

IDEA_TEXT = "An AI-powered cooking assistant for Korean recipes targeting U.S. households."
FAKE_PDF = b"%PDF-1.4\n%fake pdf content for tests\n%%EOF"


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


@pytest.fixture
def temp_storage_dir():
    with TemporaryDirectory() as tmp:
        adapter = LocalFilesystemStorageAdapter(base_dir=tmp)
        app.dependency_overrides[get_storage_adapter] = lambda: adapter
        yield Path(tmp)
        app.dependency_overrides.pop(get_storage_adapter, None)


class _CountingFakeEmbeddingProvider(FakeEmbeddingProvider):
    def __init__(self, dimensions: int = 1024) -> None:
        super().__init__(dimensions=dimensions)
        self.call_count = 0

    async def embed(self, texts: list[str]) -> list[list[float]]:
        self.call_count += 1
        return await super().embed(texts)


@pytest.fixture
def fake_embedder():
    provider = _CountingFakeEmbeddingProvider(dimensions=1024)
    app.dependency_overrides[get_embedding_provider] = lambda: provider
    yield provider
    app.dependency_overrides.pop(get_embedding_provider, None)


@pytest.mark.asyncio
async def test_upload_valid_pdf_succeeds(temp_storage_dir):
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                f"/api/ventures/{venture_id}/documents",
                headers={"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug},
                files={"file": ("pitch.pdf", FAKE_PDF, "application/pdf")},
            )
        assert response.status_code == 201
        body = response.json()
        assert body["original_filename"] == "pitch.pdf"
        assert body["processing_status"] == "uploaded"

        saved_files = list(temp_storage_dir.rglob("*.pdf"))
        assert len(saved_files) == 1
        assert saved_files[0].name != "pitch.pdf"
        assert saved_files[0].read_bytes() == FAKE_PDF
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_upload_rejects_disallowed_extension(temp_storage_dir):
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                f"/api/ventures/{venture_id}/documents",
                headers={"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug},
                files={"file": ("malware.exe", b"MZfake", "application/octet-stream")},
            )
        assert response.status_code == 415
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_upload_rejects_oversized_file(temp_storage_dir, monkeypatch):
    monkeypatch.setattr(config.settings, "max_upload_size_bytes", 10)
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                f"/api/ventures/{venture_id}/documents",
                headers={"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug},
                files={"file": ("pitch.pdf", FAKE_PDF, "application/pdf")},
            )
        assert response.status_code == 413
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_upload_rejects_missing_auth(temp_storage_dir):
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                f"/api/ventures/{venture_id}/documents",
                files={"file": ("pitch.pdf", FAKE_PDF, "application/pdf")},
            )
        assert response.status_code == 401
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_upload_rejects_cross_org_venture(temp_storage_dir):
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
                f"/api/ventures/{venture_a_id}/documents",
                headers={"X-Dev-User-Email": user_b_email, "X-Dev-Organization-Slug": org_b_slug},
                files={"file": ("pitch.pdf", FAKE_PDF, "application/pdf")},
            )
        assert response.status_code == 404
    finally:
        async with async_session() as session:
            await _cleanup(session, org_a_slug, user_a_email)
        async with async_session() as session:
            await _cleanup(session, org_b_slug, user_b_email)


@pytest.mark.asyncio
async def test_delete_document_removes_file_and_excludes_from_list(temp_storage_dir):
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    try:
        transport = ASGITransport(app=app)
        headers = {"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            upload_response = await client.post(
                f"/api/ventures/{venture_id}/documents",
                headers=headers,
                files={"file": ("pitch.pdf", FAKE_PDF, "application/pdf")},
            )
            document_id = upload_response.json()["id"]

            list_response = await client.get(f"/api/ventures/{venture_id}/documents", headers=headers)
            assert len(list_response.json()) == 1

            delete_response = await client.delete(
                f"/api/ventures/{venture_id}/documents/{document_id}", headers=headers
            )
            assert delete_response.status_code == 204

            list_after_delete = await client.get(
                f"/api/ventures/{venture_id}/documents", headers=headers
            )
        assert list_after_delete.json() == []
        assert list(temp_storage_dir.rglob("*.pdf")) == []
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_process_document_creates_chunks_and_is_idempotent(temp_storage_dir):
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    try:
        transport = ASGITransport(app=app)
        headers = {"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug}
        text_content = b"This document describes a marketplace for local produce."
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            upload_response = await client.post(
                f"/api/ventures/{venture_id}/documents",
                headers=headers,
                files={"file": ("notes.txt", text_content, "text/plain")},
            )
            document_id = upload_response.json()["id"]

            process_response = await client.post(
                f"/api/ventures/{venture_id}/documents/{document_id}/process", headers=headers
            )
            assert process_response.status_code == 200
            body = process_response.json()
            assert body["chunk_count"] == 1
            assert body["document"]["processing_status"] == "processed"

            second_process_response = await client.post(
                f"/api/ventures/{venture_id}/documents/{document_id}/process", headers=headers
            )
            assert second_process_response.json()["chunk_count"] == 1

        async with async_session() as session:
            await set_current_organization(session, (
                await session.execute(select(Organization).where(Organization.slug == org_slug))
            ).scalar_one().id)
            chunks = (
                await session.execute(
                    select(DocumentChunk).where(DocumentChunk.document_id == uuid.UUID(document_id))
                )
            ).scalars().all()
            assert len(chunks) == 1
            assert "marketplace for local produce" in chunks[0].content
            assert chunks[0].chunk_metadata["language"] == "en"
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_process_document_rejects_cross_org_venture(temp_storage_dir):
    suffix_a = uuid.uuid4().hex[:8]
    suffix_b = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_a_slug, user_a_email, venture_a_id = await _seed_org_user_venture(session, suffix_a)
    async with async_session() as session:
        org_b_slug, user_b_email, _ = await _seed_org_user_venture(session, suffix_b)

    try:
        transport = ASGITransport(app=app)
        headers_a = {"X-Dev-User-Email": user_a_email, "X-Dev-Organization-Slug": org_a_slug}
        headers_b = {"X-Dev-User-Email": user_b_email, "X-Dev-Organization-Slug": org_b_slug}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            upload_response = await client.post(
                f"/api/ventures/{venture_a_id}/documents",
                headers=headers_a,
                files={"file": ("notes.txt", b"Some content.", "text/plain")},
            )
            document_id = upload_response.json()["id"]

            response = await client.post(
                f"/api/ventures/{venture_a_id}/documents/{document_id}/process",
                headers=headers_b,
            )
        assert response.status_code == 404
    finally:
        async with async_session() as session:
            await _cleanup(session, org_a_slug, user_a_email)
        async with async_session() as session:
            await _cleanup(session, org_b_slug, user_b_email)


@pytest.mark.asyncio
async def test_embed_document_is_idempotent(temp_storage_dir, fake_embedder):
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    try:
        transport = ASGITransport(app=app)
        headers = {"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            upload_response = await client.post(
                f"/api/ventures/{venture_id}/documents",
                headers=headers,
                files={"file": ("notes.txt", b"Some content about a marketplace.", "text/plain")},
            )
            document_id = upload_response.json()["id"]

            await client.post(
                f"/api/ventures/{venture_id}/documents/{document_id}/process", headers=headers
            )

            embed_response = await client.post(
                f"/api/ventures/{venture_id}/documents/{document_id}/embed", headers=headers
            )
            assert embed_response.json() == {"embedded_count": 1}
            assert fake_embedder.call_count == 1

            second_embed_response = await client.post(
                f"/api/ventures/{venture_id}/documents/{document_id}/embed", headers=headers
            )
            assert second_embed_response.json() == {"embedded_count": 0}
            assert fake_embedder.call_count == 1  # not called again -- nothing to embed

        async with async_session() as session:
            org = (
                await session.execute(select(Organization).where(Organization.slug == org_slug))
            ).scalar_one()
            await set_current_organization(session, org.id)
            chunk = (
                await session.execute(
                    select(DocumentChunk).where(
                        DocumentChunk.document_id == uuid.UUID(document_id)
                    )
                )
            ).scalar_one()
            assert chunk.embedding is not None
            assert len(chunk.embedding) == 1024
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_embed_document_rejects_cross_org_venture(temp_storage_dir, fake_embedder):
    suffix_a = uuid.uuid4().hex[:8]
    suffix_b = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_a_slug, user_a_email, venture_a_id = await _seed_org_user_venture(session, suffix_a)
    async with async_session() as session:
        org_b_slug, user_b_email, _ = await _seed_org_user_venture(session, suffix_b)

    try:
        transport = ASGITransport(app=app)
        headers_a = {"X-Dev-User-Email": user_a_email, "X-Dev-Organization-Slug": org_a_slug}
        headers_b = {"X-Dev-User-Email": user_b_email, "X-Dev-Organization-Slug": org_b_slug}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            upload_response = await client.post(
                f"/api/ventures/{venture_a_id}/documents",
                headers=headers_a,
                files={"file": ("notes.txt", b"Some content.", "text/plain")},
            )
            document_id = upload_response.json()["id"]

            response = await client.post(
                f"/api/ventures/{venture_a_id}/documents/{document_id}/embed",
                headers=headers_b,
            )
        assert response.status_code == 404
    finally:
        async with async_session() as session:
            await _cleanup(session, org_a_slug, user_a_email)
        async with async_session() as session:
            await _cleanup(session, org_b_slug, user_b_email)
