import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Integer, LargeBinary, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import CreatedAtMixin, UUIDPKMixin

ASSET_CONTENT_TYPES = ("image/webp", "image/png", "image/jpeg")
MAX_ASSET_BYTES = 5_000_000


class VentureAsset(Base, UUIDPKMixin, CreatedAtMixin):
    """A generated file owned by a venture (e.g. the Stage 9 MVP product image).

    Tenant-isolated by row-level security on organization_id, like ai_runs.
    Served only through GET /api/ventures/{venture_id}/assets/{asset_id}.
    """

    __tablename__ = "venture_assets"
    __table_args__ = (
        CheckConstraint(
            "content_type IN ('image/webp', 'image/png', 'image/jpeg')",
            name="ck_venture_asset_content_type",
        ),
        CheckConstraint(f"byte_size > 0 AND byte_size <= {MAX_ASSET_BYTES}", name="ck_venture_asset_size"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True
    )
    venture_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ventures.id"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String, nullable=False)
    content_type: Mapped[str] = mapped_column(String, nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
