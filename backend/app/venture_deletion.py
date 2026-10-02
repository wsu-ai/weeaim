"""Permanent deletion of a venture and everything it owns.

Nothing under a venture cascades at the database level, so children are
deleted explicitly, deepest first. Runs inside the organization's RLS scope
(set by _load_venture), so it can only ever touch that tenant's rows. Audit
log entries are immutable and are kept.
"""

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, find_membership
from app.models import (
    AIRun,
    Document,
    DocumentChunk,
    EvidenceItem,
    IdeaVersion,
    Venture,
    VentureMember,
    WizardResponse,
    WizardResponseRevision,
)

DELETER_ROLES = ("owner", "admin")


async def can_delete_venture(session: AsyncSession, auth: AuthContext, venture: Venture) -> bool:
    """The venture's creator, or an owner/admin of its organization."""
    if venture.owner_id == auth.user_id:
        return True
    membership = await find_membership(session, auth.user_id, auth.organization_id)
    return membership is not None and membership.role in DELETER_ROLES


async def delete_venture(session: AsyncSession, venture: Venture) -> list[str]:
    """Deletes the venture's rows (caller commits). Returns stored-file keys
    to remove from storage once the deletion is committed."""
    storage_keys = list(
        (
            await session.execute(
                select(Document.storage_key).where(Document.venture_id == venture.id)
            )
        ).scalars()
    )

    for model in (
        DocumentChunk,  # the search vectors
        Document,
        EvidenceItem,
        WizardResponseRevision,
        WizardResponse,
        IdeaVersion,
        VentureMember,
        AIRun,
    ):
        await session.execute(delete(model).where(model.venture_id == venture.id))
    await session.execute(delete(Venture).where(Venture.id == venture.id))
    return storage_keys
