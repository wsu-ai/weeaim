"""Self-service sign-up: register -> verify email -> admin approval -> sign in.

Runs against the test database (see conftest.py). Email is captured by a
fake sender instead of being sent.
"""

import re
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select, update

from app import config
from app.db import async_session
from app.dependencies import get_email_sender
from app.mailer import EmailSender, OutgoingEmail
from app.main import app
from app.models import EmailCode, Organization, OrganizationMember, User, UserConsent, Venture
from app.tenancy import set_current_organization
from scripts import manage_signups

PASSWORD = "correct horse battery"
IDEA = "An AI-powered cooking assistant for Korean recipes."


class FakeSender(EmailSender):
    def __init__(self) -> None:
        self.sent: list[OutgoingEmail] = []

    def send(self, message: OutgoingEmail) -> None:
        self.sent.append(message)

    def last_code(self, to: str) -> str:
        for message in reversed(self.sent):
            if message.to == to and (match := re.search(r"\b(\d{6})\b", message.body)):
                return match.group(1)
        raise AssertionError(f"No code emailed to {to}")


@pytest.fixture
def mailbox():
    sender = FakeSender()
    app.dependency_overrides[get_email_sender] = lambda: sender
    yield sender
    app.dependency_overrides.pop(get_email_sender, None)


class Cleanup:
    def __init__(self) -> None:
        self.suffix = uuid.uuid4().hex[:8]
        self.emails: list[str] = []
        self.org_ids: list[uuid.UUID] = []

    def email(self, name: str) -> str:
        address = f"{name}-{self.suffix}@signup.test"
        self.emails.append(address)
        return address

    async def org(self, name: str) -> Organization:
        async with async_session() as session:
            org = Organization(name=f"{name} {self.suffix}", slug=f"{name.lower()}-{self.suffix}")
            session.add(org)
            await session.commit()
            self.org_ids.append(org.id)
            return org

    async def run(self) -> None:
        async with async_session() as session:
            for org_id in self.org_ids:
                await set_current_organization(session, org_id)
                await session.execute(delete(Venture).where(Venture.organization_id == org_id))
            user_ids = select(User.id).where(User.email.in_(self.emails))
            await session.execute(
                delete(OrganizationMember).where(OrganizationMember.user_id.in_(user_ids))
            )
            await session.execute(delete(User).where(User.email.in_(self.emails)))
            await session.execute(delete(Organization).where(Organization.id.in_(self.org_ids)))
            await session.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def cleanup():
    c = Cleanup()
    yield c
    await c.run()


def client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def signup_body(address: str, **overrides) -> dict:
    return {
        "full_name": "Kim Minji",
        "email": address,
        "password": PASSWORD,
        "affiliation": "woosong_student",
        "affiliation_name": None,
        "department": "Technology Management",
        "preferred_language": "en",
        "access_reason": "Validate my startup idea for a class project.",
        "accept_terms": True,
        "accept_privacy": True,
        "accept_ai_processing": True,
        **overrides,
    }


async def get_user(email: str) -> User | None:
    async with async_session() as session:
        return (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()


async def register_and_verify(c: AsyncClient, mailbox: FakeSender, email: str) -> None:
    assert (await c.post("/api/auth/signup", json=signup_body(email))).status_code == 202
    verified = await c.post(
        "/api/auth/verify-email",
        json={"email": email, "code": mailbox.last_code(email), "password": PASSWORD},
    )
    assert verified.status_code == 200
    assert verified.json() == {"status": "pending_approval"}


async def approve(mailbox: FakeSender, email: str, org: Organization) -> None:
    async with async_session() as session:
        await manage_signups.approve(session, mailbox, email, org.slug)


# --- Sign-up ------------------------------------------------------------


@pytest.mark.asyncio
async def test_signup_creates_pending_user_with_hashed_password_and_consents(mailbox, cleanup):
    email = cleanup.email("minji")
    async with client() as c:
        response = await c.post("/api/auth/signup", json=signup_body(email.upper()))
    assert response.status_code == 202
    assert response.json() == {"status": "accepted"}

    user = await get_user(email)  # stored lower-cased
    assert user.account_status == "pending"
    assert user.email_verified_at is None
    assert user.display_name == "Kim Minji"
    assert user.affiliation_name == "Woosong University"
    assert user.password_hash.startswith("$argon2id$")
    assert PASSWORD not in user.password_hash

    async with async_session() as session:
        consents = (
            await session.execute(select(UserConsent).where(UserConsent.user_id == user.id))
        ).scalars().all()
        codes = (
            await session.execute(select(EmailCode).where(EmailCode.user_id == user.id))
        ).scalars().all()
    assert {c.consent_type for c in consents} == {"terms", "privacy", "ai_processing"}
    assert all(c.policy_version for c in consents)
    code = mailbox.last_code(email)
    assert len(codes) == 1 and code not in codes[0].code_hash


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"accept_privacy": False},
        {"accept_terms": False},
        {"accept_ai_processing": False},
        {"affiliation": "external_founder", "affiliation_name": None},
        {"affiliation": "astronaut"},
        {"access_reason": "short"},
        {"full_name": " "},
        {"email": "not-an-email"},
        {"preferred_language": "fr"},
    ],
)
async def test_signup_rejects_invalid_fields(mailbox, cleanup, overrides):
    email = cleanup.email("invalid")
    async with client() as c:
        response = await c.post("/api/auth/signup", json=signup_body(email, **overrides))
    assert response.status_code == 422
    assert await get_user(email) is None
    assert mailbox.sent == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("password", "problem"),
    [("short", "password_too_short"), ("x" * 129, "password_too_long"), ("{local}-rocks!!", "password_contains_email")],
)
async def test_signup_enforces_password_policy(mailbox, cleanup, password, problem):
    email = cleanup.email("minji")
    password = password.format(local=email.split("@")[0].upper())
    async with client() as c:
        response = await c.post("/api/auth/signup", json=signup_body(email, password=password))
    assert response.status_code == 422
    assert response.json()["detail"] == problem


