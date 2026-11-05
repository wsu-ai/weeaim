"""External data sources: safe calls, encrypted keys, who may manage them,
tenant isolation, and their use in Stage 1 research.

No live network: the resolver and the HTTP transport are replaced.
"""

import json
import uuid

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select

from app.ai.fake import FakeAIProvider
from app.config import settings
from app.db import async_session
from app.dependencies import get_ai_provider
from app.external_sources import fetch
from app.external_sources.secrets import decrypt_key, encrypt_key
from app.main import app
from app.models import AuditLog, ExternalSource, Organization
from app.tenancy import set_current_organization
from app.wizard.competitive_position import DATA_END, DATA_START
from tests.test_idea_research import Tenants, client, headers
from tests.test_venture_delete import world  # noqa: F401  (fixture)

PUBLIC = "93.184.216.34"
TEMPLATE = "https://api.market.example/search?q={query}"

RESULTS = {
    "data": {
        "results": [
            {"name": "KimchiCo", "description": "Korean meal kits.", "website": "https://kimchico.example/"},
            {"title": "Seoul Bites", "summary": "Recipe app.", "url": "https://seoulbites.example/app"},
            {"name": "No link", "description": "Directory entry"},
        ]
    }
}


class Network:
    """Stands in for DNS and HTTP; records requests."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.addresses: dict[str, list[str]] = {}
        self.respond = lambda request: httpx.Response(200, json=RESULTS)

    async def resolve(self, host: str) -> list[str]:
        if host in self.addresses:
            return self.addresses[host]
        return [PUBLIC]

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.respond(request)


@pytest.fixture
def network(monkeypatch):
    net = Network()
    monkeypatch.setattr(fetch, "resolver", net.resolve)
    monkeypatch.setattr(fetch, "transport", httpx.MockTransport(net.handler))
    monkeypatch.setattr(settings, "source_keys_secret", "test-secret-for-external-source-keys")
    yield net


class Recording(FakeAIProvider):
    def __init__(self) -> None:
        self.idea_contexts: list[str] = []

    async def research_idea(self, idea_context, language):
        self.idea_contexts.append(idea_context)
        return await super().research_idea(idea_context, language)


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


async def org_id(slug: str) -> uuid.UUID:
    async with async_session() as session:
        return (await session.execute(select(Organization.id).where(Organization.slug == slug))).scalar_one()


async def add(c, h, **overrides):
    return await c.post(
        "/api/external-sources",
        json={"name": "Market API", "url_template": TEMPLATE, "header_name": "X-Api-Key", "api_key": "sk-secret-123", **overrides},
        headers=h,
    )


# --- URL safety -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("template", "reason"),
    [
        ("http://api.example.com/?q={query}", "https_required"),
        ("https://api.example.com/search", "missing_query_placeholder"),
        ("https://user:pass@api.example.com/?q={query}", "credentials_in_url"),
        ("https://api.example.com:8443/?q={query}", "port_not_allowed"),
        ("https://localhost/?q={query}", "host_not_allowed"),
        ("https://10.0.0.5/?q={query}", "private_address"),
        ("https://169.254.169.254/latest?q={query}", "private_address"),
        ("https://[::1]/?q={query}", "private_address"),
        ("https://printer.local/?q={query}", "host_not_allowed"),
    ],
)
def test_unsafe_urls_are_refused(template, reason):
    with pytest.raises(fetch.UnsafeSourceUrl) as exc:
        fetch.check_template(template)
    assert str(exc.value) == reason


@pytest.mark.asyncio
async def test_a_name_resolving_to_a_private_address_is_refused(network):
    network.addresses["internal.example"] = [PUBLIC, "192.168.1.10"]
    with pytest.raises(fetch.UnsafeSourceUrl, match="private_address"):
        await fetch.check_host("https://internal.example/?q={query}")
    await fetch.check_host(TEMPLATE)  # public: fine


# --- Calls ----------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_call_encodes_the_query_sends_the_key_and_extracts_items(network):
    result = await fetch.call_source("Market API", TEMPLATE, "kimchi & rice kits", "X-Api-Key", "sk-1")
    request = network.requests[0]
    assert str(request.url) == "https://api.market.example/search?q=kimchi%20%26%20rice%20kits"
    assert request.headers["X-Api-Key"] == "sk-1"
    assert result.status == "ok"
    assert [i["title"] for i in result.items] == ["KimchiCo", "Seoul Bites", "No link"]
    assert result.items[0]["url"] == "https://kimchico.example/" and result.items[2]["url"] is None
    assert len(result.raw) <= fetch.MAX_RAW_CHARS


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("respond", "error"),
    [
        (lambda r: httpx.Response(302, headers={"Location": "http://10.0.0.1/"}), "HTTP 302"),  # not followed
        (lambda r: httpx.Response(500), "HTTP 500"),
        (lambda r: httpx.Response(200, content=b"x" * (fetch.MAX_BYTES + 10)), "response_too_large"),
    ],
)
async def test_failures_come_back_as_errors_without_raising(network, respond, error):
    network.respond = respond
    result = await fetch.call_source("Market API", TEMPLATE, "q", None, None)
    assert (result.status, result.error) == ("error", error)
    assert len(network.requests) == 1  # a redirect is never followed


@pytest.mark.asyncio
async def test_a_timeout_and_plain_text_are_handled(network):
    def slow(request):
        raise httpx.ReadTimeout("slow", request=request)

    network.respond = slow
    assert (await fetch.call_source("A", TEMPLATE, "q", None, None)).error == "timeout"
    network.respond = lambda r: httpx.Response(200, text="Plain text listing")
    text = await fetch.call_source("A", TEMPLATE, "q", None, None)
    assert text.status == "ok" and text.items == [] and text.raw == "Plain text listing"


def test_keys_are_encrypted_and_round_trip(monkeypatch):
    monkeypatch.setattr(settings, "source_keys_secret", "s1")
    token = encrypt_key("sk-secret")
    assert "sk-secret" not in token and decrypt_key(token) == "sk-secret"
    monkeypatch.setattr(settings, "source_keys_secret", "another")
    assert decrypt_key(token) is None  # unreadable once the secret changes


# --- Endpoints ------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_admin_adds_tests_and_removes_a_source_and_the_key_never_comes_back(tenants, network):
    org_slug, email, _ = await tenants.make()  # the seeded user is the owner
    h = headers(org_slug, email)
    async with client() as c:
        created = await add(c, h)
        listing = await c.get("/api/external-sources", headers=h)
        source_id = created.json()["id"]
        tested = await c.post(f"/api/external-sources/{source_id}/test", json={"query": "kimchi"}, headers=h)
        keep_key = await c.patch(f"/api/external-sources/{source_id}", json={"name": "Renamed"}, headers=h)
        drop_key = await c.patch(f"/api/external-sources/{source_id}", json={"api_key": ""}, headers=h)
        deleted = await c.delete(f"/api/external-sources/{source_id}", headers=h)

    assert created.status_code == 201 and created.json()["has_key"] is True
    for response in (created, listing, tested, keep_key, drop_key):
        assert "sk-secret-123" not in response.text
    assert listing.json()["can_edit"] is True and listing.json()["keys_supported"] is True
    assert tested.json() == {"status": "ok", "error": None, "items": 3, "sample_titles": ["KimchiCo", "Seoul Bites", "No link"]}
    assert network.requests[0].headers["X-Api-Key"] == "sk-secret-123"
    assert keep_key.json()["has_key"] is True and keep_key.json()["name"] == "Renamed"
    assert drop_key.json()["has_key"] is False
    assert deleted.status_code == 204

    async with async_session() as session:
        await set_current_organization(session, await org_id(org_slug))
        audits = (
            await session.execute(select(AuditLog).where(AuditLog.resource_type == "external_source"))
        ).scalars().all()
    assert {a.action for a in audits} >= {"external_source.create", "external_source.test", "external_source.delete"}
    assert all("sk-secret" not in json.dumps(a.log_metadata) for a in audits)


@pytest.mark.asyncio
async def test_unsafe_urls_and_keys_without_a_secret_are_refused_on_save(tenants, network, monkeypatch):
    org_slug, email, _ = await tenants.make()
    h = headers(org_slug, email)
    network.addresses["intranet.example"] = ["10.1.2.3"]
    async with client() as c:
        private = await add(c, h, url_template="https://intranet.example/?q={query}")
        no_query = await add(c, h, url_template="https://api.example.com/search")
        monkeypatch.setattr(settings, "source_keys_secret", "")
        no_secret = await add(c, h)
        keyless = await add(c, h, api_key=None)
    assert (private.status_code, private.json()["detail"]) == (422, "private_address")
    assert (no_query.status_code, no_query.json()["detail"]) == (422, "missing_query_placeholder")
    assert (no_secret.status_code, no_secret.json()["detail"]) == (422, "key_storage_not_configured")
    assert keyless.status_code == 201 and keyless.json()["has_key"] is False


@pytest.mark.asyncio
async def test_at_most_ten_sources(tenants, network):
    org_slug, email, _ = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        for i in range(10):
            assert (await add(c, h, name=f"S{i}", api_key=None)).status_code == 201
        eleventh = await add(c, h, name="S10", api_key=None)
    assert (eleventh.status_code, eleventh.json()["detail"]) == (409, "too_many_sources")


@pytest.mark.asyncio
async def test_members_see_sources_but_only_owners_and_admins_manage_them(world, network):  # noqa: F811
    org = await world.org()
    admin = await world.user(org, "admin")
    member = await world.user(org, "member")
    async with client() as c:
        source_id = (await add(c, org.headers(admin))).json()["id"]
        listed = await c.get("/api/external-sources", headers=org.headers(member))
        refused = [
            (await add(c, org.headers(member))).status_code,
            (await c.patch(f"/api/external-sources/{source_id}", json={"name": "x"}, headers=org.headers(member))).status_code,
            (await c.post(f"/api/external-sources/{source_id}/test", json={}, headers=org.headers(member))).status_code,
            (await c.delete(f"/api/external-sources/{source_id}", headers=org.headers(member))).status_code,
        ]
    assert listed.status_code == 200 and listed.json()["can_edit"] is False
    assert [s["name"] for s in listed.json()["sources"]] == ["Market API"]
    assert refused == [403, 403, 403, 403]


@pytest.mark.asyncio
async def test_sources_are_isolated_between_organizations(tenants, network):
    org_a, email_a, _ = await tenants.make()
    org_b, email_b, _ = await tenants.make()
    async with client() as c:
        source_id = (await add(c, headers(org_a, email_a))).json()["id"]
        b_list = (await c.get("/api/external-sources", headers=headers(org_b, email_b))).json()
        b_change = await c.patch(f"/api/external-sources/{source_id}", json={"name": "x"}, headers=headers(org_b, email_b))
        b_delete = await c.delete(f"/api/external-sources/{source_id}", headers=headers(org_b, email_b))
        signed_out = await c.get("/api/external-sources")
    assert b_list["sources"] == []
    assert b_change.status_code == 404 and b_delete.status_code == 404
    assert signed_out.status_code == 401
    async with async_session() as session:
        await set_current_organization(session, await org_id(org_b))
        assert (await session.execute(select(func.count()).select_from(ExternalSource))).scalar_one() == 0


# --- Stage 1 research -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stage_one_research_uses_enabled_sources_as_untrusted_data(tenants, network, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    async with client() as c:
        await add(c, h)
        disabled = (await add(c, h, name="Off", api_key=None)).json()["id"]
        await c.patch(f"/api/external-sources/{disabled}", json={"enabled": False}, headers=h)
        research = await c.post(f"/api/ventures/{venture_id}/stages/idea_discovery/research", json={}, headers=h)
        status = (await c.get("/api/external-sources", headers=h)).json()["sources"]

    assert research.status_code == 200, research.text
    assert len(network.requests) == 1  # the disabled source isn't called
    context = provider.idea_contexts[0]
    data = json.loads(context.split(DATA_START)[1].split(f"\n{DATA_END}")[0])
    assert data[0]["source"] == "Market API" and data[0]["items"][0]["title"] == "KimchiCo"
    body = research.json()
    via = [s for s in body["sources"] if s.get("via") == "Market API"]
    assert {s["url"] for s in via} == {"https://kimchico.example/", "https://seoulbites.example/app"}
    assert body["external_results"] == [{"name": "Market API", "status": "ok", "items": 3}]
    assert {s["name"]: s["last_status"] for s in status} == {"Market API": "ok", "Off": None}


@pytest.mark.asyncio
async def test_a_failing_source_never_fails_research(tenants, network, provider):
    org_slug, email, venture_id = await tenants.make()
    h = headers(org_slug, email)
    network.respond = lambda r: httpx.Response(503)
    async with client() as c:
        await add(c, h)
        research = await c.post(f"/api/ventures/{venture_id}/stages/idea_discovery/research", json={}, headers=h)
        status = (await c.get("/api/external-sources", headers=h)).json()["sources"][0]
    assert research.status_code == 200
    assert research.json()["external_results"] == [{"name": "Market API", "status": "error", "items": 0}]
    assert DATA_START not in provider.idea_contexts[0]  # nothing to pass on
    assert (status["last_status"], status["last_error"]) == ("error", "HTTP 503")
