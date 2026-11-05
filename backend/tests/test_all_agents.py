"""Every stage agent, pause/resume, re-run, and the "My AI Agents" overview.

No live AI: the fake provider finishes each agent in one turn with the same
output as its single-call research; a scripted provider drives pause/resume.
Runs execute inline (the launcher dependency is overridden).
"""

import asyncio
import json
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import func, select, update

from app.agents.jobs import get_agent_launcher
from app.agents.runner import run_agent
from app.agents.stages import AGENT_SPECS
from app.ai.fake import FakeAIProvider
from app.ai.schemas import AgentTurn
from app.db import async_session
from app.dependencies import get_ai_provider
from app.main import app
from app.models import AgentRun, AIRun, Organization
from app.tenancy import set_current_organization
from tests.test_agents import call, final, tools_turn
from tests.test_alternatives_research import complete_stages_1_to_3, stage
from tests.test_competitive_position import complete_stages_1_to_6
from tests.test_idea_research import Tenants, client, headers
from tests.test_market_research import complete_stages_1_to_5
from tests.test_personas import LANDLORD, messages_url, save_personas

FEEDBACK_STAGES = {"problem_definition", "customer_definition", "value_proposition"}
KINDS = {
    "idea_discovery": "idea_research",
    "existing_alternatives": "alternatives_research",
    "market_evidence": "market_research",
    "persona_validation": "persona_insights",
    "competitive_position": "competitive_position",
    "dfv_assessment": "dfv_assessment",
    "mvp": "mvp",
    "business_model": "business_model",
    "validation_plan": "validation_plan",
    "financial_analysis": "financial_analysis",
    "marketing_plan": "marketing_plan",
}


def install(provider):
    app.dependency_overrides[get_ai_provider] = lambda: provider

    async def inline(run_id, organization_id, prov, founder_answer=None):
        await run_agent(run_id, organization_id, prov, founder_answer)

    app.dependency_overrides[get_agent_launcher] = lambda: inline
    return provider


@pytest.fixture
def agents():
    yield install
    app.dependency_overrides.pop(get_ai_provider, None)
    app.dependency_overrides.pop(get_agent_launcher, None)


@pytest_asyncio.fixture(loop_scope="session")
async def tenants():
    t = Tenants()
    yield t
    await t.cleanup()


async def org_id(slug: str) -> uuid.UUID:
    async with async_session() as session:
        return (await session.execute(select(Organization.id).where(Organization.slug == slug))).scalar_one()


def start_url(venture_id, slug: str) -> str:
    return f"/api/ventures/{venture_id}/stages/{slug}/agent-runs"


def run_url(venture_id, run_id: str, action: str) -> str:
    return f"/api/ventures/{venture_id}/agent-runs/{run_id}/{action}"


async def make_ready(c, venture_id, h, slug: str) -> None:
    """Whatever the stage needs before its agent can run."""
    if slug in ("existing_alternatives",):
        await complete_stages_1_to_3(c, venture_id, h)
    elif slug == "market_evidence":
        await complete_stages_1_to_5(c, venture_id, h)
        await c.put(
            f"/api/ventures/{venture_id}/stages/market_evidence",
            json={"answers": {"user_country": "South Korea", "user_metro_city": "Seoul"}},
            headers=h,
        )
    elif slug == "competitive_position":
        await complete_stages_1_to_6(c, venture_id, h)
    elif slug == "persona_validation":
        saved = await save_personas(c, venture_id, h, [LANDLORD])
        persona_id = saved.json()["answers"]["personas"][0]["id"]
        await c.post(messages_url(venture_id, persona_id), json={"content": "Would you pay?"}, headers=h)


# --- Every agent -----------------------------------------------------------------------------------


def test_every_built_stage_has_an_agent_and_stage_fifteen_does_not():
    assert len(AGENT_SPECS) == 14
    assert "decision_roadmap" not in AGENT_SPECS
    for spec in AGENT_SPECS.values():
        assert "untrusted_data" in spec.instructions and "propose_answers" in spec.instructions
        assert spec.slug not in spec.readable_stages  # only earlier stages