@pytest.mark.asyncio
async def test_external_affiliation_keeps_its_organization_name(mailbox, cleanup):
    email = cleanup.email("founder")
    body = signup_body(email, affiliation="external_founder", affiliation_name="Acme Labs")
    async with client() as c:
        assert (await c.post("/api/auth/signup", json=body)).status_code == 202
    assert (await get_user(email)).affiliation_name == "Acme Labs"


@pytest.mark.asyncio
async def test_signup_with_registered_email_reveals_nothing_and_alerts_owner(mailbox, cleanup):
    email = cleanup.email("owner")
    async with client() as c:
        await register_and_verify(c, mailbox, email)
        mailbox.sent.clear()
        again = await c.post(
            "/api/auth/signup", json=signup_body(email, full_name="Impostor", password="another password!")
        )
    assert again.status_code == 202
    assert again.json() == {"status": "accepted"}
    assert [m.subject for m in mailbox.sent] == ["WEEAIM sign-up attempt"]
    user = await get_user(email)
    assert user.display_name == "Kim Minji"  # unchanged


@pytest.mark.asyncio
async def test_unverified_signup_is_replaced_and_old_code_stops_working(mailbox, cleanup):
    email = cleanup.email("redo")
    async with client() as c:
        await c.post("/api/auth/signup", json=signup_body(email, password="first password!!"))
        first_code = mailbox.last_code(email)
        async with async_session() as session:  # skip the resend cooldown
            await session.execute(
                update(EmailCode)
                .where(EmailCode.user_id == (await get_user(email)).id)
                .values(created_at=datetime.now(UTC) - timedelta(minutes=5))
            )
            await session.commit()
        await c.post("/api/auth/signup", json=signup_body(email, full_name="Kim Minji Updated"))
        second_code = mailbox.last_code(email)

        stale = await c.post(
            "/api/auth/verify-email",
            json={"email": email, "code": first_code, "password": "first password!!"},
        )
        assert stale.status_code == 400  # old password no longer matches

        ok = await c.post(
            "/api/auth/verify-email",
            json={"email": email, "code": second_code, "password": PASSWORD},
        )
        assert ok.status_code == 200
    assert (await get_user(email)).display_name == "Kim Minji Updated"


# --- Email verification ---------------------------------------------------


@pytest.mark.asyncio
async def test_verification_requires_the_right_code_and_password(mailbox, cleanup):
    email = cleanup.email("verify")
    async with client() as c:
        await c.post("/api/auth/signup", json=signup_body(email))
        code = mailbox.last_code(email)
        wrong_code = "000000" if code != "000000" else "111111"

        bad_code = await c.post(
            "/api/auth/verify-email", json={"email": email, "code": wrong_code, "password": PASSWORD}
        )
        bad_password = await c.post(
            "/api/auth/verify-email", json={"email": email, "code": code, "password": "wrong password!"}
        )
        unknown = await c.post(
            "/api/auth/verify-email",
            json={"email": cleanup.email("ghost"), "code": code, "password": PASSWORD},
        )
        assert {r.status_code for r in (bad_code, bad_password, unknown)} == {400}
        assert {r.json()["detail"] for r in (bad_code, bad_password, unknown)} == {"invalid_code"}
        assert (await get_user(email)).email_verified_at is None

        ok = await c.post(
            "/api/auth/verify-email", json={"email": email, "code": code, "password": PASSWORD}
        )
        assert ok.status_code == 200
        reused = await c.post(
            "/api/auth/verify-email", json={"email": email, "code": code, "password": PASSWORD}
        )
        assert reused.status_code == 400
    assert (await get_user(email)).email_verified_at is not None


