import logging
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import mail_templates
from app.auth import find_membership
from app.config import settings
from app.db import get_session
from app.dependencies import get_email_sender, get_google_verifier
from app.email_codes import check_code, issue_code
from app.google_auth import GoogleKeysUnavailable, GoogleTokenVerifier, InvalidGoogleToken
from app.mailer import EmailSender, OutgoingEmail
from app.models import Organization, OrganizationMember, User, UserConsent
from app.passwords import hash_password, password_problem, verify_password
from app.schemas import (
    POLICY_VERSION,
    AuthConfigRead,
    DevLoginRequest,
    EmailOnlyRequest,
    GoogleLoginRequest,
    LocationPreferencesUpdate,
    OrganizationSummary,
    PasswordLoginRequest,
    ResetPasswordRequest,
    SelectOrganizationRequest,
    SessionRead,
    SignupRequest,
    StatusResponse,
    VerifyEmailRequest,
)
from app.sessions import (
    SESSION_COOKIE,
    SessionClaims,
    clear_session_cookie,
    issue_session_token,
    read_session_token,
    set_session_cookie,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# One message for every "can't sign in" case, so responses don't reveal
# whether an email is registered or linked to another Google account.
NOT_INVITED = "This account has not been invited"

# Machine-readable reasons the frontend turns into messages. Only returned
# once the caller has proven who they are (correct password or Google token).
EMAIL_NOT_VERIFIED = "email_not_verified"
PENDING_APPROVAL = "pending_approval"
ACCOUNT_DISABLED = "account_disabled"


def _account_status_error(user: User) -> HTTPException | None:
    if user.account_status == "pending":
        return HTTPException(status_code=403, detail=PENDING_APPROVAL)
    if user.account_status != "active":
        return HTTPException(status_code=403, detail=ACCOUNT_DISABLED)
    return None


async def _memberships(
    session: AsyncSession, user_id: uuid.UUID
) -> list[tuple[Organization, str]]:
    rows = await session.execute(
        select(Organization, OrganizationMember.role)
        .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
        .where(OrganizationMember.user_id == user_id)
        .order_by(Organization.name)
    )
    return [(org, role) for org, role in rows.all()]


def _session_read(
    user: User,
    memberships: list[tuple[Organization, str]],
    active_organization_id: uuid.UUID | None,
) -> SessionRead:
    active = next(
        (org.slug for org, _ in memberships if org.id == active_organization_id), None
    )
    return SessionRead(
        email=user.email,
        display_name=user.display_name,
        organizations=[
            OrganizationSummary(slug=org.slug, name=org.name, role=role)
            for org, role in memberships
        ],
        active_organization=active,
        default_country=user.default_country,
        default_metro_city=user.default_metro_city,
        has_password=user.password_hash is not None,
    )


def _start_session(
    response: Response, user: User, memberships: list[tuple[Organization, str]]
) -> SessionRead:
    # With a single organization there's nothing to choose; otherwise the
    # user picks one via /select-organization before reaching any data.
    active_id = memberships[0][0].id if len(memberships) == 1 else None
    set_session_cookie(response, issue_session_token(user.id, active_id))
    return _session_read(user, memberships, active_id)


def _current_claims(request: Request) -> SessionClaims:
    token = request.cookies.get(SESSION_COOKIE)
    claims = read_session_token(token) if token else None
    if claims is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return claims


@router.get("/config", response_model=AuthConfigRead)
async def auth_config() -> AuthConfigRead:
    return AuthConfigRead(
        google_client_id=settings.google_client_id or None,
        dev_login_enabled=settings.dev_login_enabled,
    )


@router.post("/google", response_model=SessionRead)
async def google_login(
    payload: GoogleLoginRequest,
    response: Response,
    session: AsyncSession = Depends(get_session),
    verifier: GoogleTokenVerifier = Depends(get_google_verifier),
) -> SessionRead:
    """Signs in an invited user with a Google ID token.

    Accounts are matched by Google's stable subject id; on a user's first
    Google sign-in we fall back to their (Google-verified) email and link
    the subject id. Never creates users or organizations.
    """
    try:
        identity = await run_in_threadpool(verifier.verify, payload.credential)
    except InvalidGoogleToken:
        raise HTTPException(status_code=401, detail="Google sign-in could not be verified")
    except GoogleKeysUnavailable:
        raise HTTPException(
            status_code=503, detail="Google sign-in is temporarily unavailable"
        )

    user = (
        await session.execute(select(User).where(User.google_subject == identity.subject))
    ).scalar_one_or_none()

    if user is None:
        user = (
            await session.execute(
                select(User).where(func.lower(User.email) == identity.email.lower())
            )
        ).scalar_one_or_none()
        # Already linked to a different Google account: refuse rather than
        # let whoever now holds this address take the account over.
        if user is None or user.google_subject is not None:
            raise HTTPException(status_code=403, detail=NOT_INVITED)
        user.google_subject = identity.subject

    if user.display_name is None and identity.name:
        user.display_name = identity.name
    # Google has verified that this person controls the address.
    if user.email_verified_at is None:
        user.email_verified_at = datetime.now(UTC)

    if (status_error := _account_status_error(user)) is not None:
        raise status_error
    memberships = await _memberships(session, user.id)
    if not memberships:
        raise HTTPException(status_code=403, detail=NOT_INVITED)

    # Issue the session before committing the account link, so a session
    # configuration error doesn't leave a half-finished sign-in behind.
    session_read = _start_session(response, user, memberships)
    await session.commit()
    return session_read


@router.post("/dev-login", response_model=SessionRead)
async def dev_login(
    payload: DevLoginRequest,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> SessionRead:
    """Development-only sign-in by email, for running locally without Google.

    Issues the same session cookie as Google sign-in. Disabled in production.
    """
    if not settings.dev_login_enabled:
        raise HTTPException(status_code=501, detail="Dev sign-in is disabled")

    user = (
        await session.execute(select(User).where(User.email == payload.email.strip()))
    ).scalar_one_or_none()
    memberships = await _memberships(session, user.id) if user is not None else []
    if user is None or not memberships:
        raise HTTPException(status_code=401, detail="Unknown user or organization")
    if (status_error := _account_status_error(user)) is not None:
        raise status_error

    return _start_session(response, user, memberships)


@router.post("/select-organization", response_model=SessionRead)
async def select_organization(
    payload: SelectOrganizationRequest,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> SessionRead:
    claims = _current_claims(request)
    user = await session.get(User, claims.user_id)
    if user is None or user.account_status != "active":
        raise HTTPException(status_code=401, detail="Not signed in")

    organization = (
        await session.execute(select(Organization).where(Organization.slug == payload.slug))
    ).scalar_one_or_none()
    # Membership is checked server-side; the slug only says which of the
    # user's own organizations they want.
    if organization is None or await find_membership(session, user.id, organization.id) is None:
        raise HTTPException(status_code=403, detail="Not a member of this organization")

    set_session_cookie(response, issue_session_token(user.id, organization.id))
    return _session_read(user, await _memberships(session, user.id), organization.id)


@router.get("/me", response_model=SessionRead)
async def me(request: Request, session: AsyncSession = Depends(get_session)) -> SessionRead:
    claims = _current_claims(request)
    user = await session.get(User, claims.user_id)
    memberships = await _memberships(session, user.id) if user is not None else []
    if user is None or not memberships or user.account_status != "active":
        raise HTTPException(status_code=401, detail="Not signed in")
    return _session_read(user, memberships, claims.organization_id)


@router.post("/logout", status_code=204)
async def logout(response: Response) -> Response:
    clear_session_cookie(response)
    response.status_code = 204
    return response


# --- Self-service sign-up and password sign-in -------------------------

ACCEPTED = StatusResponse(status="accepted")
INVALID_CREDENTIALS = "Invalid email or password"
INVALID_CODE = "invalid_code"
TOO_MANY_ATTEMPTS = "too_many_attempts"


async def _user_by_email(session: AsyncSession, email: str) -> User | None:
    return (
        await session.execute(select(User).where(func.lower(User.email) == email.lower()))
    ).scalar_one_or_none()


async def _send(sender: EmailSender, message: OutgoingEmail) -> None:
    try:
        await run_in_threadpool(sender.send, message)
    except Exception:
        logger.exception("Failed to send email %r to %s", message.subject, message.to)
        raise HTTPException(
            status_code=503, detail="Email could not be sent. Please try again later."
        )


def _require_acceptable_password(password: str, email: str) -> None:
    if (problem := password_problem(password, email)) is not None:
        raise HTTPException(status_code=422, detail=problem)


@router.post("/signup", response_model=StatusResponse, status_code=202)
async def signup(
    payload: SignupRequest,
    session: AsyncSession = Depends(get_session),
    sender: EmailSender = Depends(get_email_sender),
) -> StatusResponse:
    """Registers a new account: pending until email verification + admin approval.

    The response is identical whether or not the email is already taken, so
    sign-up can't be used to discover who has an account.
    """
    _require_acceptable_password(payload.password, payload.email)
    existing = await _user_by_email(session, payload.email)

    # An unfinished sign-up (never verified) proves nothing about who owns
    # the address, so a new sign-up simply replaces it.
    unfinished = (
        existing is not None
        and existing.account_status == "pending"
        and existing.email_verified_at is None
        and existing.password_hash is not None
    )
    if existing is not None and not unfinished:
        await _send(
            sender, mail_templates.already_registered(existing.email, existing.preferred_language)
        )
        return ACCEPTED

    password_hash = await run_in_threadpool(hash_password, payload.password)
    user = existing or User(email=payload.email, account_status="pending")
    user.display_name = payload.full_name
    user.password_hash = password_hash
    user.affiliation = payload.affiliation
    user.affiliation_name = payload.affiliation_name
    user.department = payload.department
    user.preferred_language = payload.preferred_language
    user.access_reason = payload.access_reason
    if existing is None:
        session.add(user)
    else:
        await session.execute(delete(UserConsent).where(UserConsent.user_id == user.id))
    try:
        await session.flush()
    except IntegrityError:
        # Lost a race with a concurrent sign-up for the same address.
        await session.rollback()
        return ACCEPTED

    for consent_type in ("terms", "privacy", "ai_processing"):
        session.add(
            UserConsent(user_id=user.id, consent_type=consent_type, policy_version=POLICY_VERSION)
        )
    code = await issue_code(session, user.id, "verify_email")
    await session.commit()

    if code is not None:
        await _send(
            sender,
            mail_templates.verification_code(
                user.email, user.preferred_language, code, settings.email_code_ttl_minutes
            ),
        )
    return ACCEPTED


@router.post("/verify-email", response_model=StatusResponse)
async def verify_email(
    payload: VerifyEmailRequest,
    session: AsyncSession = Depends(get_session),
    sender: EmailSender = Depends(get_email_sender),
) -> StatusResponse:
    """Confirms the address with the emailed code plus the account's password."""
    user = await _user_by_email(session, payload.email)
    password_ok = await run_in_threadpool(
        verify_password, user.password_hash if user else None, payload.password
    )
    if user is None or not password_ok or user.email_verified_at is not None:
        raise HTTPException(status_code=400, detail=INVALID_CODE)

    valid = await check_code(session, user.id, "verify_email", payload.code)
    if valid:
        user.email_verified_at = datetime.now(UTC)
    await session.commit()  # also records a failed attempt
    if not valid:
        raise HTTPException(status_code=400, detail=INVALID_CODE)

    if settings.signup_notify_email:
        try:
            await _send(
                sender,
                mail_templates.new_signup_for_admin(
                    settings.signup_notify_email,
                    full_name=user.display_name or "",
                    email=user.email,
                    affiliation=user.affiliation or "",
                    affiliation_name=user.affiliation_name,
                    department=user.department,
                    access_reason=user.access_reason or "",
                ),
            )
        except HTTPException:
            pass  # already logged; the user's verification still succeeded
    return StatusResponse(status=PENDING_APPROVAL)


@router.post("/resend-verification", response_model=StatusResponse, status_code=202)
async def resend_verification(
    payload: EmailOnlyRequest,
    session: AsyncSession = Depends(get_session),
    sender: EmailSender = Depends(get_email_sender),
) -> StatusResponse:
    user = await _user_by_email(session, payload.email)
    if (
        user is None
        or user.email_verified_at is not None
        or user.password_hash is None
        or user.account_status != "pending"
    ):
        return ACCEPTED
    code = await issue_code(session, user.id, "verify_email")
    await session.commit()
    if code is not None:
        await _send(
            sender,
            mail_templates.verification_code(
                user.email, user.preferred_language, code, settings.email_code_ttl_minutes
            ),
        )
    return ACCEPTED


@router.post("/login", response_model=SessionRead)
async def password_login(
    payload: PasswordLoginRequest,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> SessionRead:
    user = await _user_by_email(session, payload.email)
    now = datetime.now(UTC)

    if user is not None and user.locked_until is not None and user.locked_until > now:
        await run_in_threadpool(verify_password, None, payload.password)  # same timing
        raise HTTPException(status_code=429, detail=TOO_MANY_ATTEMPTS)

    password_ok = await run_in_threadpool(
        verify_password, user.password_hash if user else None, payload.password
    )
    if user is None or not password_ok:
        if user is not None and user.password_hash is not None:
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= settings.login_max_failed_attempts:
                user.locked_until = now + timedelta(minutes=settings.login_lockout_minutes)
                user.failed_login_attempts = 0
            await session.commit()
        raise HTTPException(status_code=401, detail=INVALID_CREDENTIALS)

    if user.failed_login_attempts or user.locked_until is not None:
        user.failed_login_attempts = 0
        user.locked_until = None
        await session.commit()

    if user.email_verified_at is None:
        raise HTTPException(status_code=403, detail=EMAIL_NOT_VERIFIED)
    if (status_error := _account_status_error(user)) is not None:
        raise status_error
    memberships = await _memberships(session, user.id)
    if not memberships:
        # Active but not yet placed in an organization.
        raise HTTPException(status_code=403, detail=PENDING_APPROVAL)
    return _start_session(response, user, memberships)


@router.post("/forgot-password", response_model=StatusResponse, status_code=202)
async def forgot_password(
    payload: EmailOnlyRequest,
    session: AsyncSession = Depends(get_session),
    sender: EmailSender = Depends(get_email_sender),
) -> StatusResponse:
    """Emails a reset code to a verified account. Always 202, account or not."""
    user = await _user_by_email(session, payload.email)
    if (
        user is None
        or user.account_status not in ("active", "pending")
        or (user.email_verified_at is None and user.google_subject is None)
    ):
        return ACCEPTED
    code = await issue_code(session, user.id, "reset_password")
    await session.commit()
    if code is not None:
        await _send(
            sender,
            mail_templates.password_reset_code(
                user.email, user.preferred_language, code, settings.email_code_ttl_minutes
            ),
        )
    return ACCEPTED


@router.post("/reset-password", response_model=StatusResponse)
async def reset_password(
    payload: ResetPasswordRequest,
    session: AsyncSession = Depends(get_session),
) -> StatusResponse:
    _require_acceptable_password(payload.new_password, payload.email)
    user = await _user_by_email(session, payload.email)
    if user is None:
        raise HTTPException(status_code=400, detail=INVALID_CODE)

    valid = await check_code(session, user.id, "reset_password", payload.code)
    if valid:
        user.password_hash = await run_in_threadpool(hash_password, payload.new_password)
        user.failed_login_attempts = 0
        user.locked_until = None
        # The code reached this inbox, which proves ownership of the address.
        if user.email_verified_at is None:
            user.email_verified_at = datetime.now(UTC)
    await session.commit()  # also records a failed attempt
    if not valid:
        raise HTTPException(status_code=400, detail=INVALID_CODE)
    return StatusResponse(status="password_reset")


@router.patch("/me/preferences", response_model=SessionRead)
async def update_preferences(
    payload: LocationPreferencesUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> SessionRead:
    """Saves the signed-in user's default location (for Stage 6). An empty
    value clears it. Only ever changes the caller's own account."""
    claims = _current_claims(request)
    user = await session.get(User, claims.user_id)
    if user is None or user.account_status != "active":
        raise HTTPException(status_code=401, detail="Not signed in")
    user.default_country = payload.default_country
    user.default_metro_city = payload.default_metro_city
    memberships = await _memberships(session, user.id)
    await session.commit()
    return _session_read(user, memberships, claims.organization_id)
