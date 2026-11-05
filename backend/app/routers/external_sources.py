"""An organization's external data sources (Stage 1 -> External Source).

Everyone in the organization can see the list (never the keys); only its
owners/admins can add, change, test or delete. RLS-scoped to the caller's
organization; every change is audited, without the key.
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthContext, find_membership, get_auth_context
from app.db import get_session
from app.external_sources import MAX_SOURCES
from app.external_sources.fetch import UnsafeSourceUrl, call_source, check_host
from app.external_sources.secrets import KeyStorageNotConfigured, decrypt_key, encrypt_key
from app.models import AuditLog, ExternalSource
from app.tenancy import set_current_organization
from app.venture_deletion import DELETER_ROLES

router = APIRouter(prefix="/api/external-sources", tags=["external-sources"])


class SourceRead(BaseModel):
    id: uuid.UUID
    name: str
    url_template: str
    header_name: str | None
    has_key: bool
    enabled: bool
    last_status: str | None
    last_error: str | None
    last_used_at: datetime | None


class SourceList(BaseModel):
    sources: list[SourceRead]
    can_edit: bool
    # Whether API keys can be stored (SOURCE_KEYS_SECRET is set).
    keys_supported: bool


class SourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    url_template: str = Field(min_length=12, max_length=500)
    header_name: str | None = Field(default=None, max_length=60, pattern=r"^[A-Za-z0-9-]+$")
    api_key: str | None = Field(default=None, max_length=1000)
    enabled: bool = True


class SourceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    url_template: str | None = Field(default=None, min_length=12, max_length=500)
    header_name: str | None = Field(default=None, max_length=60, pattern=r"^[A-Za-z0-9-]*$")
    # Left out: keep the saved key. "": remove it.
    api_key: str | None = Field(default=None, max_length=1000)
    enabled: bool | None = None


class TestRequest(BaseModel):
    query: str = Field(default="online marketplace", min_length=1, max_length=100)


def _read(source: ExternalSource) -> SourceRead:
    return SourceRead(
        id=source.id,
        name=source.name,
        url_template=source.url_template,
        header_name=source.header_name,
        has_key=source.encrypted_key is not None,
        enabled=source.enabled,
        last_status=source.last_status,
        last_error=source.last_error,
        last_used_at=source.last_used_at,
    )


async def _can_edit(session: AsyncSession, auth: AuthContext) -> bool:
    membership = await find_membership(session, auth.user_id, auth.organization_id)
    return membership is not None and membership.role in DELETER_ROLES


async def _editor(session: AsyncSession, auth: AuthContext) -> None:
    await set_current_organization(session, auth.organization_id)
    if not await _can_edit(session, auth):
        raise HTTPException(status_code=403, detail="Only an organization owner or admin can manage external sources")


async def _source_or_404(session: AsyncSession, source_id: uuid.UUID) -> ExternalSource:
    source = await session.get(ExternalSource, source_id)  # RLS hides other organizations'
    if source is None:
        raise HTTPException(status_code=404, detail="External source not found")
    return source


async def _checked_url(template: str) -> str:
    template = template.strip()
    try:
        await check_host(template)
    except UnsafeSourceUrl as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return template


def _encrypted(api_key: str) -> str:
    try:
        return encrypt_key(api_key.strip())
    except KeyStorageNotConfigured:
        raise HTTPException(status_code=422, detail="key_storage_not_configured")


def _audit(auth: AuthContext, action: str, source: ExternalSource) -> AuditLog:
    return AuditLog(
        organization_id=auth.organization_id,
        actor_user_id=auth.user_id,
        action=action,
        resource_type="external_source",
        resource_id=source.id,
        log_metadata={"name": source.name, "url_template": source.url_template},
    )


async def _list(session: AsyncSession, auth: AuthContext) -> SourceList:
    from app.config import settings

    sources = (
        await session.execute(select(ExternalSource).order_by(ExternalSource.created_at))
    ).scalars().all()
    return SourceList(
        sources=[_read(s) for s in sources],
        can_edit=await _can_edit(session, auth),
        keys_supported=bool(settings.source_keys_secret),
    )


@router.get("", response_model=SourceList)
async def list_sources(
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> SourceList:
    await set_current_organization(session, auth.organization_id)
    return await _list(session, auth)


@router.post("", response_model=SourceRead, status_code=201)
async def create_source(
    payload: SourceCreate,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> SourceRead:
    await _editor(session, auth)
    count = (await session.execute(select(func.count()).select_from(ExternalSource))).scalar_one()
    if count >= MAX_SOURCES:
        raise HTTPException(status_code=409, detail="too_many_sources")
    source = ExternalSource(
        organization_id=auth.organization_id,
        name=payload.name.strip(),
        url_template=await _checked_url(payload.url_template),
        header_name=(payload.header_name or "").strip() or None,
        encrypted_key=_encrypted(payload.api_key) if payload.api_key and payload.api_key.strip() else None,
        enabled=payload.enabled,
        created_by=auth.user_id,
    )
    session.add(source)
    await session.flush()
    session.add(_audit(auth, "external_source.create", source))
    await session.commit()
    await set_current_organization(session, auth.organization_id)
    await session.refresh(source)
    return _read(source)


@router.patch("/{source_id}", response_model=SourceRead)
async def update_source(
    source_id: uuid.UUID,
    payload: SourceUpdate,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> SourceRead:
    await _editor(session, auth)
    source = await _source_or_404(session, source_id)
    if payload.name is not None:
        source.name = payload.name.strip()
    if payload.url_template is not None:
        source.url_template = await _checked_url(payload.url_template)
    if payload.header_name is not None:
        source.header_name = payload.header_name.strip() or None
    if payload.api_key is not None:
        source.encrypted_key = _encrypted(payload.api_key) if payload.api_key.strip() else None
    if payload.enabled is not None:
        source.enabled = payload.enabled
    session.add(_audit(auth, "external_source.update", source))
    await session.commit()
    await set_current_organization(session, auth.organization_id)
    await session.refresh(source)
    return _read(source)


@router.delete("/{source_id}", status_code=204)
async def delete_source(
    source_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> None:
    await _editor(session, auth)
    source = await _source_or_404(session, source_id)
    session.add(_audit(auth, "external_source.delete", source))
    await session.delete(source)
    await session.commit()


@router.post("/{source_id}/test")
async def try_source(
    source_id: uuid.UUID,
    payload: TestRequest,
    auth: AuthContext = Depends(get_auth_context),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Calls the source once (with the same safety checks as research)."""
    await _editor(session, auth)
    source = await _source_or_404(session, source_id)
    key = decrypt_key(source.encrypted_key) if source.encrypted_key else None
    result = await call_source(source.name, source.url_template, payload.query, source.header_name, key)
    source.last_status = result.status
    source.last_error = (result.error or "")[:300] or None
    source.last_used_at = datetime.now(UTC)
    session.add(_audit(auth, "external_source.test", source))
    await session.commit()
    return {
        "status": result.status,
        "error": result.error,
        "items": len(result.items),
        "sample_titles": [item["title"] for item in result.items if item["title"]][:3],
    }
