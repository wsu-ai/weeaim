import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class VentureCreate(BaseModel):
    idea: str = Field(min_length=20, max_length=2000)


class VentureRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID
    title: str
    original_idea: str
    current_idea_statement: str | None
    status: str
    current_wizard_stage: str
    created_at: datetime


class VentureSummary(VentureRead):
    """A venture in the "My ventures" list, with saved progress."""

    completed_stages: int
    total_stages: int
    feasibility_score: int | None
    researched_at: str | None
    updated_at: datetime
    # Whether the signed-in user may delete it (creator or org owner/admin).
    can_delete: bool


class ResearchRunRead(BaseModel):
    """One saved Stage 1 research run (from ai_runs)."""

    id: uuid.UUID
    created_at: datetime
    research: dict


class DevLoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class GoogleLoginRequest(BaseModel):
    # The ID token ("credential") from Google Identity Services.
    credential: str = Field(min_length=1, max_length=8192)


class SelectOrganizationRequest(BaseModel):
    slug: str = Field(min_length=1, max_length=200)


class OrganizationSummary(BaseModel):
    slug: str
    name: str
    role: str


class SessionRead(BaseModel):
    email: str
    display_name: str | None
    organizations: list[OrganizationSummary]
    # Slug of the organization this session acts in; None until chosen.
    active_organization: str | None


class AuthConfigRead(BaseModel):
    google_client_id: str | None
    dev_login_enabled: bool


# --- Self-service sign-up (docs/sign-up-and-approval.md) ---

# Bump when the Terms / Privacy / AI-processing texts change; stored with
# each consent so we know which version a user agreed to.
POLICY_VERSION = "2026-10-draft"

_EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
Affiliation = Literal[
    "woosong_student", "woosong_faculty_staff", "woosong_alumni", "external_founder", "other"
]
WOOSONG_AFFILIATIONS = ("woosong_student", "woosong_faculty_staff", "woosong_alumni")


def _normalize_email(value: str) -> str:
    return value.strip().lower()


class SignupRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    email: str = Field(max_length=320, pattern=_EMAIL_PATTERN)
    password: str = Field(min_length=1, max_length=256)
    affiliation: Affiliation
    affiliation_name: str | None = Field(default=None, max_length=200)
    department: str | None = Field(default=None, max_length=200)
    preferred_language: Literal["en", "ko"]
    access_reason: str = Field(min_length=10, max_length=500)
    accept_terms: bool
    accept_privacy: bool
    accept_ai_processing: bool

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return _normalize_email(value) if isinstance(value, str) else value

    @field_validator("full_name", "affiliation_name", "department", "access_reason", mode="before")
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value

    @model_validator(mode="after")
    def check_affiliation_and_consents(self) -> "SignupRequest":
        if self.affiliation in WOOSONG_AFFILIATIONS:
            self.affiliation_name = "Woosong University"
        elif not self.affiliation_name:
            raise ValueError("affiliation_name is required for this affiliation")
        if not (self.accept_terms and self.accept_privacy and self.accept_ai_processing):
            raise ValueError("All consents are required")
        return self


class EmailOnlyRequest(BaseModel):
    email: str = Field(max_length=320)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return _normalize_email(value) if isinstance(value, str) else value


class VerifyEmailRequest(EmailOnlyRequest):
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    # Required alongside the code: only the person who chose this password
    # (and can read the inbox) can activate the registration.
    password: str = Field(min_length=1, max_length=256)


class PasswordLoginRequest(EmailOnlyRequest):
    password: str = Field(min_length=1, max_length=256)


class ResetPasswordRequest(EmailOnlyRequest):
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    new_password: str = Field(min_length=1, max_length=256)


class StatusResponse(BaseModel):
    status: str


# --- Admin dashboard: sign-up review ---

class SignupReviewItem(BaseModel):
    id: uuid.UUID
    full_name: str | None
    email: str
    affiliation: str | None
    affiliation_name: str | None
    department: str | None
    preferred_language: str
    access_reason: str | None
    registered_at: datetime
    verified_at: datetime | None
    status: str
    reviewed_at: datetime | None
    reviewed_by: str | None
    review_note: str | None
    # Names of the organizations an approved user belongs to.
    organizations: list[str]


class AdminOrganization(BaseModel):
    slug: str
    name: str
    # Roles this admin may grant when approving into this organization.
    grantable_roles: list[str]


class ApproveSignupRequest(BaseModel):
    organization_slug: str = Field(min_length=1, max_length=200)
    role: Literal["owner", "admin", "member"] = "member"


class RejectSignupRequest(BaseModel):
    note: str | None = Field(default=None, max_length=500)

    @field_validator("note", mode="before")
    @classmethod
    def strip_note(cls, value: str | None) -> str | None:
        if isinstance(value, str):
            return value.strip() or None
        return value


class ReviewResult(BaseModel):
    status: str
    email_sent: bool
