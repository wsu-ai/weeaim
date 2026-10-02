"""Sign in with Google + session cookies.

Never calls Google: ID tokens are signed with an RSA key generated here,
and the verifier is given that key's public half (see GoogleTokenVerifier).
"""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
import pytest_asyncio
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app import config
from app.db import async_session
from app.dependencies import get_google_verifier
from app.google_auth import GoogleTokenVerifier
from app.main import app
from app.models import Organization, OrganizationMember, User, Venture
from app.sessions import SESSION_COOKIE, issue_session_token
from app.tenancy import set_current_organization

CLIENT_ID = "test-client.apps.googleusercontent.com"
GOOGLE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
IDEA = "An AI-powered cooking assistant for Korean recipes."


def google_token(
    sub: str,
    email: str,
    *,
    aud: str = CLIENT_ID,
    iss: str = "https://accounts.google.com",
    email_verified: object = True,
    expires_in: int = 3600,
    key=GOOGLE_KEY,
) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": sub,
            "email": email,
            "email_verified": email_verified,
            "name": "Google Name",
            "aud": aud,
            "iss": iss,
            "iat": now,
            "exp": now + timedelta(seconds=expires_in),
        },
        key,
        algorithm="RS256",
    )


@pytest.fixture(autouse=True)
def fake_google():
    public_key = GOOGLE_KEY.public_key()
    app.dependency_overrides[get_google_verifier] = lambda: GoogleTokenVerifier(
        client_id=CLIENT_ID, key_resolver=lambda _token: public_key
    )
    yield
    app.dependency_overrides.pop(get_google_verifier, None)


class Tenants:
    """Creates users/orgs for one test and removes everything afterwards."""

    def __init__(self) -> None:
        self.suffix = uuid.uuid4().hex[:8]
        self.org_ids: list[uuid.UUID] = []
        self.user_ids: list[uuid.UUID] = []

    async def org(self, name: str) -> Organization:
        async with async_session() as session:
            org = Organization(name=f"{name} {self.suffix}", slug=f"{name.lower()}-{self.suffix}")
            session.add(org)
            await session.commit()
            self.org_ids.append(org.id)
            return org

    async def user(
        self, name: str, orgs: list[Organization], google_subject: str | None = None
    ) -> User:
        async with async_session() as session:
            user = User(
                email=f"{name}-{self.suffix}@test.dev",
                display_name=None,
                google_subject=google_subject,
            )
            session.add(user)
            await session.flush()
            for org in orgs:
                session.add(
                    OrganizationMember(organization_id=org.id, user_id=user.id, role="member")
                )
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
async def tenants():
    t = Tenants()
    yield t
    await t.cleanup()


def client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def google_login(c: AsyncClient, token: str):
    return await c.post("/api/auth/google", json={"credential": token})


@pytest.mark.asyncio
async def test_google_login_sets_cookie_links_account_and_authorizes(tenants):
    org = await tenants.org("Woosong")
    user = await tenants.user("alice", [org])

    async with client() as c:
        response = await google_login(c, google_token(f"google-sub-alice-{tenants.suffix}", user.email))
        assert response.status_code == 200
        body = response.json()
        assert body["email"] == user.email
        assert body["active_organization"] == org.slug
        set_cookie = response.headers["set-cookie"].lower()
        assert f"{SESSION_COOKIE}=" in set_cookie
        assert "httponly" in set_cookie
        assert "samesite=lax" in set_cookie

        # The cookie alone (no dev headers) authorizes API calls.
        created = await c.post("/api/ventures", json={"idea": IDEA})
        assert created.status_code == 201
        assert created.json()["organization_id"] == str(org.id)

        me = await c.get("/api/auth/me")
        assert me.status_code == 200
        assert me.json()["display_name"] == "Google Name"

    async with async_session() as session:
        stored = await session.get(User, user.id)
        assert stored.google_subject == f"google-sub-alice-{tenants.suffix}"


@pytest.mark.asyncio
async def test_google_login_matches_email_case_insensitively(tenants):
    org = await tenants.org("Woosong")
    user = await tenants.user("bob", [org])

    async with client() as c:
        response = await google_login(c, google_token(f"google-sub-bob-{tenants.suffix}", user.email.upper()))
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_linked_account_is_matched_by_subject_not_email(tenants):
    org = await tenants.org("Woosong")
    await tenants.user("carol", [org], google_subject=f"google-sub-carol-{tenants.suffix}")

    async with client() as c:
        # Same Google account, but its email has since changed.
        response = await google_login(
            c, google_token(f"google-sub-carol-{tenants.suffix}", "carol-renamed@elsewhere.dev")
        )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_email_linked_to_another_google_account_is_refused(tenants):
    org = await tenants.org("Woosong")
    user = await tenants.user("dave", [org], google_subject=f"google-sub-original-{tenants.suffix}")

    async with client() as c:
        response = await google_login(c, google_token(f"google-sub-someone-else-{tenants.suffix}", user.email))
    assert response.status_code == 403
    assert response.json()["detail"] == "This account has not been invited"
    assert SESSION_COOKIE not in response.headers.get("set-cookie", "")


