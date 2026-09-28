"""Seed the one dev organization/user/membership the dev-auth adapter expects.

Run with: python -m scripts.seed_dev_org (from backend/, venv activated).
Idempotent -- safe to run more than once.
"""

import asyncio

from sqlalchemy import select

from app.db import async_session
from app.models import Organization, OrganizationMember, User

DEV_ORG_SLUG = "dev-org"
DEV_ORG_NAME = "Dev Org"
DEV_USER_EMAIL = "dev@weeaim.local"
DEV_USER_NAME = "Dev User"


async def seed() -> None:
    async with async_session() as session:
        org = (
            await session.execute(select(Organization).where(Organization.slug == DEV_ORG_SLUG))
        ).scalar_one_or_none()
        if org is None:
            org = Organization(name=DEV_ORG_NAME, slug=DEV_ORG_SLUG)
            session.add(org)
            await session.flush()
            print(f"Created organization {DEV_ORG_SLUG} ({org.id})")
        else:
            print(f"Organization {DEV_ORG_SLUG} already exists ({org.id})")

        user = (
            await session.execute(select(User).where(User.email == DEV_USER_EMAIL))
        ).scalar_one_or_none()
        if user is None:
            user = User(email=DEV_USER_EMAIL, display_name=DEV_USER_NAME)
            session.add(user)
            await session.flush()
            print(f"Created user {DEV_USER_EMAIL} ({user.id})")
        else:
            print(f"User {DEV_USER_EMAIL} already exists ({user.id})")

        membership = (
            await session.execute(
                select(OrganizationMember).where(
                    OrganizationMember.organization_id == org.id,
                    OrganizationMember.user_id == user.id,
                )
            )
        ).scalar_one_or_none()
        if membership is None:
            session.add(
                OrganizationMember(organization_id=org.id, user_id=user.id, role="owner")
            )
            print("Created membership (owner)")
        else:
            print("Membership already exists")

        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed())
