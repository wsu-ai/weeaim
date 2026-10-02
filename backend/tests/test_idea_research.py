"""Stage 1 (Idea Discovery): AI web research on the venture idea.

No live AI or web calls: the provider is a fake, and the OpenAI provider is
tested against a stand-in client.
"""

import uuid
from types import SimpleNamespace

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from openai import APIConnectionError
from sqlalchemy import delete, select

from app.ai.fake import FakeAIProvider
from app.ai.openai_provider import (
    OpenAIProvider,
    extract_citations,
    extract_consulted_urls,
    web_search_tool,
)
from app.ai.schemas import (
    ExistingSolution,
    FactorAssessment,
    FeasibilityFactors,
    IdeaResearch,
    IdeaResearchResult,
    ResearchSource,
)
from app.db import async_session
from app.dependencies import get_ai_provider
from app.main import app
from app.models import (
    AIRun,
    AuditLog,
    Organization,
    OrganizationMember,
    User,
    Venture,
    WizardResponse,
    WizardResponseRevision,
)
from app.tenancy import set_current_organization
from app.wizard.idea_research import feasibility_score, research_payload
from tests.test_wizard_api import IDEA_TEXT, _seed_org_user_venture


class RecordingProvider(FakeAIProvider):
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def research_idea(self, idea_context: str, language: str) -> IdeaResearchResult:
        self.calls.append((idea_context, language))
        return await super().research_idea(idea_context, language)


@pytest.fixture
def provider():
    fake = RecordingProvider()
    app.dependency_overrides[get_ai_provider] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_ai_provider, None)


class Tenants:
    def __init__(self) -> None:
        self.created: list[tuple[str, str]] = []

    async def make(self) -> tuple[str, str, uuid.UUID]:
        async with async_session() as session:
            org_slug, email, venture_id = await _seed_org_user_venture(session, uuid.uuid4().hex[:8])
        self.created.append((org_slug, email))
        return org_slug, email, venture_id

    async def cleanup(self) -> None:
        for org_slug, email in self.created:
            async with async_session() as session:
                org = (
                    await session.execute(select(Organization).where(Organization.slug == org_slug))
                ).scalar_one()
                await set_current_organization(session, org.id)
                await session.execute(delete(AIRun).where(AIRun.organization_id == org.id))
                await session.execute(WizardResponseRevision.__table__.delete())
                await session.execute(WizardResponse.__table__.delete())
                await session.execute(Venture.__table__.delete())
                await session.execute(
                    delete(OrganizationMember).where(OrganizationMember.organization_id == org.id)
                )
                await session.execute(delete(User).where(User.email == email))
                await session.execute(delete(Organization).where(Organization.id == org.id))
                await session.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def tenants():
    t = Tenants()
    yield t
    await t.cleanup()


def headers(org_slug: str, email: str) -> dict:
    return {"X-Dev-User-Email": email, "X-Dev-Organization-Slug": org_slug}


def client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def stage_one(c: AsyncClient, venture_id: uuid.UUID, h: dict) -> dict:
    stages = (await c.get(f"/api/ventures/{venture_id}/stages", headers=h)).json()
    return next(s for s in stages if s["slug"] == "idea_discovery")


async def runs_for(org_slug: str, venture_id: uuid.UUID) -> list[AIRun]:
    async with async_session() as session:
        org = (
            await session.execute(select(Organization).where(Organization.slug == org_slug))
        ).scalar_one()
        await set_current_organization(session, org.id)
        return list(
            (
                await session.execute(
                    select(AIRun).where(AIRun.venture_id == venture_id).order_by(AIRun.created_at)
                )
            ).scalars()
        )


