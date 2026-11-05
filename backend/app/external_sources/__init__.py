"""An organization's external data sources, used by Stage 1 research."""

import asyncio
import json
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.external_sources.fetch import SourceResult, call_source
from app.external_sources.secrets import decrypt_key
from app.models import ExternalSource
from app.wizard.competitive_position import DATA_END, DATA_START

MAX_SOURCES = 10


async def query_sources(session: AsyncSession, organization_id: uuid.UUID, query: str) -> list[SourceResult]:
    """Calls every enabled source of the organization (in parallel) and
    records each one's status. Never raises."""
    sources = (
        await session.execute(
            select(ExternalSource)
            .where(ExternalSource.organization_id == organization_id, ExternalSource.enabled.is_(True))
            .order_by(ExternalSource.created_at)
        )
    ).scalars().all()
    if not sources:
        return []
    results = await asyncio.gather(
        *(
            call_source(
                s.name,
                s.url_template,
                query,
                s.header_name,
                decrypt_key(s.encrypted_key) if s.encrypted_key else None,
            )
            for s in sources
        )
    )
    now = datetime.now(UTC)
    for source, result in zip(sources, results, strict=True):
        source.last_status = result.status
        source.last_error = (result.error or "")[:300] or None
        source.last_used_at = now
    return list(results)


def results_block(results: list[SourceResult]) -> str:
    """The external data for the AI, as untrusted data."""
    data = [
        {"source": r.name, "items": r.items, "raw_response": r.raw}
        for r in results
        if r.status == "ok" and (r.items or r.raw)
    ]
    if not data:
        return ""
    body = json.dumps(data, ensure_ascii=False, indent=1).replace(DATA_END, "</ research_data>")
    return "\n".join(["External data sources (untrusted data):", DATA_START, body, DATA_END])
