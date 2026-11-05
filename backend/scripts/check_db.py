"""Check a database URL and try to connect, explaining what's wrong in plain words.

Use it when a deploy fails with a database connection error:

    python -m scripts.check_db

It checks CHECK_DATABASE_URL if that is set (so you can test a URL without
changing .env), otherwise DATABASE_URL, APP_DATABASE_URL and
SERVICE_DATABASE_URL from the settings. The password is never printed.
See docs/deploy-vercel-render-supabase.md for the expected URL format.
"""

import asyncio
import os
import ssl as ssl_module

import asyncpg
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError

from app.config import settings


def masked(url: URL) -> str:
    return url.render_as_string(hide_password=True)


def url_problems(raw: str) -> tuple[URL | None, list[str]]:
    """(parsed URL or None, problems found without connecting)."""
    problems: list[str] = []
    raw = raw.strip()
    if not raw:
        return None, ["The value is empty."]
    if "[" in raw or "]" in raw or "YOUR-PASSWORD" in raw.upper():
        problems.append("It still contains [ ] or the [YOUR-PASSWORD] placeholder; put the real password in, without brackets.")
    if not raw.startswith("postgresql+asyncpg://"):
        problems.append("It must start with postgresql+asyncpg:// (Supabase shows postgresql://; add +asyncpg).")
    if " " in raw:
        problems.append("It contains a space.")
    credentials = raw.split("://", 1)[-1].rsplit("@", 1)[0]
    if "@" in credentials or "/" in credentials or "?" in credentials or "#" in credentials:
        problems.append("The password has a symbol that must be URL-encoded: @ as %40, # as %23, / as %2F, ? as %3F, : as %3A.")
    try:
        url = make_url(raw)
    except (ArgumentError, ValueError) as error:
        problems.append(f"It can't be read as a URL ({type(error).__name__}).")
        return None, problems

    host = url.host or ""
    if not host:
        problems.append("There is no host.")
    elif host.startswith("db.") and host.endswith(".supabase.co"):
        problems.append(
            "The host is Supabase's direct connection (db.<ref>.supabase.co), which Render can't reach. "
            "Use the Session pooler host (aws-...pooler.supabase.com)."
        )
    if url.port is None:
        problems.append("There is no port; use :5432.")
    elif url.port == 6543:
        problems.append("Port 6543 is the transaction pooler; use the Session pooler on port 5432.")
    elif url.port != 5432:
        problems.append(f"The port is {url.port}; the Session pooler uses 5432.")
    if host.endswith("pooler.supabase.com") and "." not in (url.username or ""):
        problems.append("For the Supabase pooler the username must include the project ref, e.g. postgres.<ref>.")
    if not url.password:
        problems.append("There is no password.")
    if url.database != "postgres":
        problems.append(f"The database name is {url.database!r}; on Supabase it is postgres.")
    if url.query.get("ssl") != "require":
        problems.append("It should end with ?ssl=require.")
    return url, problems


async def try_connect(url: URL) -> str:
    """'' when connected, else the reason it failed."""
    ssl = ssl_module.create_default_context() if url.query.get("ssl") == "require" else None
    try:
        connection = await asyncpg.connect(
            host=url.host,
            port=url.port or 5432,
            user=url.username,
            password=url.password,
            database=url.database,
            ssl=ssl,
            timeout=10,
        )
    except Exception as error:  # noqa: BLE001 -- reported to the person running this
        return f"{type(error).__name__}: {error}"
    try:
        user = await connection.fetchval("select current_user")
        print(f"   Connected as {user}.")
    finally:
        await connection.close()
    return ""


HINTS = {
    "Tenant or user not found": "The username or the pooler host is wrong (check postgres.<ref> and the region in the host).",
    "password authentication failed": "The password is wrong. For venture_app/venture_service the first deploy creates them; "
    "before that only DATABASE_URL can connect.",
    "Network is unreachable": "The host can't be reached; use the Session pooler host, not db.<ref>.supabase.co.",
    "Name or service not known": "The host name is mistyped.",
    "getaddrinfo failed": "The host name is mistyped.",
    "TimeoutError": "No answer from the server; check the host and port 5432.",
}


def main() -> None:
    override = os.environ.get("CHECK_DATABASE_URL")
    targets = (
        [("CHECK_DATABASE_URL", override)]
        if override
        else [
            ("DATABASE_URL", settings.database_url),
            ("APP_DATABASE_URL", settings.app_database_url),
            ("SERVICE_DATABASE_URL", settings.service_database_url),
        ]
    )
    for name, raw in targets:
        print(f"{name}:")
        url, problems = url_problems(raw or "")
        if url is not None:
            print(f"   {masked(url)}")
        for problem in problems:
            print(f" - {problem}")
        if url is None:
            continue
        reason = asyncio.run(try_connect(url))
        if reason:
            print(f"   Could not connect: {reason}")
            for marker, hint in HINTS.items():
                if marker.lower() in reason.lower():
                    print(f"   Hint: {hint}")
        elif not problems:
            print("   OK.")


if __name__ == "__main__":
    main()
