"""Admin dashboard API: who can review sign-ups, and what approving/rejecting does.

Runs against the test database; email is captured by a fake sender.
"""

import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app.db import async_session
from app.dependencies import get_email_sender
from app.mailer import EmailSender, OutgoingEmail
from app.main import app
from app.models import AuditLog, Organization, OrganizationMember, User, Venture
from app.passwords import hash_password
from app.sessions import SESSION_COOKIE, issue_session_token
from app.tenancy import set_current_organization

PASSWORD = "correct horse battery"
IDEA = "An AI-powered cooking assistant for Korean recipes."


class FakeSender(EmailSender):
    def __init__(self, fail: bool = False) -> None:
        self.sent: list[OutgoingEmail] = []
        self.fail = fail

    def send(self, message: OutgoingEmail) -> None:
        if self.fail:
            raise OSError("SMTP down")
        self.sent.append(message)


@pytest.fixture
def mailbox():
    sender = FakeSender()
    app.dependency_overrides[get_email_sender] = lambda: sender
    yield sender
    app.dependency_overrides.pop(get_email_sender, None)


class World:
    """Users and organizations for one test, removed afterwards."""

    def __init__(self) -> None:
        self.suffix = uuid.uuid4().hex[:8]
        self.user_ids: list[uuid.UUID] = []
        self.org_ids: list[uuid.UUID] = []

    async def org(self, name: str) -> Organization:
        async with async_session() as session:
            org = Organization(name=f"{name} {self.suffix}", slug=f"{name.lower()}-{self.suffix}")
            session.add(org)
            await session.commit()
            self.org_ids.append(org.id)
            return org

    async def member(self, name: str, memberships: list[tuple[Organization, str]]) -> User:
        async with async_session() as session:
            user = User(email=f"{name}-{self.suffix}@admin.test", display_name=name.title())
            session.add(user)
            await session.flush()
            for org, role in memberships:
                session.add(OrganizationMember(organization_id=org.id, user_id=user.id, role=role))
            await session.commit()
            self.user_ids.append(user.id)
            return user

    async def applicant(self, name: str, *, verified: bool = True, status: str = "pending") -> User:
        async with async_session() as session:
            user = User(
                email=f"{name}-{self.suffix}@applicant.test",
                display_name=name.title(),
                password_hash=hash_password(PASSWORD),
                account_status=status,
                email_verified_at=datetime.now(UTC) if verified else None,
                affiliation="external_founder",
                affiliation_name="Acme Labs",
                department="Engineering",
                preferred_language="ko",
                access_reason="Validate my venture idea for the pilot.",
            )
            session.add(user)
            await session.commit()
            self.user_ids.append(user.id)
            return user

    async def cleanup(self) -> None:
        async with async_session() as session:
            for org_id in self.org_ids:
                await set_current_organization(session, org_id)
                await session.execute(delete(Venture).where(Venture.organization_id == org_id))
            await session.execute(
                delete(OrganizationMember).where(OrganizationMember.user_id.in_(self.user_ids))
            )
            await session.execute(delete(User).where(User.id.in_(self.user_ids)))
            await session.execute(delete(Organization).where(Organization.id.in_(self.org_ids)))
            await session.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def world():
    w = World()
    yield w
    await w.cleanup()


def client_for(user: User | None = None, org: Organization | None = None) -> AsyncClient:
    c = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    if user is not None:
        c.cookies.set(SESSION_COOKIE, issue_session_token(user.id, org.id if org else None))
    return c


async def reload(user: User) -> User:
    async with async_session() as session:
        return await session.get(User, user.id)


async def memberships(user: User) -> list[tuple[uuid.UUID, str]]:
    async with async_session() as session:
        rows = await session.execute(
            select(OrganizationMember.organization_id, OrganizationMember.role).where(
                OrganizationMember.user_id == user.id
            )
        )
        return list(rows.all())


# --- Access -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_signed_out_is_401_and_plain_member_is_403(world, mailbox):
    org = await world.org("Woosong")
    member = await world.member("member", [(org, "member")])

    async with client_for() as c:
        assert (await c.get("/api/admin/signups")).status_code == 401
    async with client_for(member, org) as c:
        for path in ("/api/admin/signups", "/api/admin/organizations"):
            response = await c.get(path)
            assert response.status_code == 403
            assert response.json()["detail"] == "Admin access required"


@pytest.mark.asyncio
async def test_inactive_admin_is_refused(world, mailbox):
    org = await world.org("Woosong")
    admin = await world.member("admin", [(org, "owner")])
    async with async_session() as session:
        stored = await session.get(User, admin.id)
        stored.account_status = "disabled"
        await session.commit()

    async with client_for(admin, org) as c:
        assert (await c.get("/api/admin/signups")).status_code == 401


