"use client";

import { useMutation } from "@tanstack/react-query";
import { ChevronRight, RefreshCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { ActionChecklist } from "@/components/action-checklist";
import { Button } from "@/components/ui/button";
import {
  isCompetitivePosition,
  researchStage,
  type ActionTimeframe,
  type CompetitivePositionAnalysis,
} from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";

const TIMEFRAMES: ActionTimeframe[] = ["this_week", "this_month", "this_quarter"];

// Links come from the web and are untrusted: open separately, share no
// referrer, and give them no ranking credit.
const EXTERNAL_LINK = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;

/**
 * Stage 7: the competitive position synthesized from stages 1-6 and their
 * research, with action items the founder ticks off as they follow through.
 * Runs automatically the first time the stage is opened; Refresh re-runs it.
 * Ticks are saved by the wizard page (with the stage's answers).
 */
export function CompetitivePositionPanel({
  ventureId,
  analysis,
  language,
  completedActions,
  onToggleAction,
  onResearched,
  historical = false,
  onBackToLatest,
}: {
  ventureId: string;
  analysis: CompetitivePositionAnalysis | null;
  language: "en" | "ko";
  /** IDs of the action items the founder has ticked off. */
  completedActions: string[];
  onToggleAction: (actionId: string, done: boolean) => void;
  onResearched: () => void;
  /** Showing an earlier saved run instead of the latest research. */
  historical?: boolean;
  onBackToLatest?: () => void;
}) {
  const t = useTranslations("CompetitivePosition");
  const tLogin = useTranslations("Login");
  const format = useFormatter();
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  const researchMutation = useMutation({
    mutationFn: () => researchStage(ventureId, "competitive_position", language),
    onSuccess: onResearched,
  });

  // Work out the position once, automatically, when there's nothing yet.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!analysis && !historical && !autoStarted.current) {
      autoStarted.current = true;
      researchMutation.mutate();
    }
  }, [analysis, historical, researchMutation]);

  const fresh = isCompetitivePosition(researchMutation.data ?? null) ? researchMutation.data : null;
  const shown = historical ? analysis : (fresh ?? analysis);

  return (
    <section aria-labelledby="competitive-position-title" className="flex flex-col gap-4 rounded-lg border bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="competitive-position-title" className="font-semibold">
          {t("title")}
        </h3>
        {!historical && (
          <Button
            size="sm"
            variant="outline"
            disabled={researchMutation.isPending}
            onClick={() => researchMutation.mutate()}
            title={t("refreshHint")}
          >
            <RefreshCw aria-hidden className={`size-4 ${researchMutation.isPending ? "animate-spin" : ""}`} />
            {researchMutation.isPending ? t("refreshing") : t("refresh")}
          </Button>
        )}
      </div>

      {historical && shown && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>{t("viewingEarlier", { date: when(shown.researched_at) })}</span>
          <Button size="sm" variant="outline" onClick={onBackToLatest}>
            {t("backToLatest")}
          </Button>
        </div>
      )}

      {researchMutation.isPending && (
        <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
          <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          {t("researching")}
        </p>
      )}

      {researchMutation.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-800">
          <span>{authErrorMessage(researchMutation.error, tLogin, { byStatus: { 503: t("failed") } })}</span>
          <Button size="sm" variant="outline" onClick={() => researchMutation.mutate()}>
            {t("retry")}
          </Button>
        </div>
      )}

      {shown && (
        <PositionBody
          position={shown}
          completedActions={completedActions}
          onToggleAction={onToggleAction}
          readOnly={historical}
        />
      )}

      {shown && (
        <p className="text-muted-foreground flex flex-col gap-0.5 border-t pt-3 text-xs">
          {shown.based_on && <span>{t("basedOn", { date: when(shown.based_on) })}</span>}
          <span>{t("disclaimer", { date: when(shown.researched_at) })}</span>
        </p>
      )}
    </section>
  );
}

