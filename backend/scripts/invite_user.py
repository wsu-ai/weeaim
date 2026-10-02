"""Invite a user so they can sign in with Google.

Sign-in is invite-only: a Google account can sign in only if its email
belongs to a user who is a member of at least one organization. This
script creates that user/membership (and, with --org-name, the
organization itself).

Run from backend/ with the venv activated:

    python -m scripts.invite_user --email someone@gmail.com --org-slug woosong \
        --org-name "Woosong University" --role owner
    python -m scripts.invite_user --email teammate@gmail.com --org-slug woosong

Idempotent -- safe to run more than once. The user's Google account is
linked automatically on their first sign-in.
"""

import argparse
import asyncio

from sqlalchemy import func, select

from app.db import async_session
from app.models import Organization, OrganizationMember, User

ROLES = ("owner", "admin", "member")


async def invite(email: str, org_slug: str, org_name: str | None, role: str) -> None:
    email = email.strip()
    async with async_session() as session:
        org = (
            await session.execute(select(Organization).where(Organization.slug == org_slug))
        ).scalar_one_or_none()
        if org is None:
            if org_name is None:
                raise SystemExit(
                    f"Organization '{org_slug}' doesn't exist. "
                    "Pass --org-name to create it."
                )
            org = Organization(name=org_name, slug=org_slug)
            session.add(org)
            await session.flush()
            print(f"Created organization {org_slug} ({org.id})")
        else:
            print(f"Organization {org_slug} already exists ({org.id})")

        user = (
            await session.execute(select(User).where(func.lower(User.email) == email.lower()))
        ).scalar_one_or_none()
        if user is None:
            user = User(email=email)
            session.add(user)
            await session.flush()
            print(f"Created user {email} ({user.id})")
        else:
            print(f"User {user.email} already exists ({user.id})")

        membership = (
            await session.execute(
                select(OrganizationMember).where(
                    OrganizationMember.organization_id == org.id,
                    OrganizationMember.user_id == user.id,
                )
            )
        ).scalar_one_or_none()
        if membership is None:
            session.add(OrganizationMember(organization_id=org.id, user_id=user.id, role=role))
            print(f"Added {user.email} to {org_slug} as {role}")
        else:
            print(f"{user.email} is already a member of {org_slug} ({membership.role})")

        await session.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--email", required=True, help="The user's Google account email")
    parser.add_argument("--org-slug", required=True, help="Organization to add them to")
    parser.add_argument("--org-name", help="Create the organization with this name if missing")
    parser.add_argument("--role", choices=ROLES, default="member")
    args = parser.parse_args()
    asyncio.run(invite(args.email, args.org_slug, args.org_name, args.role))


if __name__ == "__main__":
    main()