@pytest.mark.asyncio
async def test_uninvited_google_account_is_refused():
    async with client() as c:
        response = await google_login(
            c, google_token("google-sub-stranger", f"stranger-{uuid.uuid4().hex}@gmail.com")
        )
    assert response.status_code == 403
    assert response.json()["detail"] == "This account has not been invited"
    assert SESSION_COOKIE not in response.headers.get("set-cookie", "")


@pytest.mark.asyncio
async def test_user_without_membership_is_refused_and_not_linked(tenants):
    user = await tenants.user("erin", [])

    async with client() as c:
        response = await google_login(c, google_token(f"google-sub-erin-{tenants.suffix}", user.email))
    assert response.status_code == 403

    async with async_session() as session:
        stored = await session.get(User, user.id)
        assert stored.google_subject is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"aud": "someone-elses-client.apps.googleusercontent.com"},
        {"iss": "https://evil.example.com"},
        {"expires_in": -3600},
        {"key": OTHER_KEY},
        {"email_verified": False},
        {"email_verified": "true"},
    ],
    ids=["wrong-audience", "wrong-issuer", "expired", "forged-signature", "unverified", "string-verified"],
)
async def test_invalid_google_tokens_are_rejected(tenants, overrides):
    org = await tenants.org("Woosong")
    user = await tenants.user("frank", [org])

    async with client() as c:
        response = await google_login(c, google_token(f"google-sub-frank-{tenants.suffix}", user.email, **overrides))
    assert response.status_code == 401
    assert SESSION_COOKIE not in response.headers.get("set-cookie", "")


@pytest.mark.asyncio
async def test_garbage_credential_is_rejected():
    async with client() as c:
        response = await google_login(c, "not-a-jwt")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_google_keys_unavailable_returns_503():
    def unreachable(_token):
        raise jwt.PyJWKClientConnectionError("network down")

    app.dependency_overrides[get_google_verifier] = lambda: GoogleTokenVerifier(
        client_id=CLIENT_ID, key_resolver=unreachable
    )
    async with client() as c:
        response = await google_login(c, google_token("any", "any@test.dev"))
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_multi_org_user_must_select_an_organization(tenants):
    org_a = await tenants.org("Alpha")
    org_b = await tenants.org("Beta")
    outsider_org = await tenants.org("Gamma")
    user = await tenants.user("grace", [org_a, org_b])

    async with client() as c:
        login = await google_login(c, google_token(f"google-sub-grace-{tenants.suffix}", user.email))
        assert login.status_code == 200
        assert login.json()["active_organization"] is None
        assert {o["slug"] for o in login.json()["organizations"]} == {org_a.slug, org_b.slug}

        blocked = await c.post("/api/ventures", json={"idea": IDEA})
        assert blocked.status_code == 401
        assert blocked.json()["detail"] == "Organization not selected"

        refused = await c.post("/api/auth/select-organization", json={"slug": outsider_org.slug})
        assert refused.status_code == 403

        chosen = await c.post("/api/auth/select-organization", json={"slug": org_b.slug})
        assert chosen.status_code == 200
        assert chosen.json()["active_organization"] == org_b.slug

        created = await c.post("/api/ventures", json={"idea": IDEA})
        assert created.status_code == 201
        assert created.json()["organization_id"] == str(org_b.id)


@pytest.mark.asyncio
async def test_two_organizations_cannot_see_each_others_data(tenants):
    org_a = await tenants.org("Alpha")
    org_b = await tenants.org("Beta")
    user_a = await tenants.user("alice", [org_a])
    user_b = await tenants.user("bob", [org_b])

    async with client() as c_b:
        await google_login(c_b, google_token(f"google-sub-b-{tenants.suffix}", user_b.email))
        venture_b = (await c_b.post("/api/ventures", json={"idea": IDEA})).json()["id"]
        assert (await c_b.get(f"/api/ventures/{venture_b}/stages")).status_code == 200

    async with client() as c_a:
        await google_login(c_a, google_token(f"google-sub-a-{tenants.suffix}", user_a.email))
        # Can't read org B's venture...
        assert (await c_a.get(f"/api/ventures/{venture_b}/stages")).status_code == 404
        # ...or switch the session into org B.
        switch = await c_a.post("/api/auth/select-organization", json={"slug": org_b.slug})
        assert switch.status_code == 403
        assert (await c_a.get(f"/api/ventures/{venture_b}/stages")).status_code == 404


@pytest.mark.asyncio
async def test_session_cookie_overrides_dev_headers(tenants):
    org_a = await tenants.org("Alpha")
    org_b = await tenants.org("Beta")
    user_a = await tenants.user("alice", [org_a])
    user_b = await tenants.user("bob", [org_b])

    async with client() as c:
        await google_login(c, google_token(f"google-sub-a-{tenants.suffix}", user_a.email))
        created = await c.post(
            "/api/ventures",
            json={"idea": IDEA},
            headers={"X-Dev-User-Email": user_b.email, "X-Dev-Organization-Slug": org_b.slug},
        )
    assert created.status_code == 201
    assert created.json()["organization_id"] == str(org_a.id)