function PositionBody({
  position,
  completedActions,
  onToggleAction,
  readOnly,
}: {
  position: CompetitivePositionAnalysis;
  completedActions: string[];
  onToggleAction: (actionId: string, done: boolean) => void;
  readOnly: boolean;
}) {
  const t = useTranslations("CompetitivePosition");
  const tChecklist = useTranslations("ActionChecklist");

  return (
    <>
      <p className="text-sm leading-relaxed">{position.summary}</p>

      <div className="rounded-md border-2 border-blue-200 bg-white p-4" data-testid="positioning-statement">
        <h4 className="mb-1 text-xs font-semibold tracking-wide text-blue-800 uppercase">{t("statementTitle")}</h4>
        <p className="text-base leading-relaxed font-medium">{position.positioning_statement}</p>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <div className="flex gap-1">
            <dt className="text-muted-foreground">{t("targetSegment")}</dt>
            <dd className="font-medium">{position.target_segment}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-muted-foreground">{t("marketCategory")}</dt>
            <dd className="font-medium">{position.market_category}</dd>
          </div>
        </dl>
      </div>

      <ActionChecklist
        groups={TIMEFRAMES.map((timeframe) => ({
          key: timeframe,
          title: tChecklist(`timeframes.${timeframe}`),
          items: position.action_items.filter((item) => item.timeframe === timeframe),
        }))}
        completedActions={completedActions}
        onToggle={onToggleAction}
        readOnly={readOnly}
        collapsible
      />

      {position.competitor_comparison.length > 0 && (
        <details className="group rounded-md border bg-white" data-testid="comparison-section">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-90" />
            <span className="flex-1">{t("comparisonTitle")}</span>
            <span className="text-muted-foreground rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums">
              {position.competitor_comparison.length}
            </span>
          </summary>
          <div className="overflow-x-auto border-t">
            <table className="w-full text-left text-xs" data-testid="competitor-comparison">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="p-2 font-semibold">{t("columns.competitor")}</th>
                  <th scope="col" className="p-2 font-semibold">{t("columns.theirPosition")}</th>
                  <th scope="col" className="p-2 font-semibold">{t("columns.ourAdvantage")}</th>
                  <th scope="col" className="p-2 font-semibold">{t("columns.ourGap")}</th>
                </tr>
              </thead>
              <tbody>
                {position.competitor_comparison.map((row) => (
                  <tr key={row.competitor} className="border-t align-top">
                    <th scope="row" className="p-2 font-medium">
                      {row.url ? (
                        <a href={row.url} {...EXTERNAL_LINK} className="text-blue-700 hover:underline">
                          {row.competitor} ↗
                        </a>
                      ) : (
                        <>
                          <span>{row.competitor}</span>{" "}
                          <a
                            href={row.search_url}
                            {...EXTERNAL_LINK}
                            aria-label={t("searchWebFor", { name: row.competitor })}
                            className="font-normal text-blue-700 hover:underline"
                          >
                            {t("searchWeb")} ↗
                          </a>
                        </>
                      )}
                    </th>
                    <td className="p-2">{row.their_position}</td>
                    <td className="p-2 text-green-900">{row.our_advantage}</td>
                    <td className="p-2 text-red-900">{row.our_gap}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {position.differentiators.length > 0 && (
          <div>
            <h4 className="mb-1 text-sm font-semibold">{t("differentiatorsTitle")}</h4>
            <ul className="flex flex-col gap-2 text-sm">
              {position.differentiators.map((item, index) => (
                <li key={index}>
                  <p className="font-medium">{item.claim}</p>
                  <p className="text-muted-foreground text-xs">
                    {item.evidence}{" "}
                    <span className="rounded bg-slate-100 px-1 py-0.5 whitespace-nowrap text-slate-700">
                      {t(`evidenceStages.${item.evidence_stage}`)}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-col gap-4">
          {position.risks.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-semibold">{t("risksTitle")}</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {position.risks.map((risk, index) => (
                  <li key={index}>{risk}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h4 className="mb-1 text-sm font-semibold">{t("defensibilityTitle")}</h4>
            <p className="text-sm">{position.defensibility}</p>
          </div>
        </div>
      </div>
    </>
  );
}
