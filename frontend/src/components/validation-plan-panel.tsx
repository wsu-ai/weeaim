"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleDashed, FlaskConical, HelpCircle, RefreshCw, XCircle } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  isValidationPlan,
  researchStage,
  type DecisionSignal,
  type ExperimentOutcome,
  type ValidationExperiment,
  type ValidationPlanAnalysis,
  type ValidationResults,
} from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";

// Signals and outcomes carry an icon and a text label, never colour alone.
const SIGNAL_STYLE: Record<DecisionSignal, { icon: typeof CheckCircle2; classes: string }> = {
  not_started: { icon: FlaskConical, classes: "border-slate-300 bg-white text-slate-800" },
  keep_testing: { icon: HelpCircle, classes: "border-amber-300 bg-amber-50 text-amber-900" },
  proceed: { icon: CheckCircle2, classes: "border-green-300 bg-green-50 text-green-900" },
  stop_or_pivot: { icon: XCircle, classes: "border-red-300 bg-red-50 text-red-900" },
};
const OUTCOME_STYLE: Record<ExperimentOutcome, { icon: typeof CheckCircle2; classes: string }> = {
  passed: { icon: CheckCircle2, classes: "bg-green-50 text-green-800" },
  failed: { icon: XCircle, classes: "bg-red-50 text-red-800" },
  inconclusive: { icon: HelpCircle, classes: "bg-amber-50 text-amber-800" },
  not_run: { icon: CircleDashed, classes: "bg-slate-100 text-slate-700" },
};
const RISK_CLASSES = { high: "bg-red-50 text-red-800", medium: "bg-amber-50 text-amber-800", low: "bg-slate-100 text-slate-700" };
const OUTCOMES: ExperimentOutcome[] = ["passed", "failed", "inconclusive", "not_run"];

/**
 * Stage 11: experiments for the riskiest assumptions, each with a pass/fail
 * bar set in advance. The founder records results; the server (not the AI)
 * evaluates them and derives the decision signal shown here.
 */
export function ValidationPlanPanel({
  ventureId,
  analysis,
  language,
  results,
  onSaveResult,
  onResearched,
  historical = false,
  onBackToLatest,
}: {
  ventureId: string;
  analysis: ValidationPlanAnalysis | null;
  language: "en" | "ko";
  /** Saved results and the server-computed outcomes (the stage's answers). */
  results: ValidationResults;
  onSaveResult: (experimentId: string, value: number | null, notes: string) => Promise<void>;
  onResearched: () => void;
  /** Showing an earlier saved plan instead of the latest one. */
  historical?: boolean;
  onBackToLatest?: () => void;
}) {
  const t = useTranslations("ValidationPlan");
  const tLogin = useTranslations("Login");
  const format = useFormatter();
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  const researchMutation = useMutation({
    mutationFn: () => researchStage(ventureId, "validation_plan", language),
    onSuccess: onResearched,
  });

  // Plan once, automatically, when there's nothing yet.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!analysis && !historical && !autoStarted.current) {
      autoStarted.current = true;
      researchMutation.mutate();
    }
  }, [analysis, historical, researchMutation]);

  const fresh = isValidationPlan(researchMutation.data ?? null) ? researchMutation.data : null;
  const shown = historical ? analysis : (fresh ?? analysis);

  return (
    <section aria-labelledby="validation-plan-title" className="flex flex-col gap-4 rounded-lg border bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="validation-plan-title" className="font-semibold">
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

      {shown && <PlanBody plan={shown} results={results} onSaveResult={onSaveResult} readOnly={historical} />}

      {shown && (
        <p className="text-muted-foreground flex flex-col gap-0.5 border-t pt-3 text-xs">
          {shown.based_on && <span>{t("basedOn", { date: when(shown.based_on) })}</span>}
          <span>{t("disclaimer", { date: when(shown.researched_at) })}</span>
        </p>
      )}
    </section>
  );
}

