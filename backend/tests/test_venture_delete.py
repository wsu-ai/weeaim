"""Permanent venture deletion: everything a venture owns is erased.

Builds a venture with answers + history, research runs, an idea version, a
processed document (file + search vectors) and an evidence item, then
deletes it. Test database; fake AI/embedding providers; temp file storage.
"""

import tempfile
import uuid
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, select

from app.ai.embedding_provider import FakeEmbeddingProvider
from app.ai.fake import FakeAIProvider
from app.db import async_session
from app.dependencies import get_ai_provider, get_embedding_provider, get_storage_adapter
from app.main import app
from app.models import (
    AIRun,
    AuditLog,
    Document,
    DocumentChunk,
    EvidenceItem,
    IdeaVersion,
    Organization,
    OrganizationMember,
    User,
    Venture,
    VentureMember,
    WizardResponse,
    WizardResponseRevision,
)
from app.storage.local import LocalFilesystemStorageAdapter
from app.tenancy import set_current_organization

IDEA = "An AI-powered cooking assistant for Korean recipes targeting U.S. households."
PITCH_TEXT = (
    b"Our pitch. Busy U.S. households want to cook Korean food at home but find "
    b"recipes intimidating. We guide them step by step with an AI assistant.\n" * 20
)
CHILD_MODELS = (
    WizardResponse,
    WizardResponseRevision,
    AIRun,
    IdeaVersion,
    Document,
    DocumentChunk,
    EvidenceItem,
    VentureMember,
)


@pytest.fixture
def storage_dir():
    with tempfile.TemporaryDirectory() as tmp:
        adapter = LocalFilesystemStorageAdapter(base_dir=tmp)
        app.dependency_overrides[get_storage_adapter] = lambda: adapter
        app.dependency_overrides[get_ai_provider] = lambda: FakeAIProvider()
        app.dependency_overrides[get_embedding_provider] = lambda: FakeEmbeddingProvider()
        yield Path(tmp)
        for dep in (get_storage_adapter, get_ai_provider, get_embedding_provider):
            app.dependency_overrides.pop(dep, None)


class Org:
    def __init__(self, slug: str, org_id: uuid.UUID) -> None:
        self.slug = slug
        self.id = org_id
        self.emails: list[str] = []

    def headers(self, email: str) -> dict:
        return {"X-Dev-User-Email": email, "X-Dev-Organization-Slug": self.slug}


class World:
    def __init__(self) -> None:
        self.orgs: list[Org] = []

    async def org(self) -> Org:
        suffix = uuid.uuid4().hex[:8]
        async with async_session() as session:
            org = Organization(name=f"Org {suffix}", slug=f"del-{suffix}")
            session.add(org)
            await session.commit()
            created = Org(org.slug, org.id)
        self.orgs.append(created)
        return created

    async def user(self, org: Org, role: str) -> str:
        email = f"{role}-{uuid.uuid4().hex[:8]}@delete.test"
        async with async_session() as session:
            user = User(email=email, display_name=role)
            session.add(user)
            await session.flush()
            session.add(OrganizationMember(organization_id=org.id, user_id=user.id, role=role))
            await session.commit()
        org.emails.append(email)
        return email

    async def cleanup(self) -> None:
        for org in self.orgs:
            async with async_session() as session:
                await set_current_organization(session, org.id)
                ventures = select(Venture.id).where(Venture.organization_id == org.id)
                for model in (DocumentChunk, Document, EvidenceItem, WizardResponseRevision,
                              WizardResponse, IdeaVersion, VentureMember, AIRun):
                    await session.execute(delete(model).where(model.venture_id.in_(ventures)))
                await session.execute(delete(Venture).where(Venture.organization_id == org.id))
                await session.execute(
                    delete(OrganizationMember).where(OrganizationMember.organization_id == org.id)
                )
                await session.execute(delete(User).where(User.email.in_(org.emails)))
                await session.execute(delete(Organization).where(Organization.id == org.id))
                await session.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def world():
    w = World()
    yield w
    await w.cleanup()


def client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def build_full_venture(c: AsyncClient, org: Org, email: str) -> uuid.UUID:
    h = org.headers(email)
    venture_id = (await c.post("/api/ventures", json={"idea": IDEA}, headers=h)).json()["id"]
    base = f"/api/ventures/{venture_id}"
    await c.post(
        f"{base}/confirm-idea",
        json={"title": "Korean Recipes", "summary": IDEA, "confidence": 0.8},
        headers=h,
    )
    await c.post(f"{base}/stages/idea_discovery/research", json={}, headers=h)
    for plan in ("First plan", "Second plan"):  # second save creates a revision
        await c.put(
            f"{base}/stages/idea_discovery",
            json={"answers": {"idea_statement": IDEA, "differentiation_plan": plan}},
            headers=h,
        )
    document = await c.post(
        f"{base}/documents",
        headers=h,
        files={"file": ("pitch.txt", PITCH_TEXT, "text/plain")},
    )
    await c.post(f"{base}/documents/{document.json()['id']}/process", headers=h)

    async with async_session() as session:
        await set_current_organization(session, org.id)
        session.add(
            EvidenceItem(
                venture_id=uuid.UUID(venture_id),
                evidence_type="web",
                extracted_statement="Households want quick recipes.",
                supports_or_contradicts="supports",
            )
        )
        await session.commit()
    return uuid.UUID(venture_id)


