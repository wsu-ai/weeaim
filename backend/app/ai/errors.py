"""Telling AI service failures apart, so users get a message they can act on.

"Out of credits" can't be fixed by trying again, unlike a busy service.
"""

from openai import AuthenticationError, OpenAIError, PermissionDeniedError, RateLimitError

QUOTA_EXHAUSTED = "ai_quota_exhausted"
RATE_LIMITED = "ai_rate_limited"
AUTH_FAILED = "ai_auth_failed"

_QUOTA_CODES = {"insufficient_quota", "credit_balance_exhausted", "billing_hard_limit_reached"}


def _error_fields(exc: OpenAIError) -> set[str]:
    fields = {str(getattr(exc, "code", "") or "")}
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        error = body.get("error") if isinstance(body.get("error"), dict) else body
        fields |= {str(error.get("code") or ""), str(error.get("type") or "")}
    return fields


def ai_problem(exc: BaseException) -> str | None:
    """QUOTA_EXHAUSTED, RATE_LIMITED or AUTH_FAILED for those AI service
    errors; None for anything else."""
    if isinstance(exc, RateLimitError):
        return QUOTA_EXHAUSTED if _error_fields(exc) & _QUOTA_CODES else RATE_LIMITED
    if isinstance(exc, (AuthenticationError, PermissionDeniedError)):
        return AUTH_FAILED
    return None