@pytest.mark.asyncio
@pytest.mark.parametrize("slug", sorted(AGENT_SPECS))
async def test_each_agent_runs_end_to_end_and_saves_the_stage_output(tenants, agents, slug):
    agents(FakeAIProvider())
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await make_ready(c, venture_id, h, slug)
        before = (await stage(c, venture_id, h, slug))["answers"]
        started = await c.post(start_url(venture_id, slug), json={"language": "en"}, headers=h)
        after = await stage(c, venture_id, h, slug)

    assert started.status_code == 202, started.text
    run = started.json()
    assert run["status"] == "succeeded", run
    analysis = after["ai_analysis"]
    assert analysis["agent_run_id"] == run["id"]
    if slug in FEEDBACK_STAGES:
        assert analysis["analyzed_at"] and analysis["summary"] and analysis["language"] == "en"
    else:
        assert analysis["kind"] == KINDS[slug]
    # Drafts wait for the founder. (Stages 12 and 13 merge their drafted inputs
    # into the answers, exactly as their single-call research does.)
    if before is not None and slug not in ("validation_plan", "financial_analysis"):
        assert after["answers"] == before

    async with async_session() as session:
        await set_current_organization(session, await org_id(org_slug))
        operations = (
            await session.execute(
                select(AIRun.operation).where(AIRun.venture_id == venture_id, AIRun.status == "succeeded")
            )
        ).scalars().all()
    assert AGENT_SPECS[slug].operation in operations


@pytest.mark.asyncio
async def test_preconditions_are_checked_before_a_run_is_created(tenants, agents):
    agents(FakeAIProvider())
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await complete_stages_1_to_5(c, venture_id, h)
        no_location = await c.post(start_url(venture_id, "market_evidence"), json={}, headers=h)
        no_chats = await c.post(start_url(venture_id, "persona_validation"), json={}, headers=h)
    assert (no_location.status_code, no_location.json()["detail"]) == (422, "location_required")
    assert (no_chats.status_code, no_chats.json()["detail"]) == (422, "no_conversations")
    async with async_session() as session:
        await set_current_organization(session, await org_id(org_slug))
        assert (await session.execute(select(func.count()).select_from(AgentRun))).scalar_one() == 0


# --- Pause, resume, re-run ------------------------------------------------------------------------


class PausingProvider(FakeAIProvider):
    """Turn 1 calls a tool, and the founder presses Pause meanwhile; turn 2 finishes."""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.first = tools_turn(call("read_stage", {"slug": "idea_discovery"}), tokens=100)

    async def agent_turn(self, **kwargs) -> AgentTurn:
        self.calls.append(kwargs)
        await asyncio.sleep(0.02)  # some measurable work
        if len(self.calls) == 1:
            await self.pause_current()
            return self.first
        return final(tokens=50)

    async def pause_current(self) -> None:
        """What the Pause button does while this turn is in progress."""
        async with async_session() as session:
            await set_current_organization(session, self.org_id)
            await session.execute(
                update(AgentRun).where(AgentRun.status == "running").values(status="paused")
            )
            await session.commit()


@pytest.mark.asyncio
async def test_pause_stops_between_steps_and_resume_continues_where_it_left_off(tenants, agents):
    provider = PausingProvider()
    agents(provider)
    org_slug, email, venture_id = await tenants.make()
    provider.org_id = await org_id(org_slug)
    h = headers(org_slug, email)
    async with client() as c:
        await complete_stages_1_to_3(c, venture_id, h)
        paused = (await c.post(start_url(venture_id, "existing_alternatives"), json={}, headers=h)).json()
        resume_twice_guard = await c.post(run_url(venture_id, paused["id"], "pause"), headers=h)
        resumed = await c.post(run_url(venture_id, paused["id"], "resume"), headers=h)
        not_paused = await c.post(run_url(venture_id, paused["id"], "resume"), headers=h)

    assert paused["status"] == "paused" and paused["model_turns"] == 1
    assert paused["active_ms"] >= 20
    assert resume_twice_guard.status_code == 409  # already paused
    assert resumed.status_code == 202
    done = resumed.json()
    assert done["status"] == "succeeded" and done["model_turns"] == 2 and done["tokens_used"] == 150
    assert done["active_ms"] >= paused["active_ms"] + 20
    second = provider.calls[1]
    assert second["previous_response_id"] == provider.first.response_id
    output = json.loads(second["input"][0]["output"])
    assert output["untrusted_data"]["stage"] == "idea_discovery"
    assert not_paused.status_code == 409