@pytest.mark.asyncio
async def test_admin_organizations_and_grantable_roles(world, mailbox):
    org_a = await world.org("Alpha")
    org_b = await world.org("Beta")
    org_c = await world.org("Gamma")
    admin = await world.member("admin", [(org_a, "owner"), (org_b, "admin"), (org_c, "member")])

    async with client_for(admin, org_a) as c:
        response = await c.get("/api/admin/organizations")
    assert response.status_code == 200
    assert {o["slug"]: o["grantable_roles"] for o in response.json()} == {
        org_a.slug: ["member", "admin", "owner"],
        org_b.slug: ["member", "admin"],
    }


# --- Listing ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_pending_list_shows_only_verified_pending_signups(world, mailbox):
    org = await world.org("Woosong")
    admin = await world.member("admin", [(org, "admin")])
    verified = await world.applicant("verified")
    unverified = await world.applicant("unverified", verified=False)

    async with client_for(admin, org) as c:
        response = await c.get("/api/admin/signups", params={"status": "pending"})
    emails = [item["email"] for item in response.json()]
    assert verified.email in emails
    assert unverified.email not in emails
    assert admin.email not in emails

    item = next(i for i in response.json() if i["email"] == verified.email)
    assert item == {
        **item,
        "full_name": "Verified",
        "affiliation": "external_founder",
        "affiliation_name": "Acme Labs",
        "department": "Engineering",
        "preferred_language": "ko",
        "access_reason": "Validate my venture idea for the pilot.",
        "status": "pending",
        "reviewed_by": None,
        "organizations": [],
    }


# --- Approve ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_approve_activates_user_in_chosen_org_audits_and_emails(world, mailbox):
    org = await world.org("Woosong")
    other_org = await world.org("Other")
    admin = await world.member("admin", [(org, "admin"), (other_org, "admin")])
    applicant = await world.applicant("newbie")

    async with client_for(admin, org) as c:
        response = await c.post(
            f"/api/admin/signups/{applicant.id}/approve",
            json={"organization_slug": org.slug, "role": "member"},
        )
        assert response.status_code == 200
        assert response.json() == {"status": "approved", "email_sent": True}

        history = (await c.get("/api/admin/signups", params={"status": "approved"})).json()

    stored = await reload(applicant)
    assert stored.account_status == "active"
    assert stored.reviewed_by_user_id == admin.id and stored.reviewed_at is not None
    assert await memberships(applicant) == [(org.id, "member")]  # only the chosen org
    assert mailbox.sent[-1].to == applicant.email
    assert mailbox.sent[-1].subject == "WEEAIM 계정이 승인되었습니다"  # applicant prefers Korean

    entry = next(i for i in history if i["email"] == applicant.email)
    assert entry["reviewed_by"] == admin.email
    assert entry["organizations"] == [org.name]

    async with async_session() as session:
        await set_current_organization(session, org.id)
        audit = (
            await session.execute(
                select(AuditLog).where(
                    AuditLog.resource_id == applicant.id, AuditLog.action == "signup.approved"
                )
            )
        ).scalar_one()
    assert audit.organization_id == org.id and audit.actor_user_id == admin.id

    # The approved user can now sign in and work in that organization.
    async with client_for() as c:
        login = await c.post("/api/auth/login", json={"email": applicant.email, "password": PASSWORD})
        assert login.status_code == 200
        assert [o["slug"] for o in login.json()["organizations"]] == [org.slug]
        assert (await c.post("/api/ventures", json={"idea": IDEA})).status_code == 201


@pytest.mark.asyncio
async def test_cannot_approve_into_an_org_you_dont_administer(world, mailbox):
    org_a = await world.org("Alpha")
    org_b = await world.org("Beta")
    admin = await world.member("admin", [(org_a, "admin"), (org_b, "member")])
    outsider_org = await world.org("Gamma")
    applicant = await world.applicant("applicant")

    async with client_for(admin, org_a) as c:
        for slug in (org_b.slug, outsider_org.slug, "no-such-org"):
            response = await c.post(
                f"/api/admin/signups/{applicant.id}/approve",
                json={"organization_slug": slug, "role": "member"},
            )
            assert response.status_code == 403

    assert (await reload(applicant)).account_status == "pending"
    assert await memberships(applicant) == []
    assert mailbox.sent == []


@pytest.mark.asyncio
async def test_only_owners_can_grant_owner(world, mailbox):
    org = await world.org("Woosong")
    admin = await world.member("admin", [(org, "admin")])
    owner = await world.member("owner", [(org, "owner")])
    first = await world.applicant("first")
    second = await world.applicant("second")

    async with client_for(admin, org) as c:
        denied = await c.post(
            f"/api/admin/signups/{first.id}/approve",
            json={"organization_slug": org.slug, "role": "owner"},
        )
        assert denied.status_code == 403
        assert (
            await c.post(
                f"/api/admin/signups/{first.id}/approve",
                json={"organization_slug": org.slug, "role": "admin"},
            )
        ).status_code == 200

    async with client_for(owner, org) as c:
        assert (
            await c.post(
                f"/api/admin/signups/{second.id}/approve",
                json={"organization_slug": org.slug, "role": "owner"},
            )
        ).status_code == 200

    assert await memberships(first) == [(org.id, "admin")]
    assert await memberships(second) == [(org.id, "owner")]


