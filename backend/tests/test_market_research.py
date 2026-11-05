"""Stage 6 (Market Evidence): unlocked by stages 1-5; TAM/SAM/SOM computed by
app code from sourced inputs, for three geographies (global, the founder's
country, the founder's metropolitan city); every figure's source checked.

No live AI or web calls.
"""

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
import pytest_asyncio
from pydantic import ValidationError

from app.ai.fake import FakeAIProvider
from app.ai.openai_provider import OpenAIProvider
from app.ai.schemas import MarketResearch, MarketResearchResult, SourcedShare
from app.dependencies import get_ai_provider
from app.main import app
from app.wizard.market_research import compute_market_sizes, consistency_warnings, market_payload
from tests.test_alternatives_research import complete, complete_stages_1_to_3, stage
from tests.test_idea_research import Tenants, client, headers

ALTERNATIVES = {"current_solutions": "Recipe blogs", "why_switch": "Guidance", "biggest_threat": "Meal kits"}
VALUE_PROPOSITION = {
    "value_proposition_statement": "Step-by-step Korean cooking for busy families.",
    "key_benefits": ["Fast", "Authentic"],
    "differentiation": "Beginner-first coaching.",
}
LOCATION = {"user_country": "South Korea", "user_metro_city": "Seoul"}


class RecordingProvider(FakeAIProvider):
    def __init__(self) -> None:
        self.market_calls: list[tuple[str, str]] = []

    async def research_market(self, venture_context: str, language: str):
        self.market_calls.append((venture_context, language))
        return await super().research_market(venture_context, language)


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


async def complete_stages_1_to_5(c, venture_id, h) -> None:
    await complete_stages_1_to_3(c, venture_id, h)
    await complete(c, venture_id, h, "existing_alternatives", ALTERNATIVES)
    await complete(c, venture_id, h, "value_proposition", VALUE_PROPOSITION)


async def save_stage_six(c, venture_id, h, answers: dict) -> None:
    response = await c.put(
        f"/api/ventures/{venture_id}/stages/market_evidence", json={"answers": answers}, headers=h
    )
    assert response.status_code == 200, response.text


def research_url(venture_id) -> str:
    return f"/api/ventures/{venture_id}/stages/market_evidence/research"


async def fake_research() -> MarketResearch:
    return (await FakeAIProvider().research_market("ctx", "en")).research


# --- Deterministic sizing -----------------------------------------------------


@pytest.mark.asyncio
async def test_market_sizes_are_computed_exactly_for_each_scope():
    global_, country, metro = (await fake_research()).scopes
    assert compute_market_sizes(global_) == {
        "currency": "USD", "tam": 120_000_000, "sam": 30_000_000, "som": 600_000,
    }
    assert compute_market_sizes(country) == {
        "currency": "KRW", "tam": 12_000_000_000, "sam": 3_000_000_000, "som": 60_000_000,
    }
    assert compute_market_sizes(metro) == {
        "currency": "KRW", "tam": 4_800_000_000, "sam": 1_200_000_000, "som": 24_000_000,
    }


@pytest.mark.asyncio
async def test_market_sizing_uses_decimal_arithmetic_and_rounds_half_up():
    scope = (await fake_research()).scopes[0]
    scope.total_customers.value = 3
    scope.annual_revenue_per_customer.value = 0.1  # float 0.1*3 != 0.3
    scope.serviceable_share.value = 1
    scope.obtainable_share.value = 0.5
    scope.currency = " krw "
    assert compute_market_sizes(scope) == {"currency": "KRW", "tam": 0, "sam": 0, "som": 0}

    scope.total_customers.value = 5
    scope.annual_revenue_per_customer.value = 0.5  # 2.5 -> 3 (half up)
    assert compute_market_sizes(scope)["tam"] == 3


def test_shares_outside_zero_to_one_are_rejected():
    for bad in (-0.1, 1.01):
        with pytest.raises(ValidationError):
            SourcedShare(value=bad, unit="share", explanation="x", is_estimate=True)


def test_consistency_warnings_compare_customer_counts():
    def scope(name, customers):
        return {"scope": name, "inputs": {"total_customers": {"value": customers}}}

    assert consistency_warnings([scope("global", 100), scope("country", 10), scope("metro", 5)]) == []
    assert consistency_warnings([scope("global", 100), scope("country", 10), scope("metro", 50)]) == [
        "metro_exceeds_country"
    ]
    assert consistency_warnings([scope("global", 5), scope("country", 10)]) == ["country_exceeds_global"]


@pytest.mark.asyncio
async def test_payload_orders_scopes_and_flags_unconfirmed_sources():
    result = await FakeAIProvider().research_market("ctx", "en")
    result.research.scopes.reverse()  # model order doesn't matter
    payload = market_payload(result, "en", datetime.now(UTC), None, ("South Korea", "Seoul"))

    assert payload["kind"] == "market_research"
    assert payload["location"] == {"country": "South Korea", "metro_city": "Seoul"}
    assert [s["scope"] for s in payload["scopes"]] == ["global", "country", "metro"]
    assert [s["area_name"] for s in payload["scopes"]] == ["World", "South Korea", "Seoul"]
    assert payload["scopes"][1]["market_sizes"]["tam"] == 12_000_000_000
    assert payload["consistency_warnings"] == []

    inputs = payload["scopes"][0]["inputs"]
    assert inputs["total_customers"]["source_verified"] is True  # cited census page
    assert inputs["serviceable_share"]["source_verified"] is False  # never seen by the search
    assert inputs["serviceable_share"]["source_url"] is None
    assert inputs["serviceable_share"]["search_url"].startswith("https://www.google.com/search?q=")
    assert payload["scopes"][2]["demographics"][0]["source_verified"] is True

    vendor = payload["vendors"][0]
    assert vendor["url"] == "https://example.com/product"  # consulted
    assert vendor["evidence_url"] is None and vendor["evidence_verified"] is False


