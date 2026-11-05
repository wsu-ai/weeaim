"""Token accounting and limits.

Every AI call records its tokens; owners/admins cap tokens per venture idea
and per organization; every AI action is refused (429) once a cap is reached.
The fake AI provider "uses" 10 tokens per call. No live AI calls.
"""

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import func, select

from app.agents.jobs import get_agent_launcher
from app.agents.runner import run_agent
from app.ai.fake import FAKE_TOKENS_PER_CALL, FakeAIProvider
from app.ai.usage import add_tokens
from app.db import async_session
from app.dependencies import get_ai_provider
from app.main import app
from app.models import AuditLog, Organization, TokenUsage
from app.tenancy import set_current_organization
from tests.agent_helpers import agent_has_run
from tests.archive_helpers import delete_permanently
from tests.test_agents import call, final, tools_turn
from tests.test_alternatives_research import IDEA, PROBLEM, complete_stages_1_to_3
from tests.test_idea_research import Tenants, client, headers
from tests.test_personas import LANDLORD, messages_url, save_personas
from tests.test_venture_delete import world  # noqa: F401  (fixture)

LIMIT_MESSAGE_DETAIL = "venture_token_limit"


def install(provider):
    app.dependency_overrides[get_ai_provider] = lambda: provider

    async def inline(run_id, organization_id, prov, founder_answer=None):
        await run_agent(run_id, organization_id, prov, founder_answer)

    app.dependency_overrides[get_agent_launcher] = lambda: inline
    return provider


@pytest.fixture
def ai():
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


async def usage(org_slug: str, venture_id=None) -> list[tuple[str, int]]:
    async with async_session() as session:
        await set_current_organization(session, await org_id(org_slug))
        query = select(TokenUsage.operation, TokenUsage.tokens).order_by(TokenUsage.created_at)
        if venture_id is not None:
            query = query.where(TokenUsage.venture_id == venture_id)
        return [tuple(row) for row in (await session.execute(query)).all()]


async def set_limits(c, h, per_venture=None, organization=None):
    response = await c.put(
        "/api/token-usage/limits",
        json={"per_venture_limit": per_venture, "organization_limit": organization},
        headers=h,
    )
    assert response.status_code == 200, response.text
    return response.json()


# --- Recording ------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_every_ai_action_records_its_tokens(tenants, ai):
    ai(FakeAIProvider())
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    base = f"/api/ventures/{venture_id}"
    async with client() as c:
        await c.post(f"{base}/stages/idea_discovery/research", json={"language": "en"}, headers=h)
        await c.put(f"{base}/stages/problem_definition", json={"answers": PROBLEM}, headers=h)
        await agent_has_run(org_slug, venture_id, "problem_definition")
        await c.post(f"{base}/stages/problem_definition/analyze", headers=h)
        await c.post(f"{base}/stages/idea_discovery/translate", json={"language": "ko"}, headers=h)
        persona_id = (await save_personas(c, venture_id, h, [LANDLORD])).json()["answers"]["personas"][0]["id"]
        await c.post(messages_url(venture_id, persona_id), json={"content": "Would you pay?"}, headers=h)
        await c.post(f"{base}/interpret", headers=h)

    operations = {op for op, _ in await usage(org_slug, venture_id)}
    assert {"idea_research", "stage_feedback", "translation", "persona_chat", "idea_interpretation"} <= operations
    assert all(tokens >= FAKE_TOKENS_PER_CALL for _, tokens in await usage(org_slug, venture_id))


@pytest.mark.asyncio
async def test_agent_turns_record_their_tokens(tenants, ai):
    turns = iter([tools_turn(call("read_stage", {"slug": "idea_discovery"}), tokens=123), final(tokens=77)])

    class Scripted(FakeAIProvider):
        async def agent_turn(self, **kwargs):
            return next(turns)

    ai(Scripted())
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await complete_stages_1_to_3(c, venture_id, h)
        run = (await c.post(f"/api/ventures/{venture_id}/stages/existing_alternatives/agent-runs", json={}, headers=h)).json()
    assert run["status"] == "succeeded"
    assert [row for row in await usage(org_slug, venture_id) if row[0] == "agent_turn"] == [
        ("agent_turn", 123),
        ("agent_turn", 77),
    ]


