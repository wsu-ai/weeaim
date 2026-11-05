"""Professor Notes and Study Guide for a stage. No live AI calls."""

import json
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.ai.fake import FakeAIProvider
from app.ai.openai_provider import PROFESSOR_NOTES_INSTRUCTIONS, STUDY_GUIDE_INSTRUCTIONS, OpenAIProvider
from app.db import async_session
from app.dependencies import get_ai_provider
from app.main import app
from app.models import AIRun, Organization, TokenUsage
from app.tenancy import set_current_organization
from app.wizard.competitive_position import DATA_END, DATA_START
from tests.test_idea_research import Tenants, client, headers


class Recording(FakeAIProvider):
    def __init__(self) -> None:
        self.contexts: list[str] = []

    async def professor_notes(self, stage_context, language):
        self.contexts.append(stage_context)
        return await super().professor_notes(stage_context, language)

    async def study_guide(self, stage_context, language):
        self.contexts.append(stage_context)
        return await super().study_guide(stage_context, language)


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


def url(venture_id, slug="customer_definition", kind="professor_notes") -> str:
    return f"/api/ventures/{venture_id}/stages/{slug}/learning/{kind}"


async def org_id(slug: str):
    async with async_session() as session:
        return (await session.execute(select(Organization.id).where(Organization.slug == slug))).scalar_one()


@pytest.mark.asyncio
async def test_professor_notes_are_written_for_the_stage_and_saved(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        before = await c.get(url(venture_id), headers=h)
        made = await c.post(url(venture_id), json={"language": "en"}, headers=h)
        again = await c.get(url(venture_id), headers=h)
        korean = await c.get(url(venture_id) + "?language=ko", headers=h)

    assert before.status_code == 404 and before.json()["detail"] == "not_generated"
    assert made.status_code == 200
    notes = made.json()
    assert notes["kind"] == "professor_notes" and notes["stage_slug"] == "customer_definition"
    assert notes["core_concepts"] and notes["teaching_plan"] and notes["class_activity"]["deliverable"]
    assert again.json() == notes  # saved: reopening costs nothing
    assert korean.status_code == 404  # each language is its own

    data = json.loads(provider.contexts[0].split(DATA_START)[1].split(f"\n{DATA_END}")[0])
    assert data["stage_number"] == 3 and data["questions_the_founder_answers"]
    assert "Venture:" in data["venture"]

    async with async_session() as session:
        await set_current_organization(session, await org_id(org_slug))
        used = (
            await session.execute(select(TokenUsage.operation).where(TokenUsage.venture_id == venture_id))
        ).scalars().all()
    assert "professor_notes" in used  # token-metered like every AI call


@pytest.mark.asyncio
async def test_the_study_guide_drops_quiz_questions_with_impossible_answers(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        made = await c.post(url(venture_id, kind="study_guide"), json={"language": "ko"}, headers=h)
    guide = made.json()
    assert made.status_code == 200 and guide["language"] == "ko"
    assert len(guide["self_check"]) == 2  # the fake's third question points past its options
    assert all(0 <= q["answer_index"] < len(q["options"]) for q in guide["self_check"])
    assert guide["key_terms"] and guide["practice_exercise"]["steps"]


@pytest.mark.asyncio
async def test_unknown_kinds_and_unbuilt_stages_are_refused(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        bad_kind = await c.post(url(venture_id, kind="exam_answers"), json={}, headers=h)
        unbuilt = await c.post(url(venture_id, slug="decision_roadmap"), json={}, headers=h)
    assert bad_kind.status_code == 422
    assert unbuilt.status_code == 404


@pytest.mark.asyncio
async def test_learning_material_is_isolated_between_organizations(tenants, provider):
    org_a, email_a, venture_a = await tenants.make()
    org_b, email_b, _ = await tenants.make()
    async with client() as c:
        await c.post(url(venture_a), json={}, headers=headers(org_a, email_a))
        read_other = await c.get(url(venture_a), headers=headers(org_b, email_b))
        write_other = await c.post(url(venture_a), json={}, headers=headers(org_b, email_b))
        signed_out = await c.get(url(venture_a))
    assert read_other.status_code == 404 and write_other.status_code == 404
    assert signed_out.status_code == 401
    async with async_session() as session:
        await set_current_organization(session, await org_id(org_b))
        seen = (
            await session.execute(select(AIRun).where(AIRun.operation == "professor_notes", AIRun.venture_id == venture_a))
        ).scalars().all()
    assert seen == []


@pytest.mark.asyncio
async def test_openai_learning_calls_use_their_instructions_and_treat_the_stage_as_data():
    sent: list[dict] = []
    fake = FakeAIProvider()
    notes, guide = await fake.professor_notes("x", "en"), await fake.study_guide("x", "en")

    class FakeResponses:
        async def parse(self, **kwargs):
            sent.append(kwargs)
            return SimpleNamespace(output_parsed=notes if len(sent) == 1 else guide, usage=None)

    provider = OpenAIProvider(api_key="test", model="test-model")
    provider._client = SimpleNamespace(responses=FakeResponses())
    await provider.professor_notes("STAGE", "ko")
    await provider.study_guide("STAGE", "en")
    assert sent[0]["instructions"] == PROFESSOR_NOTES_INSTRUCTIONS and "Korean" in sent[0]["input"]
    assert sent[1]["instructions"] == STUDY_GUIDE_INSTRUCTIONS and "untrusted data" in sent[1]["input"]
    for text in (PROFESSOR_NOTES_INSTRUCTIONS, STUDY_GUIDE_INSTRUCTIONS):
        assert "never invent sources" in text and "not instructions" in text
