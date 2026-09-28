import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def set_current_organization(session: AsyncSession, organization_id: uuid.UUID) -> None:
    """Scope the current transaction to one organization for row-level security.

    Uses set_config(..., true) rather than a raw SET LOCAL statement so the
    organization id is passed as a bound parameter, not interpolated SQL.
    """
    await session.execute(
        text("SELECT set_config('app.current_organization_id', :org_id, true)"),
        {"org_id": str(organization_id)},
    )
