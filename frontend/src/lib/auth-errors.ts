import { ApiError } from "@/lib/api";

// Errors that mean "the service is down", not "your input was wrong": a 503
// from the backend (e.g. its database is unreachable), or no response at all
// (backend not running -- fetch rejects without an ApiError).
export function isServiceUnavailable(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 503;
}

type Translate = (key: string) => string;

/**
 * Picks a user-facing message for a failed auth request: by the backend's
 * reason code first, then by HTTP status, then a generic failure. The
 * fallback messages live in the "Login" namespace.
 */
export function authErrorMessage(
  error: unknown,
  tLogin: Translate,
  { byDetail = {}, byStatus = {} }: { byDetail?: Record<string, string>; byStatus?: Record<number, string> } = {},
): string {
  const apiError = error as ApiError;
  // The AI service refused the app's account (backend/app/ai/errors.py).
  if (error instanceof ApiError && error.status === 503) {
    if (error.detail === "ai_quota_exhausted") return tLogin("aiQuotaExhausted");
    if (error.detail === "ai_rate_limited") return tLogin("aiRateLimited");
    if (error.detail === "ai_auth_failed") return tLogin("aiAuthFailed");
  }
  if (isServiceUnavailable(error)) return tLogin("errorUnavailable");
  // A token cap was reached (backend/app/tokens.py): the same message everywhere.
  if (apiError.status === 429 && apiError.detail === "venture_token_limit") return tLogin("tokenLimitVenture");
  if (apiError.status === 429 && apiError.detail === "organization_token_limit") return tLogin("tokenLimitOrganization");
  return (
    (apiError.detail ? byDetail[apiError.detail] : undefined) ??
    byStatus[apiError.status] ??
    tLogin("errorFailed")
  );
}

export function errorDetail(error: unknown): string | null {
  return error instanceof ApiError ? error.detail : null;
}