@pytest.mark.asyncio
async def test_second_review_of_same_signup_is_409(world, mailbox):
    org = await world.org("Woosong")
    admin_one = await world.member("adminone", [(org, "admin")])
    admin_two = await world.member("admintwo", [(org, "admin")])
    applicant = await world.applicant("contested")

    async with client_for(admin_one, org) as c:
        assert (
            await c.post(
                f"/api/admin/signups/{applicant.id}/approve",
                json={"organization_slug": org.slug},
            )
        ).status_code == 200
    async with client_for(admin_two, org) as c:
        again = await c.post(
            f"/api/admin/signups/{applicant.id}/approve", json={"organization_slug": org.slug}
        )
        reject = await c.post(f"/api/admin/signups/{applicant.id}/reject", json={})
        missing = await c.post(f"/api/admin/signups/{uuid.uuid4()}/reject", json={})
    assert (again.status_code, again.json()["detail"]) == (409, "already_reviewed")
    assert reject.status_code == 409
    assert missing.status_code == 404
    assert (await reload(applicant)).account_status == "active"


@pytest.mark.asyncio
async def test_unverified_signup_cannot_be_approved(world, mailbox):
    org = await world.org("Woosong")
    admin = await world.member("admin", [(org, "owner")])
    applicant = await world.applicant("early", verified=False)

    async with client_for(admin, org) as c:
        response = await c.post(
            f"/api/admin/signups/{applicant.id}/approve", json={"organization_slug": org.slug}
        )
    assert response.status_code == 422
    assert (await reload(applicant)).account_status == "pending"


# --- Reject -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_reject_records_note_emails_and_blocks_sign_in(world, mailbox):
    org = await world.org("Woosong")
    admin = await world.member("admin", [(org, "admin")])
    applicant = await world.applicant("declined")

    async with client_for(admin, org) as c:
        response = await c.post(
            f"/api/admin/signups/{applicant.id}/reject",
            json={"note": "  Pilot is limited to Woosong students.  "},
        )
        assert response.json() == {"status": "rejected", "email_sent": True}
        history = (await c.get("/api/admin/signups", params={"status": "rejected"})).json()

    stored = await reload(applicant)
    assert stored.account_status == "rejected"
    assert stored.review_note == "Pilot is limited to Woosong students."
    assert stored.reviewed_by_user_id == admin.id
    assert "Pilot is limited to Woosong students." in mailbox.sent[-1].body
    entry = next(i for i in history if i["email"] == applicant.email)
    assert (entry["reviewed_by"], entry["review_note"]) == (admin.email, stored.review_note)

    async with client_for() as c:
        login = await c.post("/api/auth/login", json={"email": applicant.email, "password": PASSWORD})
    assert (login.status_code, login.json()["detail"]) == (403, "account_disabled")


@pytest.mark.asyncio
async def test_email_failure_keeps_the_decision(world):
    org = await world.org("Woosong")
    admin = await world.member("admin", [(org, "admin")])
    applicant = await world.applicant("nomail")
    app.dependency_overrides[get_email_sender] = lambda: FakeSender(fail=True)
    try:
        async with client_for(admin, org) as c:
            response = await c.post(
                f"/api/admin/signups/{applicant.id}/approve", json={"organization_slug": org.slug}
            )
    finally:
        app.dependency_overrides.pop(get_email_sender, None)
    assert response.json() == {"status": "approved", "email_sent": False}
    assert (await reload(applicant)).account_status == "active"


# --- Tenant isolation ---------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_of_one_org_cannot_place_users_in_another(world, mailbox):
    org_a = await world.org("Alpha")
    org_b = await world.org("Beta")
    admin_a = await world.member("admina", [(org_a, "owner")])
    owner_b = await world.member("ownerb", [(org_b, "owner")])
    applicant = await world.applicant("newcomer")

    async with client_for(owner_b, org_b) as c:
        venture_b = (await c.post("/api/ventures", json={"idea": IDEA})).json()["id"]

    async with client_for(admin_a, org_a) as c:
        into_b = await c.post(
            f"/api/admin/signups/{applicant.id}/approve", json={"organization_slug": org_b.slug}
        )
        assert into_b.status_code == 403
        assert (
            await c.post(
                f"/api/admin/signups/{applicant.id}/approve", json={"organization_slug": org_a.slug}
            )
        ).status_code == 200

    async with client_for() as c:
        await c.post("/api/auth/login", json={"email": applicant.email, "password": PASSWORD})
        assert (await c.get(f"/api/ventures/{venture_b}/stages")).status_code == 404
        assert (
            await c.post("/api/auth/select-organization", json={"slug": org_b.slug})
        ).status_code == 403