function PlanBody({
  plan,
  results,
  onSaveResult,
  readOnly,
}: {
  plan: ValidationPlanAnalysis;
  results: ValidationResults;
  onSaveResult: (experimentId: string, value: number | null, notes: string) => Promise<void>;
  readOnly: boolean;
}) {
  const t = useTranslations("ValidationPlan");
  const outcomes = results.experiment_outcomes ?? {};
  const outcomeOf = (id: string): ExperimentOutcome => outcomes[id] ?? "not_run";
  const counts = Object.fromEntries(
    OUTCOMES.map((outcome) => [outcome, plan.experiments.filter((e) => outcomeOf(e.id) === outcome).length]),
  ) as Record<ExperimentOutcome, number>;
  const signal: DecisionSignal = results.decision_signal ?? "not_started";
  const { icon: SignalIcon, classes } = SIGNAL_STYLE[signal];
  const phases = [...new Set(plan.experiments.map((e) => e.phase))].sort();

  return (
    <>
      <p className="text-sm leading-relaxed">{plan.summary}</p>

      {!readOnly && (
        <div role="status" className={`flex items-start gap-3 rounded-md border-2 p-3 ${classes}`} data-testid="decision-signal">
          <SignalIcon aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">{t(`signals.${signal}.title`)}</p>
            <p className="text-sm">{t(`signals.${signal}.description`)}</p>
            <p className="mt-1 text-xs tabular-nums" data-testid="outcome-counts">
              {t("counts", counts)}
            </p>
            <p className="mt-0.5 text-xs opacity-80">{t("signalNote")}</p>
          </div>
        </div>
      )}

      {plan.prerequisite_fixes.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="prerequisite-fixes">
          <p className="mb-1 flex items-center gap-1.5 font-semibold">
            <AlertTriangle aria-hidden className="size-4" />
            {t("fixFirstTitle")}
          </p>
          <ul className="list-disc space-y-0.5 pl-5">
            {plan.prerequisite_fixes.map((fix, index) => (
              <li key={index}>{fix}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="mb-2 text-sm font-semibold">{t("assumptionsTitle")}</h4>
        <ol className="flex flex-col gap-1.5" data-testid="assumptions">
          {plan.assumptions.map((item, index) => (
            <li key={index} className="flex flex-wrap items-baseline gap-2 rounded-md border bg-white px-3 py-2 text-sm">
              <span className="text-muted-foreground tabular-nums">{index + 1}.</span>
              <span className="flex-1">{item.assumption}</span>
              <span className={`rounded px-1.5 py-0.5 text-xs ${RISK_CLASSES[item.risk]}`}>{t(`risk.${item.risk}`)}</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                {t(`dimensions.${item.dimension}`)}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">{t("experimentsTitle")}</h4>
        <div className="flex flex-col gap-4">
          {phases.map((phase) => (
            <div key={phase} data-testid={`phase-${phase}`}>
              <h5 className="mb-2 text-xs font-semibold tracking-wide text-blue-800 uppercase">
                {t.has(`phases.${phase}`) ? t(`phases.${phase}`) : phase}
              </h5>
              <ul className="flex flex-col gap-3">
                {plan.experiments
                  .filter((e) => e.phase === phase)
                  .map((experiment) => (
                    <ExperimentCard
                      key={experiment.id}
                      experiment={experiment}
                      outcome={outcomeOf(experiment.id)}
                      saved={results.experiment_results?.[experiment.id]}
                      onSave={(value, notes) => onSaveResult(experiment.id, value, notes)}
                      readOnly={readOnly}
                    />
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-1 text-sm font-semibold">{t("decisionRulesTitle")}</h4>
          <dl className="flex flex-col gap-1.5 text-sm" data-testid="decision-rules">
            {(
              [
                ["proceedIf", plan.decision_rules.proceed_if],
                ["narrowIf", plan.decision_rules.narrow_or_pivot_if],
                ["stopIf", plan.decision_rules.stop_if],
              ] as const
            ).map(([label, text]) => (
              <div key={label}>
                <dt className="text-xs font-semibold">{t(label)}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </div>
        {plan.ethics_and_legal.length > 0 && (
          <div>
            <h4 className="mb-1 text-sm font-semibold">{t("ethicsTitle")}</h4>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {plan.ethics_and_legal.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

function ExperimentCard({
  experiment,
  outcome,
  saved,
  onSave,
  readOnly,
}: {
  experiment: ValidationExperiment;
  outcome: ExperimentOutcome;
  saved?: { value: number | null; notes: string };
  onSave: (value: number | null, notes: string) => Promise<void>;
  readOnly: boolean;
}) {
  const t = useTranslations("ValidationPlan");
  const format = useFormatter();
  const number = (value: number) => format.number(value, { maximumFractionDigits: 2 });
  // null = untouched: show what's saved.
  const [draft, setDraft] = useState<{ value: string; notes: string } | null>(null);
  const values = draft ?? { value: saved?.value == null ? "" : String(saved.value), notes: saved?.notes ?? "" };
  const saveMutation = useMutation({
    mutationFn: () => {
      const trimmed = values.value.trim();
      const parsed = trimmed === "" ? null : Number(trimmed);
      return onSave(parsed === null || Number.isFinite(parsed) ? parsed : null, values.notes);
    },
    onSuccess: () => setDraft(null),
  });
  const invalid = values.value.trim() !== "" && !Number.isFinite(Number(values.value));
  const { icon: OutcomeIcon, classes } = OUTCOME_STYLE[outcome];
  const inputId = `result-${experiment.id}`;

  return (
    <li className="rounded-md border bg-white p-3 text-sm" data-testid={`experiment-${experiment.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{experiment.title}</span>
        {experiment.critical && (
          <span className="rounded bg-purple-50 px-1.5 py-0.5 text-xs font-semibold text-purple-800">{t("critical")}</span>
        )}
        {!readOnly && (
          <span className={`ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${classes}`} data-testid="outcome">
            <OutcomeIcon aria-hidden className="size-3" />
            {t(`outcomes.${outcome}`)}
          </span>
        )}
      </div>
      <p className="text-muted-foreground mt-1 text-xs">
        <span className="font-semibold">{t("tests")}</span> {experiment.assumption_tested}
      </p>
      <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-semibold">{t("method")}</dt>
          <dd>{experiment.method}</dd>
        </div>
        <div>
          <dt className="font-semibold">{t("participants")}</dt>
          <dd>
            {experiment.sample_size === null
              ? experiment.participants
              : t("sample", { participants: experiment.participants, count: experiment.sample_size })}
          </dd>
        </div>
      </dl>
      <div className="mt-2 rounded bg-slate-50 px-2 py-1.5 text-xs" data-testid="thresholds">
        <p className="font-semibold text-green-900">
          {t("passIf", {
            metric: experiment.metric,
            comparator: t(`comparators.${experiment.comparator}`),
            value: number(experiment.pass_threshold),
            unit: experiment.unit,
          })}
        </p>
        <p className="text-red-900">
          {experiment.fail_threshold === null
            ? t("failOtherwise")
            : t("failIf", {
                comparator: t(`failComparators.${experiment.comparator}`),
                value: number(experiment.fail_threshold),
                unit: experiment.unit,
              })}
        </p>
      </div>
      <p className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 text-xs">
        <span>{t("duration", { weeks: experiment.duration_weeks })}</span>
        <span>{t("cost", { cost: experiment.cost_estimate })}</span>
        <span>{t("owner", { owner: experiment.owner })}</span>
      </p>

      {!readOnly && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid) saveMutation.mutate();
          }}
        >
          <label htmlFor={inputId} className="flex flex-col gap-1 text-xs font-medium">
            {t("resultLabel", { unit: experiment.unit })}
            <Input
              id={inputId}
              inputMode="decimal"
              className="h-8 w-28"
              value={values.value}
              aria-invalid={invalid}
              onChange={(e) => setDraft({ ...values, value: e.target.value })}
            />
          </label>
          <label htmlFor={`${inputId}-notes`} className="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium">
            {t("notesLabel")}
            <Input
              id={`${inputId}-notes`}
              className="h-8"
              maxLength={2000}
              value={values.notes}
              onChange={(e) => setDraft({ ...values, notes: e.target.value })}
            />
          </label>
          <Button type="submit" size="sm" disabled={saveMutation.isPending || invalid || draft === null}>
            {saveMutation.isPending ? t("savingResult") : t("saveResult")}
          </Button>
        </form>
      )}
    </li>
  );
}