@pytest.mark.asyncio
async def test_code_locks_after_too_many_wrong_guesses(mailbox, cleanup):
    email = cleanup.email("guess")
    async with client() as c:
        await c.post("/api/auth/signup", json=signup_body(email))
        code = mailbox.last_code(email)
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(config.settings.email_code_max_attempts):
            await c.post("/api/auth/verify-email", json={"email": email, "code": wrong, "password": PASSWORD})
        right = await c.post(
            "/api/auth/verify-email", json={"email": email, "code": code, "password": PASSWORD}
        )
    assert right.status_code == 400


@pytest.mark.asyncio
async def test_expired_code_is_rejected(mailbox, cleanup):
    email = cleanup.email("expired")
    async with client() as c:
        await c.post("/api/auth/signup", json=signup_body(email))
        code = mailbox.last_code(email)
        async with async_session() as session:
            await session.execute(
                update(EmailCode)
                .where(EmailCode.user_id == (await get_user(email)).id)
                .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )
            await session.commit()
        response = await c.post(
            "/api/auth/verify-email", json={"email": email, "code": code, "password": PASSWORD}
        )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_resend_is_rate_limited_and_replaces_the_code(mailbox, cleanup):
    email = cleanup.email("resend")
    async with client() as c:
        await c.post("/api/auth/signup", json=signup_body(email))
        first = mailbox.last_code(email)
        too_soon = await c.post("/api/auth/resend-verification", json={"email": email})
        assert too_soon.status_code == 202
        assert len(mailbox.sent) == 1  # nothing new sent within the cooldown

        async with async_session() as session:
            await session.execute(
                update(EmailCode)
                .where(EmailCode.user_id == (await get_user(email)).id)
                .values(created_at=datetime.now(UTC) - timedelta(minutes=5))
            )
            await session.commit()
        await c.post("/api/auth/resend-verification", json={"email": email})
        assert len(mailbox.sent) == 2
        second = mailbox.last_code(email)

        if first != second:
            old = await c.post(
                "/api/auth/verify-email", json={"email": email, "code": first, "password": PASSWORD}
            )
            assert old.status_code == 400
        ok = await c.post(
            "/api/auth/verify-email", json={"email": email, "code": second, "password": PASSWORD}
        )
        assert ok.status_code == 200

        # Unknown and already-verified addresses get the same answer, no email.
        mailbox.sent.clear()
        for address in (email, cleanup.email("nobody")):
            assert (await c.post("/api/auth/resend-verification", json={"email": address})).status_code == 202
        assert mailbox.sent == []


# --- Password sign-in -----------------------------------------------------


@pytest.mark.asyncio
async def test_login_reports_each_stage_until_approved(mailbox, cleanup):
    org = await cleanup.org("Woosong")
    email = cleanup.email("stages")
    login = {"email": email, "password": PASSWORD}
    async with client() as c:
        await c.post("/api/auth/signup", json=signup_body(email))
        unverified = await c.post("/api/auth/login", json=login)
        assert (unverified.status_code, unverified.json()["detail"]) == (403, "email_not_verified")

        await c.post(
            "/api/auth/verify-email",
            json={"email": email, "code": mailbox.last_code(email), "password": PASSWORD},
        )
        pending = await c.post("/api/auth/login", json=login)
        assert (pending.status_code, pending.json()["detail"]) == (403, "pending_approval")
        assert "set-cookie" not in pending.headers

        await approve(mailbox, email, org)
        assert mailbox.sent[-1].subject == "Your WEEAIM account is approved"

        approved = await c.post("/api/auth/login", json={**login, "email": email.upper()})
        assert approved.status_code == 200
        assert approved.json()["active_organization"] == org.slug
        assert "httponly" in approved.headers["set-cookie"].lower()
        created = await c.post("/api/ventures", json={"idea": IDEA})
        assert created.status_code == 201
        assert created.json()["organization_id"] == str(org.id)


