import uuid

import pytest
from sqlalchemy import delete, update
from sqlalchemy.exc import DBAPIError

from app.db import async_session
from app.models import AuditLog, Organization, OrganizationMember, User
from app.tenancy import set_current_organization


async def _seed_org_user(session, suffix: str) -> tuple[uuid.UUID, str, str]:
    org = Organization(name=f"Test Org {suffix}", slug=f"test-org-{suffix}")
    user = User(email=f"user-{suffix}@test.dev", display_name="Test User")
    session.add_all([org, user])
    await session.flush()
    session.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="owner"))
    await session.commit()
    return org.id, org.slug, user.email


async def _cleanup(org_id: uuid.UUID, org_slug: str, user_email: str) -> None:
    # Deliberately no AuditLog delete here -- the app can't (that's this
    # file's whole point), and doesn't need to: the FK is ON DELETE SET
    # NULL, so the log rows survive as orphaned history instead of blocking
    # this cleanup.
    async with async_session() as session:
        await set_current_organization(session, org_id)
        await session.execute(
            delete(OrganizationMember).where(OrganizationMember.organization_id == org_id)
        )
        await session.execute(delete(User).where(User.email == user_email))
        await session.execute(delete(Organization).where(Organization.id == org_id))
        await session.commit()


@pytest.mark.asyncio
async def test_app_role_cannot_update_audit_logs():
    async with async_session() as session:
        org_id, org_slug, user_email = await _seed_org_user(session, uuid.uuid4().hex[:8])

    try:
        async with async_session() as session:
            await set_current_organization(session, org_id)
            log = AuditLog(
                organization_id=org_id,
                action="test.action",
                resource_type="test",
            )
            session.add(log)
            await session.commit()
            log_id = log.id

        async with async_session() as session:
            await set_current_organization(session, org_id)
            with pytest.raises(DBAPIError):
                await session.execute(
                    update(AuditLog).where(AuditLog.id == log_id).values(action="tampered")
                )
                await session.flush()
    finally:
        await _cleanup(org_id, org_slug, user_email)


@pytest.mark.asyncio
async def test_app_role_cannot_delete_audit_logs():
    async with async_session() as session:
        org_id, org_slug, user_email = await _seed_org_user(session, uuid.uuid4().hex[:8])

    try:
        async with async_session() as session:
            await set_current_organization(session, org_id)
            log = AuditLog(
                organization_id=org_id,
                action="test.action",
                resource_type="test",
            )
            session.add(log)
            await session.commit()
            log_id = log.id

        async with async_session() as session:
            await set_current_organization(session, org_id)
            with pytest.raises(DBAPIError):
                await session.execute(delete(AuditLog).where(AuditLog.id == log_id))
                await session.flush()
    finally:
        await _cleanup(org_id, org_slug, user_email)
