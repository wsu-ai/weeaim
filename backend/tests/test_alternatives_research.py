"""Stage 4 (Existing Alternatives): unlocked by stages 1-3, then AI web research.

No live AI or web calls: a recording fake provider, and the OpenAI provider is
exercised against a stand-in client.
"""

from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.ai.fake import FakeAIProvider
from app.ai.openai_provider import OpenAIProvider
from app.ai.schemas import AlternativesResearch, AlternativesResearchResult
from app.db import async_session
from app.dependencies import get_ai_provider
from app.main import app
from app.models import AIRun, Organization
from app.tenancy import set_current_organization
from tests.test_idea_research import Tenants, client, headers

PROBLEM = {
    "problem_statement": "Families struggle to cook Korean food at home.",
    "evidence_for_problem": "Interviews with 12 households.",
    "who_experiences_it": "Busy U.S. parents.",
    "frequency_severity": "Weekly, moderate frustration.",
}
CUSTOMER = {
    "primary_customer_segment": "Dual-income U.S. families",
    "customer_characteristics": "Curious about Korean cuisine, short on time.",
    "buying_trigger": "Wanting healthier weeknight dinners.",
}
IDEA = {"idea_statement": "AI Korean cooking coach", "differentiation_plan": "Beginner-friendly"}


class RecordingProvider(FakeAIProvider):
    def __init__(self) -> None:
        self.alternative_calls: list[tuple[str, str]] = []

    async def research_alternatives(self, venture_context: str, language: str):
        self.alternative_calls.append((venture_context, language))
        return await super().research_alternatives(venture_context, language)


@pytest.fixture
def provider():
    fake = RecordingProvider()
    app.dependency_overrides[get_ai_provider] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_ai_provider, None)


@pytest_asyncio.fixture(loop_scope="session")
async def tenants():
    t = Tenants()
    yield t
    await t.cleanup()


async def complete(c, venture_id, h, slug: str, answers: dict) -> None:
    response = await c.put(
        f"/api/ventures/{venture_id}/stages/{slug}",
        json={"answers": answers, "complete": True},
        headers=h,
    )
    assert response.status_code == 200, response.text


async def complete_stages_1_to_3(c, venture_id, h) -> None:
    await complete(c, venture_id, h, "idea_discovery", IDEA)
    await complete(c, venture_id, h, "problem_definition", PROBLEM)
    await complete(c, venture_id, h, "customer_definition", CUSTOMER)


async def stage(c, venture_id, h, slug: str) -> dict:
    stages = (await c.get(f"/api/ventures/{venture_id}/stages", headers=h)).json()
    return next(s for s in stages if s["slug"] == slug)


def research_url(venture_id) -> str:
    return f"/api/ventures/{venture_id}/stages/existing_alternatives/research"


# --- Locking -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_stage_four_is_locked_until_stages_one_to_three_are_complete(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        assert (await stage(c, venture_id, h, "existing_alternatives"))["locked"] is True

        # Writes are refused while locked.
        put = await c.put(
            f"/api/ventures/{venture_id}/stages/existing_alternatives",
            json={"answers": {"current_solutions": "x"}},
            headers=h,
        )
        research = await c.post(research_url(venture_id), json={}, headers=h)
        assert put.status_code == 409
        assert research.status_code == 409
        assert provider.alternative_calls == []

        # Two of three done: still locked, and it says which one is missing.
        await complete(c, venture_id, h, "idea_discovery", IDEA)
        await complete(c, venture_id, h, "problem_definition", PROBLEM)
        partial = await stage(c, venture_id, h, "existing_alternatives")
        assert partial["locked"] is True
        assert partial["locked_by"] == ["customer_definition"]

        await complete(c, venture_id, h, "customer_definition", CUSTOMER)
        unlocked = await stage(c, venture_id, h, "existing_alternatives")
        assert unlocked["locked"] is False and unlocked["locked_by"] == []