# --- Endpoint ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_research_stores_result_prefills_idea_and_logs_run(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        response = await c.post(
            f"/api/ventures/{venture_id}/stages/idea_discovery/research",
            json={"language": "ko"},
            headers=h,
        )
        assert response.status_code == 200
        body = response.json()
        stage = await stage_one(c, venture_id, h)

    assert body["kind"] == "idea_research"
    assert body["language"] == "ko"
    assert body["market_status"] == "some_similar_offerings"
    assert body["differentiation_opportunities"] == ["Focus on an underserved niche."]
    # favorable, moderate, favorable, moderate, challenging -> (100+60+100+60+20)/5
    assert body["feasibility_score"] == 68
    assert body["feasibility_factors"]["customer_access"] == {
        "rating": "challenging",
        "reason": "Hard to reach.",
    }
    # The fake's competitor site was consulted by the search, so it's linked.
    assert body["existing_solutions"][0]["url"] == "https://example.com/product"
    assert body["existing_solutions"][0]["search_url"].startswith("https://www.google.com/search?q=")
    assert body["sources"] == [{"title": "Example", "url": "https://example.com/article"}]
    assert body["researched_at"]

    assert stage["status"] == "awaiting_user"
    assert stage["ai_analysis"] == body
    assert stage["answers"] == {"idea_statement": IDEA_TEXT, "differentiation_plan": ""}

    idea_context, language = provider.calls[0]
    assert IDEA_TEXT in idea_context and language == "ko"

    runs = await runs_for(org_slug, venture_id)
    assert [(r.operation, r.status) for r in runs] == [("idea_research", "succeeded")]
    assert runs[0].output_payload == body and runs[0].latency_ms is not None

    async with async_session() as session:
        org = (
            await session.execute(select(Organization).where(Organization.slug == org_slug))
        ).scalar_one()
        await set_current_organization(session, org.id)
        actions = (
            await session.execute(
                select(AuditLog.action).where(AuditLog.organization_id == org.id)
            )
        ).scalars().all()
    assert "wizard_stage.research" in actions


