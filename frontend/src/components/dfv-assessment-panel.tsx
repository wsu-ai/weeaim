"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronRight, RefreshCw, XCircle } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { ActionChecklist } from "@/components/action-checklist";
import { Button } from "@/components/ui/button";
import {
  isDfvAssessment,
  researchStage,
  type DfvAssessmentAnalysis,
  type DfvDimension,
  type DfvRating,
  type DfvVerdict,
} from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";

const DIMENSIONS: DfvDimension[] = ["desirability", "feasibility", "viability"];

// Verdicts carry an icon and a text label, never colour alone.
const VERDICT_STYLE: Record<DfvVerdict, { icon: typeof CheckCircle2; classes: string }> = {
  proceed: { icon: CheckCircle2, classes: "border-green-300 bg-green-50 text-green-900" },
  strengthen: { icon: AlertTriangle, classes: "border-amber-300 bg-amber-50 text-amber-900" },
  rethink: { icon: XCircle, classes: "border-red-300 bg-red-50 text-red-900" },
};
const RATING_CLASSES: Record<DfvRating, string> = {
  strong: "bg-green-50 text-green-800",
  moderate: "bg-amber-50 text-amber-800",
  weak: "bg-red-50 text-red-800",
};

// The same bands as the verdict: 70+ proceed, under 40 rethink.
// An area scoring below this is flagged with a bold red border.
const LOW_SCORE = 40;
const isLow = (score: number) => score < LOW_SCORE;

function barColor(score: number): string {
  if (score >= 70) return "bg-green-600";
  if (score < 40) return "bg-red-600";
  return "bg-amber-500";
}

/**
 * Stage 8: desirability, feasibility and viability rated by the AI from the
 * evidence in stages 1-7. The scores and verdict are calculated by the
 * server from those ratings. Ends with action items for the weakest criteria.
 */
