import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import TimestampMixin, UUIDPKMixin

ACCOUNT_STATUSES = ("active", "pending", "rejected", "disabled")
AFFILIATIONS = (
    "woosong_student",
    "woosong_faculty_staff",
    "woosong_alumni",
    "external_founder",
    "other",
)
LANGUAGES = ("en", "ko")


class User(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "account_status IN ('active', 'pending', 'rejected', 'disabled')",
            name="ck_users_account_status",
        ),
        CheckConstraint(
            "affiliation IS NULL OR affiliation IN ('woosong_student', "
            "'woosong_faculty_staff', 'woosong_alumni', 'external_founder', 'other')",
            name="ck_users_affiliation",
        ),
        CheckConstraint("preferred_language IN ('en', 'ko')", name="ck_users_preferred_language"),
    )

    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    # Google's stable account id ("sub" claim), linked on first Google sign-in.
    # Matched before email, since an email address can change or be reassigned.
    google_subject: Mapped[str | None] = mapped_column(
        String, unique=True, nullable=True, index=True
    )

    # Self-service sign-up (see docs/sign-up-and-approval.md). Users created
    # by invitation or Google sign-in have no password and start "active".
    password_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    account_status: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("'active'")
    )
    affiliation: Mapped[str | None] = mapped_column(String, nullable=True)
    affiliation_name: Mapped[str | None] = mapped_column(String, nullable=True)
    department: Mapped[str | None] = mapped_column(String, nullable=True)
    preferred_language: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("'en'")
    )
    access_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    failed_login_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Who approved or rejected this sign-up, and when (admin dashboard or
    # scripts.manage_signups; the reviewer is empty for command-line reviews).
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
