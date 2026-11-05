import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import TimestampMixin, UUIDPKMixin


class ExternalSource(Base, UUIDPKMixin, TimestampMixin):
    """An organization's external data API that Stage 1 research also queries
    (see app/external_sources/). Tenant-isolated by row-level security.

    The API key, if any, is stored encrypted and is never returned.
    """

    __tablename__ = "external_sources"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    # https://..., with a {query} placeholder.
    url_template: Mapped[str] = mapped_column(String(500), nullable=False)
    header_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
    encrypted_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    last_status: Mapped[str | None] = mapped_column(String(10), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