@pytest.mark.asyncio
async def test_rerun_with_replace_stops_the_active_run(tenants, agents):
    turns = iter([tools_turn(call("ask_founder", {"question": "Who?"})), final()])

    class Asking(FakeAIProvider):
        async def agent_turn(self, **kwargs):
            return next(turns)

    agents(Asking())
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await complete_stages_1_to_3(c, venture_id, h)
        waiting = (await c.post(start_url(venture_id, "existing_alternatives"), json={}, headers=h)).json()
        blocked = await c.post(start_url(venture_id, "existing_alternatives"), json={}, headers=h)
        rerun = await c.post(start_url(venture_id, "existing_alternatives"), json={"replace": True}, headers=h)
        overview = (await c.get(f"/api/ventures/{venture_id}/agents", headers=h)).json()

    assert waiting["status"] == "waiting_for_founder"
    assert blocked.status_code == 409
    assert rerun.status_code == 202 and rerun.json()["status"] == "succeeded"
    row = next(r for r in overview if r["slug"] == "existing_alternatives")
    assert row["runs"] == 2 and row["latest"]["id"] == rerun.json()["id"]
    async with async_session() as session:
        await set_current_organization(session, await org_id(org_slug))
        first = await session.get(AgentRun, uuid.UUID(waiting["id"]))
    assert first.status == "cancelled"


# --- Overview -------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_overview_lists_all_fifteen_agents_with_totals(tenants, agents):
    agents(FakeAIProvider())
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        for _ in range(2):
            await c.post(start_url(venture_id, "idea_discovery"), json={}, headers=h)
        rows = (await c.get(f"/api/ventures/{venture_id}/agents", headers=h)).json()

    assert [r["stage_number"] for r in rows] == list(range(1, 16))
    by_slug = {r["slug"]: r for r in rows}
    idea = by_slug["idea_discovery"]
    assert idea["runs"] == 2 and idea["latest"]["status"] == "succeeded" and idea["available"] is True
    assert idea["total_tokens"] == 0 and idea["total_active_ms"] >= 0
    assert by_slug["decision_roadmap"]["available"] is False
    assert by_slug["existing_alternatives"]["locked_by"]  # stages 1-3 not done
    assert by_slug["dfv_assessment"]["locked_by"] == [] and by_slug["dfv_assessment"]["latest"] is None


@pytest.mark.asyncio
async def test_overview_and_controls_are_isolated_between_organizations(tenants, agents):
    turns = iter([tools_turn(call("ask_founder", {"question": "Who?"}))])

    class Asking(FakeAIProvider):
        async def agent_turn(self, **kwargs):
            return next(turns)

    agents(Asking())
    org_a, email_a, venture_a = await tenants.make()
    org_b, email_b, venture_b = await tenants.make()
    h_a, h_b = headers(org_a, email_a), headers(org_b, email_b)
    async with client() as c:
        run = (await c.post(start_url(venture_a, "idea_discovery"), json={}, headers=h_a)).json()
        cross = [
            (await c.get(f"/api/ventures/{venture_a}/agents", headers=h_b)).status_code,
            (await c.post(run_url(venture_a, run["id"], "pause"), headers=h_b)).status_code,
            (await c.post(run_url(venture_a, run["id"], "resume"), headers=h_b)).status_code,
            (await c.post(run_url(venture_b, run["id"], "pause"), headers=h_b)).status_code,
        ]
        signed_out = (await c.get(f"/api/ventures/{venture_a}/agents")).status_code
        own_b = (await c.get(f"/api/ventures/{venture_b}/agents", headers=h_b)).json()

    assert cross == [404, 404, 404, 404]
    assert signed_out == 401
    assert all(r["runs"] == 0 for r in own_b)
