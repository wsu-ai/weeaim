import { useTranslations } from "next-intl";

import { ApiError } from "@/lib/api";

export const TOKEN_LIMIT_DETAILS = ["venture_token_limit", "organization_token_limit"] as const;

// AI account problems the server tells apart (backend/app/ai/errors.py):
// trying again won't help with these, so they get their own message.
export const AI_PROBLEM_DETAILS = ["ai_quota_exhausted", "ai_rate_limited", "ai_auth_failed"] as const;

/** The server's reason when a token cap was reached, else null. */
export function tokenLimitDetail(error: unknown): (typeof TOKEN_LIMIT_DETAILS)[number] | null {
  return error instanceof ApiError &&
    error.status === 429 &&
    (TOKEN_LIMIT_DETAILS as readonly string[]).includes(error.detail ?? "")
    ? (error.detail as (typeof TOKEN_LIMIT_DETAILS)[number])
    : null;
}

/** The server's reason when the AI service refused the app's account, else null. */
export function aiProblemDetail(error: unknown): (typeof AI_PROBLEM_DETAILS)[number] | null {
  return error instanceof ApiError &&
    error.status === 503 &&
    (AI_PROBLEM_DETAILS as readonly string[]).includes(error.detail ?? "")
    ? (error.detail as (typeof AI_PROBLEM_DETAILS)[number])
    : null;
}

/**
 * (error) => a message for a token cap or an AI account problem (out of
 * credits, rate limited, key rejected), or null for any other error.
 */
export function useTokenLimitMessage(): (error: unknown) => string | null {
  const t = useTranslations("TokenLimit");
  return (error) => {
    const detail = tokenLimitDetail(error);
    if (detail === "venture_token_limit") return t("venture");
    if (detail === "organization_token_limit") return t("organization");
    const problem = aiProblemDetail(error);
    return problem ? t(problem) : null;
  };
}