@pytest.mark.asyncio
async def test_editing_an_earlier_stage_relocks_but_keeps_the_research(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await complete_stages_1_to_3(c, venture_id, h)
        assert (await c.post(research_url(venture_id), json={}, headers=h)).status_code == 200

        # Saving Stage 2 without completing it takes it out of "completed".
        await c.put(
            f"/api/ventures/{venture_id}/stages/problem_definition",
            json={"answers": PROBLEM},
            headers=h,
        )
        relocked = await stage(c, venture_id, h, "existing_alternatives")
        assert relocked["locked"] is True
        # Editing a completed stage also flags later completed stages for
        # review, so Stage 3 needs re-completing too.
        assert relocked["locked_by"] == ["problem_definition", "customer_definition"]
        assert relocked["ai_analysis"]["kind"] == "alternatives_research"  # kept

        await complete(c, venture_id, h, "problem_definition", PROBLEM)
        await complete(c, venture_id, h, "customer_definition", CUSTOMER)
        assert (await stage(c, venture_id, h, "existing_alternatives"))["locked"] is False


# --- Research ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_research_uses_stages_one_to_three_and_stores_checked_results(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await complete_stages_1_to_3(c, venture_id, h)
        response = await c.post(research_url(venture_id), json={"language": "ko"}, headers=h)
        assert response.status_code == 200
        body = response.json()
        saved = await stage(c, venture_id, h, "existing_alternatives")

    context, language = provider.alternative_calls[0]
    assert language == "ko"
    for text in (IDEA["idea_statement"], PROBLEM["problem_statement"], CUSTOMER["buying_trigger"]):
        assert text in context

    assert body["kind"] == "alternatives_research"
    assert body["language"] == "ko" and body["researched_at"] and body["based_on"]
    competitor, workaround = body["alternatives"]
    assert competitor["category"] == "direct_competitor"
    assert competitor["url"] == "https://example.com/product"  # site the search consulted
    assert workaround["category"] == "workaround" and workaround["url"] is None
    assert all(a["search_url"].startswith("https://www.google.com/search?q=") for a in body["alternatives"])
    assert body["unmet_needs"] == ["Nothing handles X well."]
    assert body["sources"] == [{"title": "Example", "url": "https://example.com/article"}]

    assert saved["status"] == "awaiting_user"
    assert saved["ai_analysis"] == body
    assert saved["answers"] == {"current_solutions": "", "why_switch": "", "biggest_threat": ""}


@pytest.mark.asyncio
async def test_alternatives_history_and_stage_one_history_are_separate(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await c.post(f"/api/ventures/{venture_id}/stages/idea_discovery/research", json={}, headers=h)
        await complete_stages_1_to_3(c, venture_id, h)
        for language in ("en", "ko"):
            await c.post(research_url(venture_id), json={"language": language}, headers=h)

        alternatives = (
            await c.get(f"{research_url(venture_id)}/history", headers=h)
        ).json()
        idea = (
            await c.get(
                f"/api/ventures/{venture_id}/stages/idea_discovery/research/history", headers=h
            )
        ).json()
        no_research = await c.post(
            f"/api/ventures/{venture_id}/stages/problem_definition/research", json={}, headers=h
        )

    assert [r["research"]["language"] for r in alternatives] == ["ko", "en"]
    assert all(r["research"]["kind"] == "alternatives_research" for r in alternatives)
    assert [r["research"]["kind"] for r in idea] == ["idea_research"]
    assert no_research.status_code == 404


@pytest.mark.asyncio
async def test_generic_feedback_is_blocked_on_stage_four(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await complete_stages_1_to_3(c, venture_id, h)
        response = await c.post(
            f"/api/ventures/{venture_id}/stages/existing_alternatives/analyze", headers=h
        )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_stage_four_answers_are_validated_once_unlocked(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await complete_stages_1_to_3(c, venture_id, h)
        bad = await c.put(
            f"/api/ventures/{venture_id}/stages/existing_alternatives",
            json={"answers": {"why_switch": "no current_solutions"}},
            headers=h,
        )
        good = await c.put(
            f"/api/ventures/{venture_id}/stages/existing_alternatives",
            json={"answers": {"current_solutions": "Recipe blogs", "why_switch": "", "biggest_threat": ""}},
            headers=h,
        )
    assert bad.status_code == 422
    assert good.status_code == 200


@pytest.mark.asyncio
async def test_research_is_tenant_isolated_requires_sign_in_and_logs_failures(tenants):
    org_a, email_a, venture_a = await tenants.make()
    org_b, email_b, _ = await tenants.make()

    class FailingProvider(FakeAIProvider):
        async def research_alternatives(self, venture_context: str, language: str):
            raise ValueError("Model did not return a parsed AlternativesResearch")

    app.dependency_overrides[get_ai_provider] = lambda: FailingProvider()
    try:
        async with client() as c:
            await complete_stages_1_to_3(c, venture_a, headers(org_a, email_a))
            other_org = await c.post(research_url(venture_a), json={}, headers=headers(org_b, email_b))
            signed_out = await c.post(research_url(venture_a), json={})
            failed = await c.post(research_url(venture_a), json={}, headers=headers(org_a, email_a))
    finally:
        app.dependency_overrides.pop(get_ai_provider, None)

    assert other_org.status_code == 404
    assert signed_out.status_code == 401
    assert failed.status_code == 503
    async with async_session() as session:
        org = (await session.execute(select(Organization).where(Organization.slug == org_a))).scalar_one()
        await set_current_organization(session, org.id)
        runs = (
            await session.execute(select(AIRun).where(AIRun.venture_id == venture_a))
        ).scalars().all()
    assert [(r.operation, r.status) for r in runs] == [("alternatives_research", "failed")]


# --- OpenAI provider (no network) -------------------------------------------


@pytest.mark.asyncio
async def test_openai_provider_researches_alternatives_with_web_search():
    research = AlternativesResearch(
        summary="s",
        alternatives=[],
        switching_barriers=[],
        unmet_needs=[],
        positioning_recommendations=[],
        suggested_next_steps=[],
        confidence=0.4,
    )
    captured: dict = {}

    class FakeResponses:
        async def parse(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                output_parsed=research,
                output=[
                    SimpleNamespace(
                        type="web_search_call",
                        action=SimpleNamespace(url=None, sources=[SimpleNamespace(url="https://a.com")]),
                    )
                ],
            )

    provider = OpenAIProvider(api_key="test", model="test-model")
    provider._client = SimpleNamespace(responses=FakeResponses())

    result = await provider.research_alternatives("Stage 2 - Problem definition answers: {}", "en")

    assert isinstance(result, AlternativesResearchResult)
    assert result.consulted_urls == ["https://a.com"]
    assert captured["tools"] == [{"type": "web_search", "search_context_size": "medium"}]
    assert captured["include"] == ["web_search_call.action.sources"]
    assert captured["text_format"] is AlternativesResearch
    assert "workarounds" in captured["instructions"] and "untrusted" in captured["instructions"]
    assert "stages 1-3" in captured["input"]
