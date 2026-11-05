"""Archiving a venture: re-confirmation (password or emailed code), hiding it
everywhere, the single-file export, restore and permanent deletion.

No live AI or email: a fake AI provider and a recording email sender.
"""

import json
import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from sqlalchemy import select, update

from app.ai.fake import FakeAIProvider
from app.config import settings
from app.db import async_session
from app.dependencies import get_ai_provider, get_email_sender
from app.main import app
from app.models import AgentRun, AuditLog, Organization, User, Venture
from app.tenancy import set_current_organization
from tests.archive_helpers import PASSWORD, archive, set_password
from tests.test_alternatives_research import PROBLEM, complete_stages_1_to_3, stage
from tests.test_idea_research import Tenants, client, headers
from tests.test_signup import FakeSender
from tests.test_venture_delete import IDEA, world  # noqa: F401  (fixture)


@pytest.fixture
def provider():
    app.dependency_overrides[get_ai_provider] = lambda: FakeAIProvider()
    yield
    app.dependency_overrides.pop(get_ai_provider, None)


@pytest.fixture
def mailbox():
    sender = FakeSender()
    app.dependency_overrides[get_email_sender] = lambda: sender
    yield sender
    app.dependency_overrides.pop(get_email_sender, None)


@pytest_asyncio.fixture(loop_scope="session")
async def tenants():
    t = Tenants()
    yield t
    await t.cleanup()


async def org_id(slug: str) -> uuid.UUID:
    async with async_session() as session:
        return (await session.execute(select(Organization.id).where(Organization.slug == slug))).scalar_one()


def base(venture_id) -> str:
    return f"/api/ventures/{venture_id}"


async def reset_lockout(email: str) -> None:
    async with async_session() as session:
        await session.execute(
            update(User).where(User.email == email).values(failed_login_attempts=0, locked_until=None)
        )
        await session.commit()


# --- Archive, hide, restore -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_archiving_hides_the_venture_everywhere_and_restore_brings_everything_back(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await complete_stages_1_to_3(c, venture_id, h)
        archived = await archive(c, venture_id, h)

        listed = [v["id"] for v in (await c.get("/api/ventures", headers=h)).json()]
        hidden = {
            path: (await c.get(f"{base(venture_id)}{path}", headers=h)).status_code
            for path in (
                "",
                "/stages",
                "/stages/idea_discovery/research/history",
                "/stages/existing_alternatives/agent-runs/latest",
                f"/personas/{uuid.uuid4()}/messages",
                "/documents",
                "/deck.pptx",
            )
        }
        save = await c.put(
            f"{base(venture_id)}/stages/problem_definition", json={"answers": PROBLEM}, headers=h
        )
        archive_list = (await c.get("/api/ventures/archived", headers=h)).json()

        restored = await c.post(f"{base(venture_id)}/restore", headers=h)
        problem = await stage(c, venture_id, h, "problem_definition")
        listed_again = [v["id"] for v in (await c.get("/api/ventures", headers=h)).json()]

    assert archived.status_code == 204
    assert str(venture_id) not in listed
    assert set(hidden.values()) == {404}, hidden
    assert save.status_code == 404
    assert [(v["id"], v["completed_stages"], v["total_stages"]) for v in archive_list] == [(str(venture_id), 3, 15)]
    assert archive_list[0]["archived_at"]

    assert restored.status_code == 200
    assert problem["status"] == "completed" and problem["answers"]["problem_statement"] == PROBLEM["problem_statement"]
    assert str(venture_id) in listed_again

    async with async_session() as session:
        await set_current_organization(session, await org_id(org_slug))
        actions = (
            await session.execute(select(AuditLog.action).where(AuditLog.resource_id == venture_id))
        ).scalars().all()
    assert {"venture.archive", "venture.restore"} <= set(actions)


