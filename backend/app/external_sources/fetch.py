"""Calling an organization's external data sources safely.

The URL comes from a user, so every call is guarded against reaching
internal services (SSRF): https only, no credentials in the URL, the default
port, and a host that resolves only to public addresses -- checked when a
source is saved and again before every call. Redirects aren't followed,
calls time out, and responses are read up to a size limit. Whatever comes
back is untrusted data for the AI, never instructions.
"""

import asyncio
import ipaddress
import json
import socket
from dataclasses import dataclass, field
from urllib.parse import quote, urlsplit

import httpx

QUERY = "{query}"
TIMEOUT_SECONDS = 8.0
MAX_BYTES = 1_000_000
MAX_RAW_CHARS = 6_000
MAX_ITEMS = 10


class UnsafeSourceUrl(ValueError):
    """The URL may not be called; the message is a machine-readable reason."""


def check_template(template: str) -> None:
    """Static rules for a source URL (raises UnsafeSourceUrl)."""
    if QUERY not in template:
        raise UnsafeSourceUrl("missing_query_placeholder")
    parts = urlsplit(template.replace(QUERY, "q"))
    if parts.scheme != "https":
        raise UnsafeSourceUrl("https_required")
    if parts.username or parts.password:
        raise UnsafeSourceUrl("credentials_in_url")
    if parts.port not in (None, 443):
        raise UnsafeSourceUrl("port_not_allowed")
    host = (parts.hostname or "").rstrip(".").lower()
    if not host or host == "localhost" or host.endswith(".localhost") or host.endswith(".local"):
        raise UnsafeSourceUrl("host_not_allowed")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        return
    # An IP address instead of a name is only allowed if it's public.
    if not literal.is_global:
        raise UnsafeSourceUrl("private_address")


async def _resolve(host: str) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    return [info[4][0] for info in infos]


# Replaced in tests; returns the addresses a host resolves to.
resolver = _resolve


async def check_host(template: str) -> None:
    """The host must resolve, and only to public addresses."""
    check_template(template)
    host = urlsplit(template.replace(QUERY, "q")).hostname or ""
    try:
        addresses = await resolver(host)
    except OSError:
        raise UnsafeSourceUrl("host_not_found")
    if not addresses:
        raise UnsafeSourceUrl("host_not_found")
    for address in addresses:
        if not ipaddress.ip_address(address.split("%")[0]).is_global:
            raise UnsafeSourceUrl("private_address")


def build_url(template: str, query: str) -> str:
    return template.replace(QUERY, quote(query.strip()[:100], safe=""))


@dataclass
class SourceResult:
    name: str
    status: str  # "ok" or "error"
    error: str | None = None
    items: list[dict] = field(default_factory=list)
    raw: str = ""


def _first_list(data) -> list:
    """The first list of objects in a JSON response, searched breadth-first."""
    queue = [data]
    while queue:
        node = queue.pop(0)
        if isinstance(node, list) and any(isinstance(x, dict) for x in node):
            return [x for x in node if isinstance(x, dict)]
        if isinstance(node, dict):
            queue.extend(node.values())
    return []


def _pick(item: dict, keys: tuple[str, ...]) -> str:
    for key in keys:
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def extract_items(data) -> list[dict]:
    items = []
    for item in _first_list(data)[:MAX_ITEMS]:
        title = _pick(item, ("name", "title", "company", "business_name", "label"))
        description = _pick(item, ("description", "summary", "snippet", "about", "text"))
        url = _pick(item, ("url", "link", "website", "homepage", "href"))
        if not url.startswith(("https://", "http://")):
            url = ""
        if title or description:
            items.append({"title": title[:200], "description": description[:500], "url": url[:500] or None})
    return items


# Replaced in tests with an httpx.MockTransport.
transport: httpx.AsyncBaseTransport | None = None


async def call_source(name: str, template: str, query: str, header_name: str | None, key: str | None) -> SourceResult:
    """One guarded call. Never raises: a failure comes back as status "error"."""
    try:
        await check_host(template)
        headers = {"Accept": "application/json, text/plain;q=0.9"}
        if key:
            headers[header_name or "Authorization"] = key
        async with httpx.AsyncClient(
            transport=transport, timeout=TIMEOUT_SECONDS, follow_redirects=False
        ) as client:
            async with client.stream("GET", build_url(template, query), headers=headers) as response:
                if response.status_code >= 300:
                    return SourceResult(name, "error", f"HTTP {response.status_code}")
                body = b""
                async for chunk in response.aiter_bytes():
                    body += chunk
                    if len(body) > MAX_BYTES:
                        return SourceResult(name, "error", "response_too_large")
        text = body.decode(response.encoding or "utf-8", errors="replace")
        try:
            data = json.loads(text)
        except ValueError:
            return SourceResult(name, "ok", items=[], raw=text[:MAX_RAW_CHARS])
        return SourceResult(
            name, "ok", items=extract_items(data), raw=json.dumps(data, ensure_ascii=False)[:MAX_RAW_CHARS]
        )
    except UnsafeSourceUrl as exc:
        return SourceResult(name, "error", str(exc))
    except httpx.TimeoutException:
        return SourceResult(name, "error", "timeout")
    except httpx.HTTPError as exc:
        return SourceResult(name, "error", type(exc).__name__)