@pytest.mark.asyncio
async def test_tampered_and_expired_cookies_are_rejected(tenants, monkeypatch):
    org = await tenants.org("Woosong")
    user = await tenants.user("heidi", [org])
    good = issue_session_token(user.id, org.id)

    async with client() as c:
        c.cookies.set(SESSION_COOKIE, good[:-4] + "AAAA")
        assert (await c.post("/api/ventures", json={"idea": IDEA})).status_code == 401

        forged = jwt.encode(
            {"typ": "weeaim-session", "sub": str(user.id), "org": str(org.id),
             "iat": datetime.now(UTC), "exp": datetime.now(UTC) + timedelta(hours=1)},
            "x" * 48,
            algorithm="HS256",
        )
        c.cookies.set(SESSION_COOKIE, forged)
        assert (await c.post("/api/ventures", json={"idea": IDEA})).status_code == 401

        monkeypatch.setattr(config.settings, "session_ttl_minutes", -1)
        c.cookies.set(SESSION_COOKIE, issue_session_token(user.id, org.id))
        response = await c.post("/api/ventures", json={"idea": IDEA})
        assert response.status_code == 401
        assert response.json()["detail"] == "Session expired or invalid"


@pytest.mark.asyncio
async def test_removed_membership_ends_access_immediately(tenants):
    org = await tenants.org("Woosong")
    user = await tenants.user("ivan", [org])

    async with client() as c:
        await google_login(c, google_token(f"google-sub-ivan-{tenants.suffix}", user.email))
        assert (await c.post("/api/ventures", json={"idea": IDEA})).status_code == 201

        async with async_session() as session:
            await session.execute(
                delete(OrganizationMember).where(OrganizationMember.user_id == user.id)
            )
            await session.commit()

        response = await c.post("/api/ventures", json={"idea": IDEA})
        assert response.status_code == 401
        assert (await c.get("/api/auth/me")).status_code == 401


@pytest.mark.asyncio
async def test_logout_clears_the_session(tenants):
    org = await tenants.org("Woosong")
    user = await tenants.user("judy", [org])

    async with client() as c:
        await google_login(c, google_token(f"google-sub-judy-{tenants.suffix}", user.email))
        assert (await c.get("/api/auth/me")).status_code == 200

        logout = await c.post("/api/auth/logout")
        assert logout.status_code == 204
        assert (await c.get("/api/auth/me")).status_code == 401
        assert (await c.post("/api/ventures", json={"idea": IDEA})).status_code == 401


@pytest.mark.asyncio
async def test_me_requires_a_session():
    async with client() as c:
        assert (await c.get("/api/auth/me")).status_code == 401


@pytest.mark.asyncio
async def test_auth_config_reports_dev_login_availability(monkeypatch):
    monkeypatch.setattr(config.settings, "google_client_id", CLIENT_ID)
    async with client() as c:
        dev = (await c.get("/api/auth/config")).json()
        monkeypatch.setattr(config.settings, "environment", "production")
        prod = (await c.get("/api/auth/config")).json()

    assert dev == {"google_client_id": CLIENT_ID, "dev_login_enabled": True}
    assert prod == {"google_client_id": CLIENT_ID, "dev_login_enabled": False}


@pytest.mark.asyncio
async def test_production_google_login_uses_secure_cookie(tenants, monkeypatch):
    org = await tenants.org("Woosong")
    user = await tenants.user("ken", [org])
    monkeypatch.setattr(config.settings, "environment", "production")
    monkeypatch.setattr(config.settings, "session_secret", "s" * 48)

    async with client() as c:
        response = await google_login(c, google_token(f"google-sub-ken-{tenants.suffix}", user.email))
        assert response.status_code == 200
        assert "secure" in response.headers["set-cookie"].lower()

        dev = await c.post("/api/auth/dev-login", json={"email": user.email})
        assert dev.status_code == 501


@pytest.mark.asyncio
async def test_production_without_session_secret_refuses_to_sign_in(tenants, monkeypatch):
    org = await tenants.org("Woosong")
    user = await tenants.user("leo", [org])
    monkeypatch.setattr(config.settings, "environment", "production")
    monkeypatch.setattr(config.settings, "session_secret", "")

    async with client() as c:
        response = await google_login(c, google_token(f"google-sub-leo-{tenants.suffix}", user.email))
    assert response.status_code == 503
    assert SESSION_COOKIE not in response.headers.get("set-cookie", "")


@pytest.mark.asyncio
async def test_dev_login_issues_the_same_session_cookie(tenants):
    org = await tenants.org("Woosong")
    user = await tenants.user("mallory", [org])

    async with client() as c:
        response = await c.post("/api/auth/dev-login", json={"email": user.email})
        assert response.status_code == 200
        assert response.json()["active_organization"] == org.slug
        assert "httponly" in response.headers["set-cookie"].lower()
        assert (await c.post("/api/ventures", json={"idea": IDEA})).status_code == 201

    async with async_session() as session:
        stored = (await session.execute(select(User).where(User.id == user.id))).scalar_one()
        assert stored.google_subject is None
