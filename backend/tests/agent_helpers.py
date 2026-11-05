"""Recording that a stage's AI Mentor Agent has run, for tests that need it
(e.g. "Ask AI Mentor Feedback" requires a finished agent run)."""

import uuid

from sqlalchemy import select

from app.db import async_session
from app.models import AgentRun, Organization, Venture
from app.tenancy import set_current_organization


async def agent_has_run(org_slug: str, venture_id, stage_slug: str, drafts: dict | None = None) -> uuid.UUID:
    async with async_session() as session:
        org_id = (await session.execute(select(Organization.id).where(Organization.slug == org_slug))).scalar_one()
        await set_current_organization(session, org_id)
        venture = await session.get(Venture, venture_id)
        run = AgentRun(
            organization_id=org_id,
            venture_id=venture.id,
            stage_slug=stage_slug,
            started_by=venture.owner_id,
            language="en",
            status="succeeded",
            proposed_answers=drafts,
        )
        session.add(run)
        await session.commit()
        return run.id
