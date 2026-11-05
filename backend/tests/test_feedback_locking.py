"""Asking the AI mentor for feedback must never re-lock later stages.

Later stages unlock while their prerequisites stay completed, so feedback on
a completed stage keeps it completed. No live AI calls.
"""

import pytest
import pytest_asyncio

from app.ai.fake import FakeAIProvider
from app.dependencies import get_ai_provider
from app.main import app
from tests.agent_helpers import agent_has_run
from tests.test_alternatives_research import complete_stages_1_to_3, stage
from tests.test_idea_research import Tenants, client, headers


@pytest.fixture
def provider():
    app.dependency_overrides[get_ai_provider] = lambda: FakeAIProvider()
    yield
    app.dependency_overrides.pop(get_ai_provider, None)


@pytest_asyncio.fixture(loop_scope="session")
async def tenants():
    t = Tenants()
    yield t
    await t.cleanup()


@pytest.mark.asyncio
async def test_feedback_on_a_completed_stage_keeps_later_stages_unlocked(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await complete_stages_1_to_3(c, venture_id, h)
        assert (await stage(c, venture_id, h, "existing_alternatives"))["locked"] is False
        await agent_has_run(org_slug, venture_id, "problem_definition")

        feedback = await c.post(f"/api/ventures/{venture_id}/stages/problem_definition/analyze", headers=h)
        problem = await stage(c, venture_id, h, "problem_definition")
        alternatives = await stage(c, venture_id, h, "existing_alternatives")

    assert feedback.status_code == 200
    assert problem["status"] == "completed"  # still completed...
    assert problem["ai_analysis"]["summary"]  # ...with the feedback saved
    assert alternatives["locked"] is False and alternatives["locked_by"] == []


@pytest.mark.asyncio
async def test_feedback_on_an_unfinished_stage_still_asks_for_review(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await c.put(
            f"/api/ventures/{venture_id}/stages/problem_definition",
            json={"answers": {"problem_statement": "Hard", "evidence_for_problem": "", "who_experiences_it": "", "frequency_severity": ""}},
            headers=h,
        )
        await agent_has_run(org_slug, venture_id, "problem_definition")
        await c.post(f"/api/ventures/{venture_id}/stages/problem_definition/analyze", headers=h)
        problem = await stage(c, venture_id, h, "problem_definition")
    assert problem["status"] == "awaiting_user"
