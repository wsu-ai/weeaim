import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import CreatedAtMixin, UUIDPKMixin


class EvidenceItem(Base, UUIDPKMixin, CreatedAtMixin):
    __tablename__ = "evidence_items"
    __table_args__ = (
        CheckConstraint(
            "supports_or_contradicts IN ('supports', 'contradicts', 'neutral')",
            name="ck_evidence_supports_or_contradicts",
        ),
    )

    venture_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ventures.id"), nullable=False, index=True
    )
    # No FK yet: the source may be a document_chunk or a future external_sources
    # record (not part of this 13-table migration) — see plan notes.
    source_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    evidence_type: Mapped[str] = mapped_column(String, nullable=False)
    extracted_statement: Mapped[str] = mapped_column(Text, nullable=False)
    source_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_url: Mapped[str | None] = mapped_column(String, nullable=True)
    publication_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    retrieved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reliability_grade: Mapped[str | None] = mapped_column(String, nullable=True)
    supports_or_contradicts: Mapped[str] = mapped_column(String, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Numeric(3, 2), nullable=True)
    classification: Mapped[str] = mapped_column(String, nullable=False, server_default="confidential")
