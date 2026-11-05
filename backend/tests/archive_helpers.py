"""Archiving and permanently deleting a venture from tests.

Test users sign in with the dev headers and have no password, so these
helpers give the user one first (archiving needs the password).
"""

from sqlalchemy import update

from app.db import async_session
from app.models import User
from app.passwords import hash_password

PASSWORD = "Correct-Horse-Battery-42"


async def set_password(email: str, password: str = PASSWORD) -> None:
    async with async_session() as session:
        await session.execute(update(User).where(User.email == email).values(password_hash=hash_password(password)))
        await session.commit()


def email_of(headers: dict) -> str:
    return headers["X-Dev-User-Email"]


async def archive(c, venture_id, headers: dict, password: str = PASSWORD):
    await set_password(email_of(headers), PASSWORD)
    return await c.post(f"/api/ventures/{venture_id}/archive", json={"password": password}, headers=headers)


async def delete_permanently(c, venture_id, headers: dict):
    """Archive, then delete for good -- the only way to erase a venture."""
    archived = await archive(c, venture_id, headers)
    assert archived.status_code == 204, archived.text
    return await c.post(
        f"/api/ventures/{venture_id}/delete-permanently", json={"password": PASSWORD}, headers=headers
    )
