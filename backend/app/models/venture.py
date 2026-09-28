import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import CreatedAtMixin, TimestampMixin, UUIDPKMixin


class Venture(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "ventures"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    original_idea: Mapped[str] = mapped_column(Text, nullable=False)
    current_idea_statement: Mapped[str | None] = mapped_column(Text, nullable=True)
    industry: Mapped[str | None] = mapped_column(String, nullable=True)
    geography: Mapped[str | None] = mapped_column(String, nullable=True)
    language: Mapped[str] = mapped_column(String, nullable=False, server_default="en")
    maturity_stage: Mapped[str | None] = mapped_column(String, nullable=True)
    current_wizard_stage: Mapped[str] = mapped_column(
        String, nullable=False, server_default="idea_discovery"
    )
    status: Mapped[str] = mapped_column(String, nullable=False, server_default="active")


class VentureMember(Base, UUIDPKMixin, CreatedAtMixin):
    __tablename__ = "venture_members"
    __table_args__ = (
        UniqueConstraint("venture_id", "user_id", name="uq_venture_member"),
        CheckConstraint("role IN ('owner', 'editor', 'viewer')", name="ck_venture_member_role"),
    )

    venture_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ventures.id"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String, nullable=False)


class IdeaVersion(Base, UUIDPKMixin, CreatedAtMixin):
    __tablename__ = "idea_versions"
    __table_args__ = (
        UniqueConstraint("venture_id", "version_number", name="uq_idea_version"),
    )

    venture_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ventures.id"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    idea_text: Mapped[str] = mapped_column(Text, nullable=False)
    structured_interpretation: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
