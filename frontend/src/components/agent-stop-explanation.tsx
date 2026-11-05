"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleHelp, Wrench } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { getTokenUsage, type AgentRun } from "@/lib/api";

/** Why a run stopped, as a key under AgentRun.why.reasons. */
export function stopReason(run: AgentRun): string {
  if (run.status === "cancelled") return run.error === "venture_archived" ? "venture_archived" : "stopped_by_user";
  return run.error ?? "unknown";
}

const KNOWN_REASONS = [
  "limit_reached",
  "token_limit_reached",
  "interrupted",
  "agent_error",
  "no_result",
  "no_conversations",
  "location_required",
  "venture_archived",
  "stopped_by_user",
];

// The AI service's error types (the runner records only the type's name).
const AI_ERRORS = [
  "RateLimitError",
  "AuthenticationError",
  "PermissionDeniedError",
  "APIConnectionError",
  "APITimeoutError",
  "BadRequestError",
  "InternalServerError",
];

/**
 * "Tell me why the agent stopped": what happened, the run's facts, and
 * steps to fix it -- built from the run's own record (no AI call).
 */
export function AgentStopExplanation({
  run,
  ventureId,
  onRunAgain,
}: {
  run: AgentRun;
  ventureId: string;
  onRunAgain: () => void;
}) {
  const t = useTranslations("AgentRun.why");
  const format = useFormatter();
  const reason = KNOWN_REASONS.includes(stopReason(run)) ? stopReason(run) : "unknown";
  // For a token-limit stop: the current totals (they may have changed since).
  const usage = useQuery({
    queryKey: ["token-usage"],
    queryFn: getTokenUsage,
    enabled: reason === "token_limit_reached",
  }).data;
  const steps = t.raw(`reasons.${reason}.fix`) as string[];

  // The runner's own record of the failure, when there is one.
  const lastProblem = [...run.steps].reverse().find((s) => s.kind === "error" || s.kind === "limit");
  const errorName = typeof lastProblem?.result?.error === "string" ? lastProblem.result.error : null;
  const corrected = run.steps.filter((s) => s.kind === "error").length - (reason === "agent_error" ? 1 : 0);

  // "Current Tokens Used" and "Token Usage Limit" when a token limit stopped it.
  const recorded = lastProblem?.result ?? {};
  const number = (value: unknown) => (typeof value === "number" ? value : null);
  let figures: { used: number | null; limit: number | null; scope: string } | null = null;
  if (reason === "token_limit_reached") {
    const organization = recorded.cap === "organization_token_limit";
    const live = usage
      ? organization
        ? { used: usage.organization_total, limit: usage.limits.organization_limit }
        : {
            used: usage.ventures.find((v) => v.venture_id === ventureId)?.tokens ?? null,
            limit: usage.limits.per_venture_limit,
          }
      : null;
    figures = {
      used: live?.used ?? number(recorded.used),
      limit: live?.limit ?? number(recorded.limit),
      scope: organization ? t("scopeOrganization") : t("scopeVenture"),
    };
  } else if (reason === "limit_reached" && recorded.reason === "tokens") {
    figures = { used: number(recorded.tokens_used), limit: number(recorded.token_limit), scope: t("scopeRun") };
  }

  let detail: string | null = null;
  const problem = typeof lastProblem?.result?.problem === "string" ? lastProblem.result.problem : null;
  if (reason === "agent_error" && problem === "ai_quota_exhausted") {
    detail = t("aiErrors.quota");
  } else if (reason === "agent_error") {
    detail = errorName && AI_ERRORS.includes(errorName) ? t(`aiErrors.${errorName}`) : t("aiErrors.other", { name: errorName ?? "?" });
  } else if (reason === "token_limit_reached") {
    detail = lastProblem?.result?.cap === "organization_token_limit" ? t("capOrganization") : t("capVenture");
  } else if (reason === "limit_reached") {
    detail = t("runLimits", { tokens: format.number(run.tokens_used), turns: run.model_turns });
  }

  return (
    <div
      role="region"
      aria-labelledby="agent-why-title"
      className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm"
      data-testid="agent-why"
    >
      <h4 id="agent-why-title" className="flex items-center gap-2 font-semibold">
        <CircleHelp aria-hidden className="size-4 text-indigo-700" />
        {t("title")}
      </h4>

      <div>
        <p className="font-medium">{t("whatHappened")}</p>
        <p>{t(`reasons.${reason}.what`)}</p>
        {detail && <p className="text-muted-foreground mt-1">{detail}</p>}
      </div>

      {figures && (
        <dl className="grid grid-cols-2 gap-2" data-testid="token-figures">
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
            <dt className="text-xs font-medium text-red-900">{t("currentTokensUsed")}</dt>
            <dd className="text-lg font-semibold tabular-nums text-red-950">
              {figures.used !== null ? format.number(figures.used) : "—"}
            </dd>
          </div>
          <div className="rounded-md border bg-slate-50 px-3 py-2">
            <dt className="text-xs font-medium text-slate-700">{t("tokenUsageLimit")}</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {figures.limit !== null ? format.number(figures.limit) : "—"}
            </dd>
          </div>
          <p className="text-muted-foreground col-span-2 text-xs">{figures.scope}</p>
        </dl>
      )}

      <dl className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <dt>{t("stoppedAt")}</dt>
          <dd className="text-foreground">
            {run.finished_at ? format.dateTime(new Date(run.finished_at), { dateStyle: "medium", timeStyle: "short" }) : "—"}
          </dd>
        </div>
        <div>
          <dt>{t("stepsDone")}</dt>
          <dd className="text-foreground tabular-nums">{run.model_turns}</dd>
        </div>
        <div>
          <dt>{t("tokensUsed")}</dt>
          <dd className="text-foreground tabular-nums">{format.number(run.tokens_used)}</dd>
        </div>
        <div>
          <dt>{t("corrected")}</dt>
          <dd className="text-foreground tabular-nums">{Math.max(corrected, 0)}</dd>
        </div>
      </dl>

      <div>
        <p className="flex items-center gap-1.5 font-medium">
          <Wrench aria-hidden className="size-4 text-indigo-700" />
          {t("howToFix")}
        </p>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          {steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </div>

      <div className="flex flex-wrap gap-2">
        {reason === "token_limit_reached" ? (
          <Link href="/settings/tokens" className="text-sm font-medium text-blue-700 hover:underline">
            {t("openTokenUsage")} →
          </Link>
        ) : (
          reason !== "venture_archived" && (
            <Button size="sm" onClick={onRunAgain}>
              {t("runAgain")}
            </Button>
          )
        )}
      </div>
    </div>
  );
}
