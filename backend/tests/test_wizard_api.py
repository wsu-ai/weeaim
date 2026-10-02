import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app.ai.fake import FakeAIProvider
from app.db import async_session
from app.dependencies import get_ai_provider
from app.main import app
from app.models import (
    Organization,
    OrganizationMember,
    User,
    Venture,
    WizardResponse,
    WizardResponseRevision,
)
from app.tenancy import set_current_organization

IDEA_TEXT = "An AI-powered cooking assistant for Korean recipes targeting U.S. households."

VALID_PROBLEM_ANSWERS = {
    "problem_statement": "Finding authentic Korean recipes is hard for U.S. households.",
    "evidence_for_problem": "Forum posts and survey responses.",
    "who_experiences_it": "Home cooks interested in Korean cuisine.",
    "frequency_severity": "Weekly, moderate frustration.",
}

VALID_VALUE_PROP_ANSWERS = {
    "value_proposition_statement": "An AI assistant that guides you through authentic Korean cooking.",
    "key_benefits": ["Authenticity", "Guided steps"],
    "differentiation": "Focused specifically on Korean cuisine, unlike general cooking apps.",
}


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
        # No AuditLog delete: immutable to the app; ON DELETE SET NULL on its
        # organization FK means it won't block this cleanup.
        await session.execute(WizardResponseRevision.__table__.delete())
        await session.execute(WizardResponse.__table__.delete())
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
async def test_list_stages_returns_eleven_stages_not_started():
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(
                f"/api/ventures/{venture_id}/stages",
                headers={"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug},
            )
        assert response.status_code == 200
        stages = response.json()
        assert len(stages) == 11
        assert all(s["status"] == "not_started" for s in stages)
        implemented = {s["slug"] for s in stages if s["implemented"]}
        # Stage 1 (idea_discovery) became workable with AI idea research.
        assert implemented == {
            "idea_discovery",
            "problem_definition",
            "customer_definition",
            "existing_alternatives",
            "value_proposition",
        }
        # Stage 4 is locked until stages 1-3 are completed.
        alternatives = next(s for s in stages if s["slug"] == "existing_alternatives")
        assert alternatives["locked"] is True
        assert alternatives["locked_by"] == [
            "idea_discovery",
            "problem_definition",
            "customer_definition",
        ]
        assert not any(s["locked"] for s in stages if s["slug"] != "existing_alternatives")
        idea_stage = next(s for s in stages if s["slug"] == "idea_discovery")
        assert [f["name"] for f in idea_stage["question_schema"]["fields"]] == [
            "idea_statement",
            "differentiation_plan",
        ]
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_update_stage_persists_and_completes():
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    try:
        transport = ASGITransport(app=app)
        headers = {"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.put(
                f"/api/ventures/{venture_id}/stages/problem_definition",
                json={"answers": VALID_PROBLEM_ANSWERS, "complete": False},
                headers=headers,
            )
            assert response.status_code == 200
            assert response.json()["status"] == "in_progress"

            response = await client.put(
                f"/api/ventures/{venture_id}/stages/problem_definition",
                json={"answers": VALID_PROBLEM_ANSWERS, "complete": True},
                headers=headers,
            )
            assert response.status_code == 200
            assert response.json()["status"] == "completed"
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_update_stage_rejects_unimplemented_slug():
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.put(
                f"/api/ventures/{venture_id}/stages/market_evidence",
                json={"answers": {}, "complete": False},
                headers={"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug},
            )
        assert response.status_code == 404
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_update_stage_rejects_invalid_answers():
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.put(
                f"/api/ventures/{venture_id}/stages/problem_definition",
                json={"answers": {"problem_statement": "only one field"}, "complete": False},
                headers={"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug},
            )
        assert response.status_code == 422
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_editing_completed_stage_cascades_needs_revision_to_later_stage():
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    try:
        transport = ASGITransport(app=app)
        headers = {"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.put(
                f"/api/ventures/{venture_id}/stages/problem_definition",
                json={"answers": VALID_PROBLEM_ANSWERS, "complete": True},
                headers=headers,
            )
            await client.put(
                f"/api/ventures/{venture_id}/stages/value_proposition",
                json={"answers": VALID_VALUE_PROP_ANSWERS, "complete": True},
                headers=headers,
            )

            # Re-edit the earlier, already-completed stage.
            await client.put(
                f"/api/ventures/{venture_id}/stages/problem_definition",
                json={"answers": VALID_PROBLEM_ANSWERS, "complete": False},
                headers=headers,
            )

            response = await client.get(f"/api/ventures/{venture_id}/stages", headers=headers)
        stages_by_slug = {s["slug"]: s for s in response.json()}
        assert stages_by_slug["value_proposition"]["status"] == "needs_revision"
        assert stages_by_slug["problem_definition"]["status"] == "in_progress"
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_analyze_requires_existing_answers_then_returns_analysis():
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    try:
        transport = ASGITransport(app=app)
        headers = {"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            no_answers_response = await client.post(
                f"/api/ventures/{venture_id}/stages/problem_definition/analyze",
                headers=headers,
            )
            assert no_answers_response.status_code == 400

            await client.put(
                f"/api/ventures/{venture_id}/stages/problem_definition",
                json={"answers": VALID_PROBLEM_ANSWERS, "complete": False},
                headers=headers,
            )
            analyze_response = await client.post(
                f"/api/ventures/{venture_id}/stages/problem_definition/analyze",
                headers=headers,
            )
            assert analyze_response.status_code == 200
            body = analyze_response.json()
            assert body["summary"]

            stages_response = await client.get(
                f"/api/ventures/{venture_id}/stages", headers=headers
            )
        stages_by_slug = {s["slug"]: s for s in stages_response.json()}
        assert stages_by_slug["problem_definition"]["status"] == "awaiting_user"
        assert stages_by_slug["problem_definition"]["ai_analysis"] is not None
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_stages_reject_cross_org_venture():
    suffix_a = uuid.uuid4().hex[:8]
    suffix_b = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_a_slug, user_a_email, venture_a_id = await _seed_org_user_venture(session, suffix_a)
    async with async_session() as session:
        org_b_slug, user_b_email, _ = await _seed_org_user_venture(session, suffix_b)

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(
                f"/api/ventures/{venture_a_id}/stages",
                headers={"X-Dev-User-Email": user_b_email, "X-Dev-Organization-Slug": org_b_slug},
            )
        assert response.status_code == 404
    finally:
        async with async_session() as session:
            await _cleanup(session, org_a_slug, user_a_email)
        async with async_session() as session:
            await _cleanup(session, org_b_slug, user_b_email)


@pytest.mark.asyncio
async def test_first_save_creates_no_revision_second_save_snapshots_original():
    suffix = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_slug, user_email, venture_id = await _seed_org_user_venture(session, suffix)

    try:
        transport = ASGITransport(app=app)
        headers = {"X-Dev-User-Email": user_email, "X-Dev-Organization-Slug": org_slug}
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.put(
                f"/api/ventures/{venture_id}/stages/problem_definition",
                json={"answers": VALID_PROBLEM_ANSWERS, "complete": False},
                headers=headers,
            )
            revisions_after_first_save = await client.get(
                f"/api/ventures/{venture_id}/stages/problem_definition/revisions",
                headers=headers,
            )
            assert revisions_after_first_save.json() == []

            updated_answers = {
                **VALID_PROBLEM_ANSWERS,
                "problem_statement": "A revised problem statement.",
            }
            await client.put(
                f"/api/ventures/{venture_id}/stages/problem_definition",
                json={"answers": updated_answers, "complete": False},
                headers=headers,
            )
            revisions_after_second_save = await client.get(
                f"/api/ventures/{venture_id}/stages/problem_definition/revisions",
                headers=headers,
            )
        revisions = revisions_after_second_save.json()
        assert len(revisions) == 1
        assert revisions[0]["version_number"] == 1
        assert revisions[0]["answers"]["problem_statement"] == VALID_PROBLEM_ANSWERS["problem_statement"]
    finally:
        async with async_session() as session:
            await _cleanup(session, org_slug, user_email)


@pytest.mark.asyncio
async def test_stage_revisions_reject_cross_org_venture():
    suffix_a = uuid.uuid4().hex[:8]
    suffix_b = uuid.uuid4().hex[:8]
    async with async_session() as session:
        org_a_slug, user_a_email, venture_a_id = await _seed_org_user_venture(session, suffix_a)
    async with async_session() as session:
        org_b_slug, user_b_email, _ = await _seed_org_user_venture(session, suffix_b)

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(
                f"/api/ventures/{venture_a_id}/stages/problem_definition/revisions",
                headers={"X-Dev-User-Email": user_b_email, "X-Dev-Organization-Slug": org_b_slug},
            )
        assert response.status_code == 404
    finally:
        async with async_session() as session:
            await _cleanup(session, org_a_slug, user_a_email)
        async with async_session() as session:
            await _cleanup(session, org_b_slug, user_b_email)
