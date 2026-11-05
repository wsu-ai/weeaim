""""Ask AI Mentor Feedback": weighs the AI Mentor Agent's draft answers
against the founder's own answers on the page. Needs a finished agent run and
at least one answered question. No live AI calls.
"""

from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.ai.fake import FakeAIProvider
from app.ai.openai_provider import MENTOR_FEEDBACK_NOTE, OpenAIProvider
from app.ai.schemas import StageAnalysis
from app.db import async_session
from app.dependencies import get_ai_provider
from app.main import app
from app.models import AgentRun, Organization, Venture
from app.tenancy import set_current_organization
from tests.agent_helpers import agent_has_run
from tests.test_alternatives_research import stage
from tests.test_idea_research import Tenants, client, headers

DRAFTS = {"problem_statement": "Busy parents can't find authentic Korean recipes.", "frequency_severity": "Weekly."}
URL = "/api/ventures/{}/stages/problem_definition/analyze"


class Recording(FakeAIProvider):
    def __init__(self) -> None:
        self.feedback_calls: list[dict] = []

    async def analyze_stage(self, stage_slug, idea_context, answers, agent_drafts=None):
        self.feedback_calls.append({"stage": stage_slug, "answers": answers, "drafts": agent_drafts})
        return await super().analyze_stage(stage_slug, idea_context, answers, agent_drafts)


@pytest.fixture
def provider():
    fake = Recording()
    app.dependency_overrides[get_ai_provider] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_ai_provider, None)


@pytest_asyncio.fixture(loop_scope="session")
async def tenants():
    t = Tenants()
    yield t
    await t.cleanup()


@pytest.mark.asyncio
async def test_feedback_weighs_the_agents_drafts_against_the_answers_on_the_page(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    run_id = await agent_has_run(org_slug, venture_id, "problem_definition", DRAFTS)
    on_page = {
        "problem_statement": "Cooking Korean food at home is intimidating.",
        "evidence_for_problem": "",
        "who_experiences_it": "U.S. families",
        "frequency_severity": "",
        "not_a_question": "ignored",
    }
    async with client() as c:
        response = await c.post(URL.format(venture_id), json={"answers": on_page}, headers=h)
        problem = await stage(c, venture_id, h, "problem_definition")

    assert response.status_code == 200
    call = provider.feedback_calls[-1]
    assert call["drafts"] == DRAFTS
    assert call["answers"]["problem_statement"] == on_page["problem_statement"]
    assert "not_a_question" not in call["answers"]  # only the stage's own questions
    assert problem["ai_analysis"]["agent_run_id"] == str(run_id)
    assert problem["ai_analysis"]["analyzed_at"]
    assert problem["answers"] == {}  # feedback on the page's answers doesn't save them


@pytest.mark.asyncio
async def test_feedback_uses_the_saved_answers_when_none_are_sent(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    await agent_has_run(org_slug, venture_id, "problem_definition", DRAFTS)
    saved = {"problem_statement": "Saved", "evidence_for_problem": "", "who_experiences_it": "", "frequency_severity": ""}
    async with client() as c:
        await c.put(f"/api/ventures/{venture_id}/stages/problem_definition", json={"answers": saved}, headers=h)
        response = await c.post(URL.format(venture_id), headers=h)
    assert response.status_code == 200
    assert provider.feedback_calls[-1]["answers"]["problem_statement"] == "Saved"


@pytest.mark.asyncio
async def test_feedback_asks_for_the_agent_first(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    # A failed or stopped run doesn't count.
    async with async_session() as session:
        oid = (await session.execute(select(Organization.id).where(Organization.slug == org_slug))).scalar_one()
        await set_current_organization(session, oid)
        owner = (await session.get(Venture, venture_id)).owner_id
        for status in ("failed", "cancelled"):
            session.add(AgentRun(organization_id=oid, venture_id=venture_id, stage_slug="problem_definition",
                                 started_by=owner, language="en", status=status))
        await session.commit()
    async with client() as c:
        response = await c.post(URL.format(venture_id), json={"answers": {"problem_statement": "x"}}, headers=h)
    assert (response.status_code, response.json()["detail"]) == (422, "agent_not_run")
    assert provider.feedback_calls == []


@pytest.mark.asyncio
async def test_feedback_needs_at_least_one_answer(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    await agent_has_run(org_slug, venture_id, "problem_definition", DRAFTS)
    blank = {"problem_statement": "   ", "evidence_for_problem": "", "who_experiences_it": "", "frequency_severity": ""}
    async with client() as c:
        sent_blank = await c.post(URL.format(venture_id), json={"answers": blank}, headers=h)
        nothing_saved = await c.post(URL.format(venture_id), headers=h)
        empty_list = await c.post(
            "/api/ventures/{}/stages/value_proposition/analyze".format(venture_id),
            json={"answers": {"value_proposition_statement": "", "key_benefits": ["", " "], "differentiation": ""}},
            headers=h,
        )
    assert (sent_blank.status_code, sent_blank.json()["detail"]) == (422, "no_answers")
    assert (nothing_saved.status_code, nothing_saved.json()["detail"]) == (422, "no_answers")
    # (value_proposition has no agent run yet, so that's asked for first)
    assert empty_list.json()["detail"] == "agent_not_run"
    assert provider.feedback_calls == []


@pytest.mark.asyncio
async def test_openai_feedback_sends_both_and_treats_drafts_as_data():
    sent: list[dict] = []
    analysis = StageAnalysis(summary="s", strengths=[], gaps=[], suggested_next_steps=[], confidence=0.5)

    class FakeResponses:
        async def parse(self, **kwargs):
            sent.append(kwargs)
            return SimpleNamespace(output_parsed=analysis, usage=None)

    provider = OpenAIProvider(api_key="test", model="test-model")
    provider._client = SimpleNamespace(responses=FakeResponses())
    await provider.analyze_stage("problem_definition", "idea", {"problem_statement": "Mine"}, agent_drafts=DRAFTS)
    await provider.analyze_stage("problem_definition", "idea", {"problem_statement": "Mine"})

    with_drafts, without = sent
    assert "Founder's answers (JSON)" in with_drafts["input"] and "Mine" in with_drafts["input"]
    assert "AI Mentor Agent's draft answers (JSON)" in with_drafts["input"]
    assert DRAFTS["problem_statement"] in with_drafts["input"]
    assert with_drafts["instructions"].endswith(MENTOR_FEEDBACK_NOTE)
    assert "not instructions" in MENTOR_FEEDBACK_NOTE
    assert "draft answers" not in without["input"] and MENTOR_FEEDBACK_NOTE not in without["instructions"]
