"""Review self-service sign-ups: list, approve or reject.

New accounts stay pending until an administrator approves them (see
docs/sign-up-and-approval.md). Run from backend/ with the venv activated:

    python -m scripts.manage_signups list
    python -m scripts.manage_signups approve --email new.user@example.com --org-slug woosong
    python -m scripts.manage_signups reject --email new.user@example.com --note "Not eligible"

Only registrations whose email has been verified can be approved. Approval
adds the user to exactly the organization given; it's the only way a
self-registered user gets access to any organization's data.
"""

import argparse
import asyncio
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import signup_review
from app.db import async_session
from app.dependencies import get_email_sender
from app.mailer import EmailSender
from app.models import Organization, User
from app.signup_review import ROLES, SignupError

__all__ = ["ROLES", "SignupError", "PendingSignup", "list_pending", "approve", "reject"]


@dataclass(frozen=True)
class PendingSignup:
    email: str
    full_name: str | None
    affiliation: str | None
    affiliation_name: str | None
    department: str | None
    access_reason: str | None
    registered_at: str


async def list_pending(session: AsyncSession) -> list[PendingSignup]:
    return [
        PendingSignup(
            email=u.email,
            full_name=u.display_name,
            affiliation=u.affiliation,
            affiliation_name=u.affiliation_name,
            department=u.department,
            access_reason=u.access_reason,
            registered_at=u.created_at.isoformat(timespec="minutes"),
        )
        for u in await signup_review.list_pending(session)
    ]


async def approve(
    session: AsyncSession, sender: EmailSender, email: str, org_slug: str, role: str = "member"
) -> None:
    if role not in ROLES:
        raise SignupError(f"Role must be one of {', '.join(ROLES)}")
    user_id = await signup_review.find_user_id(session, email)
    org = (
        await session.execute(select(Organization).where(Organization.slug == org_slug))
    ).scalar_one_or_none()
    if org is None:
        # Checked after the user so "not verified" is reported first.
        user = await session.get(User, user_id)
        if user is not None and user.email_verified_at is None:
            raise SignupError(f"{user.email} hasn't verified their email yet")
        raise SignupError(
            f"Organization '{org_slug}' doesn't exist "
            "(create it with scripts.invite_user --org-name)"
        )
    # Command-line reviews have no reviewer account.
    message = await signup_review.approve(session, user_id, org, role, reviewer_id=None)
    await asyncio.to_thread(sender.send, message)


async def reject(
    session: AsyncSession, sender: EmailSender, email: str, note: str | None = None
) -> None:
    user_id = await signup_review.find_user_id(session, email)
    message = await signup_review.reject(session, user_id, reviewer_id=None, note=note)
    if message is not None:
        await asyncio.to_thread(sender.send, message)


async def _run(args: argparse.Namespace) -> None:
    sender = get_email_sender()
    async with async_session() as session:
        if args.command == "list":
            pending = await list_pending(session)
            if not pending:
                print("No sign-ups awaiting approval.")
            for p in pending:
                where = p.affiliation_name or ""
                print(f"- {p.email}  {p.full_name or ''}  [{p.affiliation} {where}]".rstrip())
                if p.department:
                    print(f"    department: {p.department}")
                print(f"    registered: {p.registered_at}")
                print(f"    planned use: {p.access_reason}")
        elif args.command == "approve":
            await approve(session, sender, args.email, args.org_slug, args.role)
            print(f"Approved {args.email} into {args.org_slug} as {args.role}.")
        elif args.command == "reject":
            await reject(session, sender, args.email, args.note)
            print(f"Rejected {args.email}.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="Show verified sign-ups awaiting approval")
    approve_cmd = commands.add_parser("approve", help="Activate a sign-up and add it to an organization")
    approve_cmd.add_argument("--email", required=True)
    approve_cmd.add_argument("--org-slug", required=True)
    approve_cmd.add_argument("--role", choices=ROLES, default="member")
    reject_cmd = commands.add_parser("reject", help="Reject a sign-up")
    reject_cmd.add_argument("--email", required=True)
    reject_cmd.add_argument("--note", help="Optional reason included in the email")
    args = parser.parse_args()
    try:
        asyncio.run(_run(args))
    except SignupError as exc:
        raise SystemExit(f"Error: {exc}")


if __name__ == "__main__":
    main()