async def child_counts(org: Org, venture_id: uuid.UUID) -> dict[str, int]:
    async with async_session() as session:
        await set_current_organization(session, org.id)
        counts = {}
        for model in CHILD_MODELS:
            counts[model.__tablename__] = (
                await session.execute(
                    select(func.count()).select_from(model).where(model.venture_id == venture_id)
                )
            ).scalar_one()
        counts["ventures"] = (
            await session.execute(select(func.count()).select_from(Venture).where(Venture.id == venture_id))
        ).scalar_one()
        return counts


@pytest.mark.asyncio
async def test_creator_permanently_deletes_venture_and_everything_it_owns(world, storage_dir):
    org = await world.org()
    member = await world.user(org, "member")
    async with client() as c:
        venture_id = await build_full_venture(c, org, member)

        before = await child_counts(org, venture_id)
        # Sanity: the venture really owned data of every kind (members aside).
        assert all(n > 0 for table, n in before.items() if table != "venture_members"), before
        assert any(storage_dir.rglob("*.txt"))

        response = await c.delete(f"/api/ventures/{venture_id}", headers=org.headers(member))
        assert response.status_code == 204

        assert all(n == 0 for n in (await child_counts(org, venture_id)).values())
        assert not any(storage_dir.rglob("*.txt"))  # stored file removed
        assert (
            await c.get(
                f"/api/ventures/{venture_id}/stages/idea_discovery/research/history",
                headers=org.headers(member),
            )
        ).status_code == 404

    async with async_session() as session:
        await set_current_organization(session, org.id)
        audit = (
            await session.execute(
                select(AuditLog).where(
                    AuditLog.action == "venture.delete", AuditLog.resource_id == venture_id
                )
            )
        ).scalar_one()
    assert audit.log_metadata["title"] == "Korean Recipes"


@pytest.mark.asyncio
async def test_org_admin_can_delete_a_members_venture(world, storage_dir):
    org = await world.org()
    member = await world.user(org, "member")
    admin = await world.user(org, "admin")
    async with client() as c:
        venture_id = (await c.post("/api/ventures", json={"idea": IDEA}, headers=org.headers(member))).json()["id"]
        response = await c.delete(f"/api/ventures/{venture_id}", headers=org.headers(admin))
    assert response.status_code == 204


@pytest.mark.asyncio
async def test_other_members_cannot_delete_and_nothing_is_lost(world, storage_dir):
    org = await world.org()
    creator = await world.user(org, "member")
    other_member = await world.user(org, "member")
    async with client() as c:
        venture_id = await build_full_venture(c, org, creator)
        before = await child_counts(org, venture_id)

        response = await c.delete(f"/api/ventures/{venture_id}", headers=org.headers(other_member))
        assert response.status_code == 403
        assert await child_counts(org, venture_id) == before
        assert any(storage_dir.rglob("*.txt"))


@pytest.mark.asyncio
async def test_other_organizations_and_signed_out_users_cannot_delete(world, storage_dir):
    org_a = await world.org()
    org_b = await world.org()
    owner_a = await world.user(org_a, "owner")
    owner_b = await world.user(org_b, "owner")
    async with client() as c:
        venture_a = (await c.post("/api/ventures", json={"idea": IDEA}, headers=org_a.headers(owner_a))).json()["id"]
        venture_b = (await c.post("/api/ventures", json={"idea": IDEA}, headers=org_b.headers(owner_b))).json()["id"]

        cross = await c.delete(f"/api/ventures/{venture_a}", headers=org_b.headers(owner_b))
        signed_out = await c.delete(f"/api/ventures/{venture_a}")
        assert cross.status_code == 404
        assert signed_out.status_code == 401

        # Deleting in org B leaves org A untouched.
        assert (await c.delete(f"/api/ventures/{venture_b}", headers=org_b.headers(owner_b))).status_code == 204
        assert (await c.get(f"/api/ventures/{venture_a}", headers=org_a.headers(owner_a))).status_code == 200


@pytest.mark.asyncio
async def test_venture_list_says_who_can_delete(world, storage_dir):
    org = await world.org()
    creator = await world.user(org, "member")
    other_member = await world.user(org, "member")
    admin = await world.user(org, "admin")
    async with client() as c:
        venture_id = (await c.post("/api/ventures", json={"idea": IDEA}, headers=org.headers(creator))).json()["id"]

        async def can_delete(email: str) -> bool:
            listing = (await c.get("/api/ventures", headers=org.headers(email))).json()
            return next(v for v in listing if v["id"] == venture_id)["can_delete"]

        assert await can_delete(creator) is True
        assert await can_delete(admin) is True
        assert await can_delete(other_member) is False