@pytest.mark.asyncio
async def test_a_failed_call_still_records_the_tokens_it_used(tenants, ai):
    class Failing(FakeAIProvider):
        async def research_idea(self, idea_context, language):
            add_tokens(500)  # the model ran, then something broke
            raise RuntimeError("boom")

    ai(Failing())
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        failed = await c.post(f"/api/ventures/{venture_id}/stages/idea_discovery/research", json={}, headers=h)
    assert failed.status_code == 503
    assert ("idea_research", 500) in await usage(org_slug, venture_id)


# --- Limits ---------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_venture_limit_blocks_every_ai_action_on_that_venture_only(tenants, ai):
    ai(FakeAIProvider())
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    base = f"/api/ventures/{venture_id}"
    async with client() as c:
        other = (await c.post("/api/ventures", json={"idea": IDEA["idea_statement"]}, headers=h)).json()["id"]
        await complete_stages_1_to_3(c, venture_id, h)
        await agent_has_run(org_slug, venture_id, "problem_definition")
        await c.post(f"{base}/stages/idea_discovery/research", json={}, headers=h)  # uses tokens
        await set_limits(c, h, per_venture=5)

        blocked = {
            "research": await c.post(f"{base}/stages/idea_discovery/research", json={}, headers=h),
            "feedback": await c.post(f"{base}/stages/problem_definition/analyze", headers=h),
            "agent": await c.post(f"{base}/stages/existing_alternatives/agent-runs", json={}, headers=h),
            "rerun": await c.post(
                f"{base}/stages/existing_alternatives/agent-runs", json={"replace": True}, headers=h
            ),
            "interpret": await c.post(f"{base}/interpret", headers=h),
        }
        other_ok = await c.post(f"/api/ventures/{other}/stages/idea_discovery/research", json={}, headers=h)
        await set_limits(c, h)  # no limits again
        unblocked = await c.post(f"{base}/stages/idea_discovery/research", json={}, headers=h)

    assert {name: r.status_code for name, r in blocked.items()} == dict.fromkeys(blocked, 429)
    assert {r.json()["detail"] for r in blocked.values()} == {LIMIT_MESSAGE_DETAIL}
    assert other_ok.status_code == 200
    assert unblocked.status_code == 200


@pytest.mark.asyncio
async def test_the_organization_limit_blocks_every_venture(tenants, ai):
    ai(FakeAIProvider())
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        other = (await c.post("/api/ventures", json={"idea": IDEA["idea_statement"]}, headers=h)).json()["id"]
        await c.post(f"/api/ventures/{venture_id}/stages/idea_discovery/research", json={}, headers=h)
        await set_limits(c, h, per_venture=1_000_000, organization=5)
        refused = await c.post(f"/api/ventures/{other}/stages/idea_discovery/research", json={}, headers=h)
    assert (refused.status_code, refused.json()["detail"]) == (429, "organization_token_limit")


@pytest.mark.asyncio
async def test_a_running_agent_stops_when_the_limit_is_reached(tenants, ai):
    turns = iter([tools_turn(call("read_stage", {"slug": "idea_discovery"}), tokens=1000), final()])

    class Hungry(FakeAIProvider):
        async def agent_turn(self, **kwargs):
            return next(turns)

    ai(Hungry())
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await complete_stages_1_to_3(c, venture_id, h)
        await set_limits(c, h, per_venture=500)
        run = (await c.post(f"/api/ventures/{venture_id}/stages/existing_alternatives/agent-runs", json={}, headers=h)).json()
    assert (run["status"], run["error"]) == ("failed", "token_limit_reached")
    assert run["model_turns"] == 1
    # The figures for "Tell me why the agent stopped".
    assert run["steps"][-1]["result"] == {"cap": "venture_token_limit", "used": 1000, "limit": 500}


