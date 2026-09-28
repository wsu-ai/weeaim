import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import TimestampMixin, UUIDPKMixin


class WizardStage(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "wizard_stages"

    number: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    title_en: Mapped[str] = mapped_column(String, nullable=False)
    title_ko: Mapped[str] = mapped_column(String, nullable=False)
    objective: Mapped[str | None] = mapped_column(String, nullable=True)
    question_schema: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    output_schema: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class WizardResponse(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "wizard_responses"
    __table_args__ = (
        UniqueConstraint("venture_id", "wizard_stage_id", name="uq_wizard_response"),
        CheckConstraint(
            "status IN ('not_started', 'in_progress', 'researching', 'awaiting_user', "
            "'completed', 'needs_revision')",
            name="ck_wizard_response_status",
        ),
    )

    venture_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ventures.id"), nullable=False, index=True
    )
    wizard_stage_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("wizard_stages.id"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String, nullable=False, server_default="not_started")
    answers: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    ai_analysis: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
