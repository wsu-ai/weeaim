import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import CreatedAtMixin, UUIDPKMixin


class TokenUsage(Base, UUIDPKMixin, CreatedAtMixin):
    """AI tokens one call used (research, feedback, chat, agent turn...).

    Tenant-isolated by row-level security on organization_id. venture_id is
    set to NULL when a venture is permanently deleted, so the organization's
    total keeps what it consumed.
    """

    __tablename__ = "token_usage"
    __table_args__ = (CheckConstraint("tokens >= 0", name="ck_token_usage_tokens"),)

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    venture_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ventures.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    operation: Mapped[str] = mapped_column(String(50), nullable=False)
    tokens: Mapped[int] = mapped_column(Integer, nullable=False)


class OrganizationTokenLimits(Base):
    """An organization's token limits; NULL means no limit."""

    __tablename__ = "organization_token_limits"
    __table_args__ = (
        CheckConstraint("per_venture_limit IS NULL OR per_venture_limit > 0", name="ck_token_limits_venture"),
        CheckConstraint("organization_limit IS NULL OR organization_limit > 0", name="ck_token_limits_org"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    per_venture_limit: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    organization_limit: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