export function DfvAssessmentPanel({
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
  analysis: DfvAssessmentAnalysis | null;
  language: "en" | "ko";
  /** IDs of the action items the founder has ticked off. */
  completedActions: string[];
  onToggleAction: (actionId: string, done: boolean) => void;
  onResearched: () => void;
  /** Showing an earlier saved run instead of the latest assessment. */
  historical?: boolean;
  onBackToLatest?: () => void;
}) {
  const t = useTranslations("DfvAssessment");
  const tLogin = useTranslations("Login");
  const format = useFormatter();
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  const researchMutation = useMutation({
    mutationFn: () => researchStage(ventureId, "dfv_assessment", language),
    onSuccess: onResearched,
  });

  // Assess once, automatically, when there's nothing yet.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!analysis && !historical && !autoStarted.current) {
      autoStarted.current = true;
      researchMutation.mutate();
    }
  }, [analysis, historical, researchMutation]);

  const fresh = isDfvAssessment(researchMutation.data ?? null) ? researchMutation.data : null;
  const shown = historical ? analysis : (fresh ?? analysis);

  return (
    <section aria-labelledby="dfv-assessment-title" className="flex flex-col gap-4 rounded-lg border bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="dfv-assessment-title" className="font-semibold">
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
        <AssessmentBody
          assessment={shown}
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

function AssessmentBody({
  assessment,
  completedActions,
  onToggleAction,
  readOnly,
}: {
  assessment: DfvAssessmentAnalysis;
  completedActions: string[];
  onToggleAction: (actionId: string, done: boolean) => void;
  readOnly: boolean;
}) {
  const t = useTranslations("DfvAssessment");
  const format = useFormatter();
  const percent = (score: number) => format.number(score / 100, { style: "percent", maximumFractionDigits: 0 });
  const { icon: VerdictIcon, classes } = VERDICT_STYLE[assessment.verdict];
  const criterionName = (name: string) => (t.has(`criteria.${name}`) ? t(`criteria.${name}`) : name);

  return (
    <>
      <p className="text-sm leading-relaxed">{assessment.summary}</p>

      <div role="status" className={`flex items-start gap-3 rounded-md border-2 p-3 ${classes}`} data-testid="dfv-verdict">
        <VerdictIcon aria-hidden className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-semibold">{t(`verdicts.${assessment.verdict}.title`)}</p>
          <p className="text-sm">{t(`verdicts.${assessment.verdict}.description`)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[...DIMENSIONS, "overall" as const].map((key) => {
          const score = assessment.scores[key];
          const label = key === "overall" ? t("overall") : t(`dimensions.${key}`);
          const low = key !== "overall" && isLow(score);
          return (
            <div
              key={key}
              className={`rounded-md p-3 ${
                low ? "border-2 border-red-600 bg-red-50" : `border bg-white ${key === "overall" ? "border-blue-300" : ""}`
              }`}
              data-testid={`dfv-score-${key}`}
              data-low={low || undefined}
            >
              <p className="text-muted-foreground flex items-center justify-between gap-1 text-xs">
                {label}
                {low && <span className="font-semibold text-red-700">{t("lowScore")}</span>}
              </p>
              <p className="text-2xl font-bold tabular-nums">{percent(score)}</p>
              <span
                role="progressbar"
                aria-label={t("scoresLabel", { dimension: label })}
                aria-valuenow={score}
                aria-valuemin={0}
                aria-valuemax={100}
                className="bg-muted mt-1 block h-1.5 w-full overflow-hidden rounded-full"
              >
                <span className={`block h-full rounded-full ${barColor(score)}`} style={{ width: `${score}%` }} />
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-muted-foreground -mt-2 text-xs">{t("scoreNote")}</p>

      {DIMENSIONS.map((dimension) => (
        <details
          key={dimension}
          className={`group rounded-md bg-white ${
            isLow(assessment.scores[dimension]) ? "border-2 border-red-600" : "border"
          }`}
          data-testid={`dfv-section-${dimension}`}
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-90" />
            <span className="flex-1">
              {t(`dimensions.${dimension}`)}{" "}
              <span className="text-muted-foreground font-normal">· {t(`dimensionQuestions.${dimension}`)}</span>
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
                isLow(assessment.scores[dimension]) ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700"
              }`}
            >
              {percent(assessment.scores[dimension])}
            </span>
          </summary>
          <div className="overflow-x-auto border-t">
            <table className="w-full text-left text-xs" data-testid={`dfv-criteria-${dimension}`}>
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="p-2 font-semibold">{t("columns.criterion")}</th>
                  <th scope="col" className="p-2 font-semibold">{t("columns.rating")}</th>
                  <th scope="col" className="p-2 font-semibold">{t("columns.why")}</th>
                  <th scope="col" className="p-2 font-semibold">{t("columns.evidence")}</th>
                </tr>
              </thead>
              <tbody>
                {assessment.dimensions[dimension].map((row) => (
                  <tr key={row.criterion} className="border-t align-top" data-testid={`dfv-criterion-${row.criterion}`}>
                    <th scope="row" className="p-2 font-medium">{criterionName(row.criterion)}</th>
                    <td className="p-2">
                      <span className={`rounded px-1.5 py-0.5 whitespace-nowrap ${RATING_CLASSES[row.rating]}`}>
                        {t(`ratings.${row.rating}`)}
                      </span>
                    </td>
                    <td className="p-2">{row.reason}</td>
                    <td className="p-2">
                      <p>
                        {row.evidence}{" "}
                        <span className="rounded bg-slate-100 px-1 py-0.5 whitespace-nowrap text-slate-700">
                          {t.has(`evidenceStages.${row.evidence_stage}`)
                            ? t(`evidenceStages.${row.evidence_stage}`)
                            : row.evidence_stage}
                        </span>
                      </p>
                      {row.evidence_gap && (
                        <p className="mt-1 text-red-900">
                          <span className="font-semibold">{t("missing")}</span> {row.evidence_gap}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}

      {assessment.assumptions_to_test.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-semibold">{t("assumptionsTitle")}</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {assessment.assumptions_to_test.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <ActionChecklist
        groups={DIMENSIONS.map((dimension) => ({
          key: dimension,
          title: t(`dimensions.${dimension}`),
          items: assessment.action_items.filter((item) => item.dimension === dimension),
        }))}
        completedActions={completedActions}
        onToggle={onToggleAction}
        readOnly={readOnly}
        showTimeframe
        collapsible
        meta={(item) => (
          <p className="text-xs text-blue-800">{t("strengthens", { criterion: criterionName(item.criterion) })}</p>
        )}
      />
    </>
  );
}
