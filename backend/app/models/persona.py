import uuid

from sqlalchemy import CheckConstraint, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import CreatedAtMixin, UUIDPKMixin

MAX_MESSAGE_CHARS = 4000


class PersonaMessage(Base, UUIDPKMixin, CreatedAtMixin):
    """One message in a founder's conversation with an AI persona (Stage 7).

    Tenant-isolated by row-level security on organization_id, like ai_runs.
    persona_id refers to a persona in the stage's saved answers.
    """

    __tablename__ = "persona_messages"
    __table_args__ = (
        CheckConstraint("role IN ('founder', 'persona')", name="ck_persona_message_role"),
        CheckConstraint(f"char_length(content) <= {MAX_MESSAGE_CHARS}", name="ck_persona_message_length"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True
    )
    venture_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ventures.id"), nullable=False, index=True
    )
    persona_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(10), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