@pytest.mark.asyncio
async def test_archiving_cancels_an_active_agent_run(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    oid = await org_id(org_slug)
    async with async_session() as session:
        await set_current_organization(session, oid)
        owner = (await session.get(Venture, venture_id)).owner_id
        session.add(
            AgentRun(
                organization_id=oid, venture_id=venture_id, stage_slug="existing_alternatives",
                started_by=owner, language="en", status="waiting_for_founder",
                heartbeat_at=datetime.now(UTC),
            )
        )
        await session.commit()
    async with client() as c:
        assert (await archive(c, venture_id, h)).status_code == 204
    async with async_session() as session:
        await set_current_organization(session, oid)
        run = (await session.execute(select(AgentRun).where(AgentRun.venture_id == venture_id))).scalar_one()
    assert run.status == "cancelled"


# --- Re-authentication ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_wrong_password_is_refused_and_counts_toward_the_lockout(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    await set_password(email)
    async with client() as c:
        wrong = [
            (await c.post(f"{base(venture_id)}/archive", json={"password": "nope"}, headers=h)).status_code
            for _ in range(settings.login_max_failed_attempts)
        ]
        locked_right = await c.post(f"{base(venture_id)}/archive", json={"password": PASSWORD}, headers=h)
        still_there = await c.get(base(venture_id), headers=h)
        await reset_lockout(email)
        after_lockout = await c.post(f"{base(venture_id)}/archive", json={"password": PASSWORD}, headers=h)

    assert wrong == [403] * settings.login_max_failed_attempts
    assert locked_right.status_code == 429 and locked_right.json()["detail"] == "too_many_attempts"
    assert still_there.status_code == 200
    assert after_lockout.status_code == 204


@pytest.mark.asyncio
async def test_exactly_one_of_password_or_code_is_required(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        neither = await c.post(f"{base(venture_id)}/archive", json={}, headers=h)
        both = await c.post(f"{base(venture_id)}/archive", json={"password": "a", "code": "123456"}, headers=h)
    assert neither.status_code == 422 and both.status_code == 422


@pytest.mark.asyncio
async def test_an_account_without_a_password_confirms_with_an_emailed_code(tenants, provider, mailbox):
    org_slug, email, venture_id = await tenants.make()  # dev users have no password
    h = headers(org_slug, email)
    async with client() as c:
        no_password = await c.post(f"{base(venture_id)}/archive", json={"password": "anything"}, headers=h)
        sent = await c.post(f"{base(venture_id)}/reauth-code", headers=h)
        code = mailbox.last_code(email)
        wrong = await c.post(
            f"{base(venture_id)}/archive", json={"code": "000000" if code != "000000" else "111111"}, headers=h
        )
        right = await c.post(f"{base(venture_id)}/archive", json={"code": code}, headers=h)

    assert no_password.status_code == 403
    assert sent.status_code == 202 and mailbox.sent[-1].to == email
    assert wrong.status_code == 403 and wrong.json()["detail"] == "wrong_code"
    assert right.status_code == 204


# --- Export and permanent deletion ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_export_holds_all_fifteen_stages_in_one_file(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await complete_stages_1_to_3(c, venture_id, h)
        # A second save keeps the first as a revision.
        await c.put(
            f"{base(venture_id)}/stages/problem_definition",
            json={"answers": {**PROBLEM, "problem_statement": "Reworded problem."}, "complete": True},
            headers=h,
        )
        not_archived = await c.get(f"{base(venture_id)}/archive/export", headers=h)
        await archive(c, venture_id, h)
        exported = await c.get(f"{base(venture_id)}/archive/export", headers=h)

    assert not_archived.status_code == 409
    assert exported.status_code == 200
    assert exported.headers["content-disposition"].startswith('attachment; filename="weeaim-archive-')
    assert exported.headers["cache-control"] == "private, no-store"
    body = json.loads(exported.content)
    assert body["format"] == "weeaim.venture_archive.v1"
    assert [s["number"] for s in body["stages"]] == list(range(1, 16))
    problem = next(s for s in body["stages"] if s["slug"] == "problem_definition")
    assert problem["status"] == "completed"
    assert problem["answers"]["problem_statement"] == "Reworded problem."
    assert PROBLEM["problem_statement"] in [r["answers"].get("problem_statement") for r in problem["revisions"]]
    assert body["venture"]["archived_at"]


@pytest.mark.asyncio
async def test_permanent_deletion_needs_an_archived_venture_and_reconfirmation(tenants, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await set_password(email)
        too_early = await c.post(f"{base(venture_id)}/delete-permanently", json={"password": PASSWORD}, headers=h)
        await archive(c, venture_id, h)
        wrong = await c.post(f"{base(venture_id)}/delete-permanently", json={"password": "nope"}, headers=h)
        kept = [v["id"] for v in (await c.get("/api/ventures/archived", headers=h)).json()]
        right = await c.post(f"{base(venture_id)}/delete-permanently", json={"password": PASSWORD}, headers=h)
        gone = await c.get("/api/ventures/archived", headers=h)
        old_route = await c.delete(base(venture_id), headers=h)

    assert too_early.status_code == 409
    assert wrong.status_code == 403 and kept == [str(venture_id)]
    assert right.status_code == 204 and gone.json() == []
    assert old_route.status_code == 405  # no un-confirmed delete route any more


# --- Who may archive ------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_only_the_creator_or_an_org_admin_manages_the_archive(world, provider):  # noqa: F811
    org = await world.org()
    creator = await world.user(org, "member")
    other = await world.user(org, "member")
    admin = await world.user(org, "admin")
    async with client() as c:
        venture_id = (await c.post("/api/ventures", json={"idea": IDEA}, headers=org.headers(creator))).json()["id"]
        other_archive = await archive(c, venture_id, org.headers(other))
        assert (await archive(c, venture_id, org.headers(creator))).status_code == 204

        other_actions = [
            (await c.post(f"{base(venture_id)}/restore", headers=org.headers(other))).status_code,
            (await c.get(f"{base(venture_id)}/archive/export", headers=org.headers(other))).status_code,
            (
                await c.post(
                    f"{base(venture_id)}/delete-permanently", json={"password": PASSWORD}, headers=org.headers(other)
                )
            ).status_code,
        ]
        other_list = (await c.get("/api/ventures/archived", headers=org.headers(other))).json()
        admin_list = (await c.get("/api/ventures/archived", headers=org.headers(admin))).json()

    assert other_archive.status_code == 403
    assert other_actions == [403, 403, 403]
    assert other_list == []
    assert [v["id"] for v in admin_list] == [venture_id]


# --- Tenant isolation -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_archives_are_isolated_between_organizations(tenants, provider):
    org_a, email_a, venture_a = await tenants.make()
    org_b, email_b, _ = await tenants.make()
    h_a, h_b = headers(org_a, email_a), headers(org_b, email_b)
    async with client() as c:
        await set_password(email_b)
        cross_archive = await c.post(f"{base(venture_a)}/archive", json={"password": PASSWORD}, headers=h_b)
        assert (await archive(c, venture_a, h_a)).status_code == 204
        cross = [
            (await c.post(f"{base(venture_a)}/restore", headers=h_b)).status_code,
            (await c.get(f"{base(venture_a)}/archive/export", headers=h_b)).status_code,
            (await c.post(f"{base(venture_a)}/reauth-code", headers=h_b)).status_code,
            (
                await c.post(f"{base(venture_a)}/delete-permanently", json={"password": PASSWORD}, headers=h_b)
            ).status_code,
        ]
        b_list = (await c.get("/api/ventures/archived", headers=h_b)).json()
        signed_out = [
            (await c.get("/api/ventures/archived")).status_code,
            (await c.post(f"{base(venture_a)}/archive", json={"password": PASSWORD})).status_code,
        ]
        a_list = (await c.get("/api/ventures/archived", headers=h_a)).json()

    assert cross_archive.status_code == 404
    assert cross == [404, 404, 404, 404]
    assert b_list == []
    assert signed_out == [401, 401]
    assert [v["id"] for v in a_list] == [str(venture_a)]


def test_the_session_tells_the_ui_whether_the_user_has_a_password():
    from app.routers.auth import _session_read

    google_only = User(email="g@test.dev", display_name="G", password_hash=None)
    with_password = User(email="p@test.dev", display_name="P", password_hash="hash")
    assert _session_read(google_only, [], None).has_password is False
    assert _session_read(with_password, [], None).has_password is True