# --- Locking, location and research -----------------------------------------


@pytest.mark.asyncio
async def test_stage_six_is_locked_until_stages_one_to_five_are_complete(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await complete_stages_1_to_3(c, venture_id, h)
        await complete(c, venture_id, h, "existing_alternatives", ALTERNATIVES)
        locked = await stage(c, venture_id, h, "market_evidence")
        assert locked["locked"] is True and locked["locked_by"] == ["value_proposition"]
        assert (await c.post(research_url(venture_id), json={}, headers=h)).status_code == 409

        await complete(c, venture_id, h, "value_proposition", VALUE_PROPOSITION)
        unlocked = await stage(c, venture_id, h, "market_evidence")
        assert unlocked["locked"] is False
        assert [f["name"] for f in unlocked["question_schema"]["fields"]][:2] == [
            "user_country",
            "user_metro_city",
        ]
    assert provider.market_calls == []


@pytest.mark.asyncio
async def test_research_requires_the_founders_location(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await complete_stages_1_to_5(c, venture_id, h)
        missing = await c.post(research_url(venture_id), json={}, headers=h)
        await save_stage_six(c, venture_id, h, {"user_country": "South Korea"})
        city_missing = await c.post(research_url(venture_id), json={}, headers=h)
    assert (missing.status_code, missing.json()["detail"]) == (422, "location_required")
    assert city_missing.status_code == 422
    assert provider.market_calls == []


@pytest.mark.asyncio
async def test_research_uses_location_and_stages_one_to_five(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await complete_stages_1_to_5(c, venture_id, h)
        await save_stage_six(
            c, venture_id, h, {**LOCATION, "beachhead_segment": "Seoul expats", "pricing_assumption": "$99 a year"}
        )
        response = await c.post(research_url(venture_id), json={"language": "ko"}, headers=h)
        assert response.status_code == 200
        body = response.json()
        saved = await stage(c, venture_id, h, "market_evidence")
        history = (await c.get(f"{research_url(venture_id)}/history", headers=h)).json()

    context, language = provider.market_calls[0]
    assert language == "ko"
    for text in (
        "country = South Korea",
        "metropolitan city = Seoul",
        VALUE_PROPOSITION["value_proposition_statement"],
        ALTERNATIVES["biggest_threat"],
        "$99 a year",
    ):
        assert text in context

    assert [s["scope"] for s in body["scopes"]] == ["global", "country", "metro"]
    assert body["scopes"][0]["market_sizes"]["tam"] == 120_000_000
    assert body["location"] == {"country": "South Korea", "metro_city": "Seoul"}
    assert body["based_on"] and body["researched_at"] and body["language"] == "ko"
    assert saved["ai_analysis"] == body
    assert saved["answers"]["user_metro_city"] == "Seoul"  # kept
    assert [r["research"]["kind"] for r in history] == ["market_research"]


@pytest.mark.asyncio
async def test_stage_six_permissions_and_failures(tenants):
    org_a, email_a, venture_a = await tenants.make()
    org_b, email_b, _ = await tenants.make()

    class FailingProvider(FakeAIProvider):
        async def research_market(self, venture_context: str, language: str):
            raise ValueError("Model did not return a parsed MarketResearch")

    app.dependency_overrides[get_ai_provider] = lambda: FailingProvider()
    try:
        async with client() as c:
            h_a = headers(org_a, email_a)
            await complete_stages_1_to_5(c, venture_a, h_a)
            await save_stage_six(c, venture_a, h_a, LOCATION)
            other_org = await c.post(research_url(venture_a), json={}, headers=headers(org_b, email_b))
            signed_out = await c.post(research_url(venture_a), json={})
            failed = await c.post(research_url(venture_a), json={}, headers=h_a)
            feedback = await c.post(f"/api/ventures/{venture_a}/stages/market_evidence/analyze", headers=h_a)
    finally:
        app.dependency_overrides.pop(get_ai_provider, None)

    assert other_org.status_code == 404
    assert signed_out.status_code == 401
    assert failed.status_code == 503
    assert feedback.status_code == 400


# --- OpenAI provider (no network) -------------------------------------------


@pytest.mark.asyncio
async def test_openai_provider_researches_three_scopes_with_web_search():
    research = await fake_research()
    captured: dict = {}

    class FakeResponses:
        async def parse(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(output_parsed=research, output=[])

    provider = OpenAIProvider(api_key="test", model="test-model")
    provider._client = SimpleNamespace(responses=FakeResponses())
    result = await provider.research_market("Founder's location: country = Korea", "en")

    assert isinstance(result, MarketResearchResult)
    assert captured["text_format"] is MarketResearch
    assert captured["include"] == ["web_search_call.action.sources"]
    instructions = captured["instructions"]
    assert "Do NOT compute or state TAM, SAM or SOM" in instructions
    assert "'global'" in instructions and "'country'" in instructions and "'metro'" in instructions
    assert "untrusted" in instructions