@pytest.mark.asyncio
async def test_wrong_password_and_unknown_email_look_the_same(mailbox, cleanup):
    org = await cleanup.org("Woosong")
    email = cleanup.email("same")
    async with client() as c:
        await register_and_verify(c, mailbox, email)
        await approve(mailbox, email, org)
        wrong = await c.post("/api/auth/login", json={"email": email, "password": "not my password"})
        unknown = await c.post(
            "/api/auth/login", json={"email": cleanup.email("nobody"), "password": PASSWORD}
        )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


@pytest.mark.asyncio
async def test_account_locks_after_repeated_failures(mailbox, cleanup, monkeypatch):
    org = await cleanup.org("Woosong")
    email = cleanup.email("lock")
    async with client() as c:
        await register_and_verify(c, mailbox, email)
        await approve(mailbox, email, org)
        for _ in range(config.settings.login_max_failed_attempts):
            assert (
                await c.post("/api/auth/login", json={"email": email, "password": "bad password!"})
            ).status_code == 401
        locked = await c.post("/api/auth/login", json={"email": email, "password": PASSWORD})
        assert (locked.status_code, locked.json()["detail"]) == (429, "too_many_attempts")

        async with async_session() as session:
            await session.execute(
                update(User)
                .where(User.email == email)
                .values(locked_until=datetime.now(UTC) - timedelta(seconds=1))
            )
            await session.commit()
        unlocked = await c.post("/api/auth/login", json={"email": email, "password": PASSWORD})
        assert unlocked.status_code == 200


@pytest.mark.asyncio
async def test_rejected_and_disabled_accounts_cannot_sign_in(mailbox, cleanup):
    org = await cleanup.org("Woosong")
    rejected = cleanup.email("rejected")
    disabled = cleanup.email("disabled")
    async with client() as c:
        await register_and_verify(c, mailbox, rejected)
        async with async_session() as session:
            await manage_signups.reject(session, mailbox, rejected, "Not eligible")
        assert "Not eligible" in mailbox.sent[-1].body
        response = await c.post("/api/auth/login", json={"email": rejected, "password": PASSWORD})
        assert (response.status_code, response.json()["detail"]) == (403, "account_disabled")

        await register_and_verify(c, mailbox, disabled)
        await approve(mailbox, disabled, org)
        assert (await c.post("/api/auth/login", json={"email": disabled, "password": PASSWORD})).status_code == 200
        assert (await c.post("/api/ventures", json={"idea": IDEA})).status_code == 201

        async with async_session() as session:
            await session.execute(
                update(User).where(User.email == disabled).values(account_status="disabled")
            )
            await session.commit()
        # The existing session stops working immediately...
        assert (await c.post("/api/ventures", json={"idea": IDEA})).status_code == 401
        assert (await c.get("/api/auth/me")).status_code == 401
        # ...and signing in again is refused.
        again = await c.post("/api/auth/login", json={"email": disabled, "password": PASSWORD})
        assert (again.status_code, again.json()["detail"]) == (403, "account_disabled")


# --- Approval and tenant isolation ------------------------------------------


@pytest.mark.asyncio
async def test_approval_grants_only_the_chosen_organization(mailbox, cleanup):
    org_a = await cleanup.org("Alpha")
    org_b = await cleanup.org("Beta")
    owner_b = cleanup.email("ownerb")
    newcomer = cleanup.email("newcomer")

    async with client() as c_b:
        await register_and_verify(c_b, mailbox, owner_b)
        await approve(mailbox, owner_b, org_b)
        await c_b.post("/api/auth/login", json={"email": owner_b, "password": PASSWORD})
        venture_b = (await c_b.post("/api/ventures", json={"idea": IDEA})).json()["id"]

    async with client() as c:
        await register_and_verify(c, mailbox, newcomer)
        # Pending: no session, no organization, no data.
        assert (await c.get(f"/api/ventures/{venture_b}/stages")).status_code == 401

        await approve(mailbox, newcomer, org_a)
        login = await c.post("/api/auth/login", json={"email": newcomer, "password": PASSWORD})
        assert [o["slug"] for o in login.json()["organizations"]] == [org_a.slug]
        assert (await c.get(f"/api/ventures/{venture_b}/stages")).status_code == 404
        switch = await c.post("/api/auth/select-organization", json={"slug": org_b.slug})
        assert switch.status_code == 403


