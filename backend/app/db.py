from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


class Base(DeclarativeBase):
    pass


# The running app connects as venture_app, which is subject to row-level
# security (see docs/migrations.md). settings.database_url (the schema-owner
# role) is used only by Alembic migrations, never by the app at runtime.
engine = create_async_engine(settings.app_database_url)
async_session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with async_session() as session:
        yield session
