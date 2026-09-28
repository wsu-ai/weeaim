from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, get_auth_context
from app.db import get_session
from app.models import AuditLog, Venture
from app.schemas import VentureCreate, VentureRead
from app.tenancy import set_current_organization

router = APIRouter(prefix="/api/ventures", tags=["ventures"])


def derive_title(idea: str, max_length: int = 80) -> str:
    """Deterministic placeholder title until Phase 7's AI structuring exists."""
    normalized = " ".join(idea.split())
    if len(normalized) <= max_length:
        return normalized
    truncated = normalized[:max_length]
    last_space = truncated.rfind(" ")
    if last_space > 0:
        truncated = truncated[:last_space]
    return truncated + "..."


@router.post("", response_model=VentureRead, status_code=201)
async def create_venture(
    payload: VentureCreate,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> Venture:
    await set_current_organization(session, auth.organization_id)

    venture = Venture(
        organization_id=auth.organization_id,
        owner_id=auth.user_id,
        title=derive_title(payload.idea),
        original_idea=payload.idea,
        current_idea_statement=payload.idea,
    )
    session.add(venture)
    await session.flush()

    session.add(
        AuditLog(
            organization_id=auth.organization_id,
            actor_user_id=auth.user_id,
            action="venture.create",
            resource_type="venture",
            resource_id=venture.id,
        )
    )
    await session.commit()
    return venture