# --- Usage page and who may change limits ---------------------------------------------------------


@pytest.mark.asyncio
async def test_usage_lists_each_venture_and_the_organization_total(tenants, ai):
    ai(FakeAIProvider())
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        doomed = (await c.post("/api/ventures", json={"idea": IDEA["idea_statement"]}, headers=h)).json()["id"]
        for v in (venture_id, venture_id, doomed):
            await c.post(f"/api/ventures/{v}/stages/idea_discovery/research", json={}, headers=h)
        await delete_permanently(c, doomed, h)
        read = (await c.get("/api/token-usage", headers=h)).json()

    by_id = {v["venture_id"]: v for v in read["ventures"]}
    assert by_id[str(venture_id)]["tokens"] == 2 * FAKE_TOKENS_PER_CALL
    assert by_id[None]["tokens"] == FAKE_TOKENS_PER_CALL  # the deleted venture still counts
    assert read["organization_total"] == 3 * FAKE_TOKENS_PER_CALL
    assert read["limits"] == {"per_venture_limit": None, "organization_limit": None}
    assert read["can_edit"] is True  # the seeded user is the owner


@pytest.mark.asyncio
async def test_only_owners_and_admins_change_limits_and_it_is_audited(world, ai):  # noqa: F811
    ai(FakeAIProvider())
    org = await world.org()
    owner = await world.user(org, "owner")
    admin = await world.user(org, "admin")
    member = await world.user(org, "member")
    async with client() as c:
        member_view = (await c.get("/api/token-usage", headers=org.headers(member))).json()
        refused = await c.put(
            "/api/token-usage/limits", json={"per_venture_limit": 10}, headers=org.headers(member)
        )
        by_admin = await set_limits(c, org.headers(admin), per_venture=50_000, organization=1_000_000)
        invalid = [
            (await c.put("/api/token-usage/limits", json={"per_venture_limit": v}, headers=org.headers(owner))).status_code
            for v in (0, -5, 10**13, "lots")
        ]
    assert member_view["can_edit"] is False
    assert refused.status_code == 403
    assert by_admin["limits"] == {"per_venture_limit": 50_000, "organization_limit": 1_000_000}
    assert invalid == [422, 422, 422, 422]
    async with async_session() as session:
        await set_current_organization(session, org.id)
        audits = (
            await session.execute(select(AuditLog).where(AuditLog.action == "token_limits.update"))
        ).scalars().all()
    assert len(audits) == 1 and audits[0].log_metadata["after"]["per_venture_limit"] == 50_000


# --- Tenant isolation -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_usage_and_limits_are_isolated_between_organizations(tenants, ai):
    ai(FakeAIProvider())
    org_a, email_a, venture_a = await tenants.make()
    org_b, email_b, venture_b = await tenants.make()
    h_a, h_b = headers(org_a, email_a), headers(org_b, email_b)
    async with client() as c:
        await c.post(f"/api/ventures/{venture_a}/stages/idea_discovery/research", json={}, headers=h_a)
        await set_limits(c, h_b, per_venture=1)  # B's limit never affects A
        a_again = await c.post(f"/api/ventures/{venture_a}/stages/idea_discovery/research", json={}, headers=h_a)
        b_view = (await c.get("/api/token-usage", headers=h_b)).json()
        a_view = (await c.get("/api/token-usage", headers=h_a)).json()
        signed_out = [
            (await c.get("/api/token-usage")).status_code,
            (await c.put("/api/token-usage/limits", json={})).status_code,
        ]

    assert a_again.status_code == 200
    assert b_view["organization_total"] == 0
    assert {v["venture_id"] for v in b_view["ventures"]} == {str(venture_b)}
    assert a_view["limits"]["per_venture_limit"] is None
    assert signed_out == [401, 401]
    async with async_session() as session:
        await set_current_organization(session, await org_id(org_b))
        seen_by_b = (
            await session.execute(select(func.count()).select_from(TokenUsage).where(TokenUsage.venture_id == venture_a))
        ).scalar_one()
    assert seen_by_b == 0