@pytest.mark.asyncio
async def test_research_uses_the_saved_idea_statement_and_keeps_history(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        saved = await c.put(
            f"/api/ventures/{venture_id}/stages/idea_discovery",
            json={"answers": {"idea_statement": "A refined idea about meal kits.", "differentiation_plan": ""}},
            headers=h,
        )
        assert saved.status_code == 200
        for _ in range(2):
            assert (
                await c.post(
                    f"/api/ventures/{venture_id}/stages/idea_discovery/research",
                    json={"language": "en"},
                    headers=h,
                )
            ).status_code == 200

    assert all("A refined idea about meal kits." in ctx for ctx, _ in provider.calls)
    assert len(await runs_for(org_slug, venture_id)) == 2  # both runs kept


@pytest.mark.asyncio
async def test_research_keeps_a_completed_stage_completed(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await c.put(
            f"/api/ventures/{venture_id}/stages/idea_discovery",
            json={"answers": {"idea_statement": "Idea", "differentiation_plan": "Niche"}, "complete": True},
            headers=h,
        )
        await c.post(f"/api/ventures/{venture_id}/stages/idea_discovery/research", json={}, headers=h)
        assert (await stage_one(c, venture_id, h))["status"] == "completed"


@pytest.mark.asyncio
async def test_research_is_tenant_isolated_and_requires_sign_in(tenants, provider):
    org_a, email_a, venture_a = await tenants.make()
    org_b, email_b, _ = await tenants.make()
    async with client() as c:
        other_org = await c.post(
            f"/api/ventures/{venture_a}/stages/idea_discovery/research",
            json={"language": "en"},
            headers=headers(org_b, email_b),
        )
        signed_out = await c.post(
            f"/api/ventures/{venture_a}/stages/idea_discovery/research", json={"language": "en"}
        )
        bad_language = await c.post(
            f"/api/ventures/{venture_a}/stages/idea_discovery/research",
            json={"language": "fr"},
            headers=headers(org_a, email_a),
        )
    assert other_org.status_code == 404
    assert signed_out.status_code == 401
    assert bad_language.status_code == 422
    assert provider.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [ValueError("Model did not return a parsed IdeaResearch"), "openai"],
    ids=["unparsed", "openai-error"],
)
async def test_research_failure_is_503_and_logged(tenants, error):
    org_slug, email, venture_id = await tenants.make()
    if error == "openai":
        error = APIConnectionError(request=SimpleNamespace(method="POST", url="https://api.openai.com"))

    class FailingProvider(FakeAIProvider):
        async def research_idea(self, idea_context: str, language: str) -> IdeaResearchResult:
            raise error

    app.dependency_overrides[get_ai_provider] = lambda: FailingProvider()
    try:
        async with client() as c:
            response = await c.post(
                f"/api/ventures/{venture_id}/stages/idea_discovery/research",
                json={"language": "en"},
                headers=headers(org_slug, email),
            )
    finally:
        app.dependency_overrides.pop(get_ai_provider, None)

    assert response.status_code == 503
    runs = await runs_for(org_slug, venture_id)
    assert [r.status for r in runs] == ["failed"]
    assert runs[0].error_message


@pytest.mark.asyncio
async def test_stage_one_answers_are_validated(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    async with client() as c:
        response = await c.put(
            f"/api/ventures/{venture_id}/stages/idea_discovery",
            json={"answers": {"differentiation_plan": "No idea statement"}},
            headers=headers(org_slug, email),
        )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_generic_feedback_cannot_overwrite_stage_one_research(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await c.post(f"/api/ventures/{venture_id}/stages/idea_discovery/research", json={}, headers=h)
        response = await c.post(f"/api/ventures/{venture_id}/stages/idea_discovery/analyze", headers=h)
        assert response.status_code == 400
        assert (await stage_one(c, venture_id, h))["ai_analysis"]["kind"] == "idea_research"


# --- Link safety ----------------------------------------------------------


def _factors(*ratings: str) -> FeasibilityFactors:
    names = (
        "technical_complexity",
        "resources_required",
        "regulatory_barriers",
        "time_to_market",
        "customer_access",
    )
    return FeasibilityFactors(
        **{name: FactorAssessment(rating=rating, reason="r") for name, rating in zip(names, ratings)}
    )


def _result(
    solution_urls: list[str | None],
    source_urls: list[str],
    consulted_urls: list[str] | None = None,
) -> IdeaResearchResult:
    research = IdeaResearch(
        summary="s",
        market_status="crowded_market",
        existing_solutions=[
            ExistingSolution(name=f"Co {i}", description="d", similarity="direct", url=url)
            for i, url in enumerate(solution_urls)
        ],
        feasibility=[],
        feasibility_factors=_factors("favorable", "favorable", "favorable", "favorable", "favorable"),
        viability=[],
        differentiation_opportunities=[],
        key_risks=[],
        suggested_next_steps=[],
        confidence=0.4,
    )
    return IdeaResearchResult(
        research=research,
        sources=[ResearchSource(title=u, url=u) for u in source_urls],
        consulted_urls=consulted_urls or [],
    )


def test_websites_found_by_the_search_are_linked_and_others_fall_back_to_search():
    from datetime import UTC, datetime

    payload = research_payload(
        _result(
            ["https://www.kitchenco.com", "https://made-up-startup.io", None],
            source_urls=[],
            consulted_urls=["https://kitchenco.com/about", "https://other.org/page"],
        ),
        "en",
        datetime.now(UTC),
    )
    solutions = payload["existing_solutions"]
    # Consulted (not cited) site counts as found.
    assert solutions[0]["url"] == "https://www.kitchenco.com"
    # Never seen by the search: no direct link, but a web search instead.
    assert solutions[1]["url"] is None
    assert solutions[2]["url"] is None
    assert solutions[1]["search_url"] == "https://www.google.com/search?q=Co+1"
    assert all(s["search_url"] for s in solutions)


@pytest.mark.parametrize(
    ("ratings", "expected"),
    [
        (("favorable",) * 5, 100),
        (("challenging",) * 5, 20),
        (("moderate",) * 5, 60),
        (("favorable", "moderate", "challenging", "favorable", "moderate"), 68),
    ],
)
def test_feasibility_score_is_computed_from_factor_ratings(ratings, expected):
    assert feasibility_score(_factors(*ratings)) == expected


def test_only_cited_http_links_survive():
    from datetime import UTC, datetime

    payload = research_payload(
        _result(
            [
                "https://www.mealkit.com/pricing",  # cited domain (www. ignored)
                "https://blog.mealkit.com/about",  # subdomain of a cited site
                "https://invented-startup.io",  # never cited
                "javascript:alert(1)",  # not http(s)
                None,
            ],
            ["https://mealkit.com/news", "ftp://files.example.com/x"],
        ),
        "en",
        datetime.now(UTC),
    )
    assert [s["url"] for s in payload["existing_solutions"]] == [
        "https://www.mealkit.com/pricing",
        "https://blog.mealkit.com/about",
        None,
        None,
        None,
    ]
    # Non-http(s) sources are dropped too.
    assert payload["sources"] == [{"title": "https://mealkit.com/news", "url": "https://mealkit.com/news"}]


# --- OpenAI provider (no network) -------------------------------------------


def _annotation(url: str, title: str = "T", kind: str = "url_citation") -> SimpleNamespace:
    return SimpleNamespace(type=kind, url=url, title=title)


def test_extract_citations_dedupes_and_ignores_other_items():
    response = SimpleNamespace(
        output=[
            SimpleNamespace(type="web_search_call"),
            SimpleNamespace(
                type="message",
                content=[
                    SimpleNamespace(
                        annotations=[
                            _annotation("https://a.com/1", "A"),
                            _annotation("https://a.com/1", "A again"),
                            _annotation("https://b.com/2", "B"),
                            _annotation("https://c.com", kind="file_citation"),
                        ]
                    )
                ],
            ),
        ]
    )
    assert [(s.title, s.url) for s in extract_citations(response)] == [
        ("A", "https://a.com/1"),
        ("B", "https://b.com/2"),
    ]


def test_extract_consulted_urls_reads_search_and_opened_pages():
    response = SimpleNamespace(
        output=[
            SimpleNamespace(
                type="web_search_call",
                action=SimpleNamespace(
                    url=None,
                    sources=[SimpleNamespace(url="https://a.com"), SimpleNamespace(url="https://b.com")],
                ),
            ),
            SimpleNamespace(
                type="web_search_call",
                action=SimpleNamespace(url="https://c.com/page", sources=None),
            ),
            SimpleNamespace(type="message", content=[]),
        ]
    )
    assert extract_consulted_urls(response) == ["https://a.com", "https://b.com", "https://c.com/page"]


def test_web_search_tool_applies_domain_filter():
    assert web_search_tool([]) == {"type": "web_search", "search_context_size": "medium"}
    assert web_search_tool(["crunchbase.com"])["filters"] == {"allowed_domains": ["crunchbase.com"]}


@pytest.mark.asyncio
async def test_openai_provider_sends_web_search_and_returns_cited_sources():
    research = _result([], []).research
    captured: dict = {}

    class FakeResponses:
        async def parse(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                output_parsed=research,
                output=[
                    SimpleNamespace(
                        type="message",
                        content=[SimpleNamespace(annotations=[_annotation("https://a.com", "A")])],
                    )
                ],
            )

    provider = OpenAIProvider(api_key="test", model="test-model", web_search_domains=["a.com"])
    provider._client = SimpleNamespace(responses=FakeResponses())

    result = await provider.research_idea("Idea: meal kits", "ko")

    assert captured["model"] == "test-model"
    assert captured["tools"] == [
        {"type": "web_search", "search_context_size": "medium", "filters": {"allowed_domains": ["a.com"]}}
    ]
    assert captured["text_format"] is IdeaResearch
    assert captured["include"] == ["web_search_call.action.sources"]
    assert "official website" in captured["instructions"]
    assert "Korean" in captured["input"] and "meal kits" in captured["input"]
    assert "untrusted" in captured["instructions"]
    assert result.sources == [ResearchSource(title="A", url="https://a.com")]


# --- Remembered across sessions: venture list and research history ----------


@pytest.mark.asyncio
async def test_research_history_keeps_every_run_newest_first(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    other_org, other_email, _ = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        for language in ("en", "ko"):
            await c.post(
                f"/api/ventures/{venture_id}/stages/idea_discovery/research",
                json={"language": language},
                headers=h,
            )
        history = await c.get(
            f"/api/ventures/{venture_id}/stages/idea_discovery/research/history", headers=h
        )
        other = await c.get(
            f"/api/ventures/{venture_id}/stages/idea_discovery/research/history",
            headers=headers(other_org, other_email),
        )
        signed_out = await c.get(f"/api/ventures/{venture_id}/stages/idea_discovery/research/history")

    assert history.status_code == 200
    runs = history.json()
    assert [r["research"]["language"] for r in runs] == ["ko", "en"]  # newest first
    assert all(r["research"]["kind"] == "idea_research" for r in runs)
    assert other.status_code == 404
    assert signed_out.status_code == 401


@pytest.mark.asyncio
async def test_venture_list_shows_saved_progress_for_own_organization_only(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    other_org, other_email, other_venture = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await c.post(
            f"/api/ventures/{venture_id}/stages/idea_discovery/research", json={}, headers=h
        )
        await c.put(
            f"/api/ventures/{venture_id}/stages/problem_definition",
            json={
                "answers": {
                    "problem_statement": "p",
                    "evidence_for_problem": "e",
                    "who_experiences_it": "w",
                    "frequency_severity": "f",
                },
                "complete": True,
            },
            headers=h,
        )
        mine = await c.get("/api/ventures", headers=h)
        signed_out = await c.get("/api/ventures")

    assert mine.status_code == 200
    by_id = {v["id"]: v for v in mine.json()}
    assert str(other_venture) not in by_id  # another organization's venture
    entry = by_id[str(venture_id)]
    assert entry["completed_stages"] == 1
    assert entry["total_stages"] == 11
    assert entry["feasibility_score"] == 68
    assert entry["researched_at"]
    assert signed_out.status_code == 401
