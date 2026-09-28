import uuid

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import CreatedAtMixin, UUIDPKMixin


class AuditLog(Base, UUIDPKMixin, CreatedAtMixin):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_org_created_at", "organization_id", "created_at"),
    )

    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True, index=True
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String, nullable=False)
    resource_type: Mapped[str] = mapped_column(String, nullable=False)
    resource_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    log_metadata: Mapped[dict] = mapped_column(
        "metadata", JSONB, nullable=False, server_default="{}"
    )