@pytest.mark.asyncio
async def test_approval_requires_a_verified_pending_signup(mailbox, cleanup):
    org = await cleanup.org("Woosong")
    email = cleanup.email("early")
    async with client() as c:
        await c.post("/api/auth/signup", json=signup_body(email))
    async with async_session() as session:
        with pytest.raises(manage_signups.SignupError, match="verified"):
            await manage_signups.approve(session, mailbox, email, org.slug)
        assert email not in [p.email for p in await manage_signups.list_pending(session)]

    verified = cleanup.email("verified")
    async with client() as c:
        await register_and_verify(c, mailbox, verified)
    async with async_session() as session:
        with pytest.raises(manage_signups.SignupError, match="doesn't exist"):
            await manage_signups.approve(session, mailbox, verified, "no-such-org")
        with pytest.raises(manage_signups.SignupError, match="Role"):
            await manage_signups.approve(session, mailbox, verified, org.slug, role="superuser")
    assert (await get_user(verified)).account_status == "pending"


@pytest.mark.asyncio
async def test_list_pending_shows_verified_signups(mailbox, cleanup):
    email = cleanup.email("listed")
    async with client() as c:
        await register_and_verify(c, mailbox, email)
    async with async_session() as session:
        pending = {p.email: p for p in await manage_signups.list_pending(session)}
    assert pending[email].full_name == "Kim Minji"
    assert pending[email].access_reason == "Validate my startup idea for a class project."


# --- Password reset ------------------------------------------------------


@pytest.mark.asyncio
async def test_password_reset_flow(mailbox, cleanup):
    org = await cleanup.org("Woosong")
    email = cleanup.email("reset")
    new_password = "a brand new passphrase"
    async with client() as c:
        await register_and_verify(c, mailbox, email)
        await approve(mailbox, email, org)
        async with async_session() as session:  # also clears a lockout
            await session.execute(
                update(User).where(User.email == email).values(
                    locked_until=datetime.now(UTC) + timedelta(minutes=10)
                )
            )
            await session.commit()

        assert (await c.post("/api/auth/forgot-password", json={"email": email})).status_code == 202
        code = mailbox.last_code(email)
        assert mailbox.sent[-1].subject == "Your WEEAIM password reset code"

        weak = await c.post(
            "/api/auth/reset-password", json={"email": email, "code": code, "new_password": "short"}
        )
        assert weak.status_code == 422
        reset = await c.post(
            "/api/auth/reset-password", json={"email": email, "code": code, "new_password": new_password}
        )
        assert reset.status_code == 200
        reused = await c.post(
            "/api/auth/reset-password", json={"email": email, "code": code, "new_password": "yet another phrase"}
        )
        assert reused.status_code == 400

        assert (await c.post("/api/auth/login", json={"email": email, "password": PASSWORD})).status_code == 401
        assert (await c.post("/api/auth/login", json={"email": email, "password": new_password})).status_code == 200


@pytest.mark.asyncio
async def test_forgot_password_never_reveals_accounts(mailbox, cleanup):
    unverified = cleanup.email("unverified")
    async with client() as c:
        await c.post("/api/auth/signup", json=signup_body(unverified))
        mailbox.sent.clear()
        for address in (cleanup.email("nobody"), unverified):
            response = await c.post("/api/auth/forgot-password", json={"email": address})
            assert (response.status_code, response.json()) == (202, {"status": "accepted"})
    assert mailbox.sent == []


# --- Interaction with Google sign-in ---------------------------------------


@pytest.mark.asyncio
async def test_google_sign_in_reports_pending_approval(mailbox, cleanup):
    from app.dependencies import get_google_verifier
    from app.google_auth import GoogleTokenVerifier
    from tests.test_google_auth import CLIENT_ID, GOOGLE_KEY, google_token

    app.dependency_overrides[get_google_verifier] = lambda: GoogleTokenVerifier(
        client_id=CLIENT_ID, key_resolver=lambda _t: GOOGLE_KEY.public_key()
    )
    email = cleanup.email("googler")
    try:
        async with client() as c:
            await register_and_verify(c, mailbox, email)
            response = await c.post(
                "/api/auth/google",
                json={"credential": google_token(f"sub-{cleanup.suffix}", email)},
            )
        assert (response.status_code, response.json()["detail"]) == (403, "pending_approval")
    finally:
        app.dependency_overrides.pop(get_google_verifier, None)


@pytest.mark.asyncio
async def test_email_failure_is_reported_as_503(cleanup):
    class BrokenSender(EmailSender):
        def send(self, message: OutgoingEmail) -> None:
            raise OSError("SMTP server unreachable")

    app.dependency_overrides[get_email_sender] = lambda: BrokenSender()
    try:
        async with client() as c:
            response = await c.post("/api/auth/signup", json=signup_body(cleanup.email("nomail")))
        assert response.status_code == 503
    finally:
        app.dependency_overrides.pop(get_email_sender, None)
