"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { FeasibilityDegree } from "@/components/feasibility-degree";
import { AlternativesResearchPanel } from "@/components/alternatives-research-panel";
import { IdeaResearchPanel } from "@/components/idea-research-panel";
import { ResearchSidebar } from "@/components/research-sidebar";
import {
  analyzeStage,
  getVenture,
  isAlternativesResearch,
  isIdeaResearch,
  stageResearchHistory,
  type ResearchStageSlug,
  listStages,
  updateStage,
  type StageField,
  type WizardStageStatus,
} from "@/lib/api";

const IDEA_DISCOVERY = "idea_discovery";
const ALTERNATIVES = "existing_alternatives";
const RESEARCH_STAGES: string[] = [IDEA_DISCOVERY, ALTERNATIVES];

const STATUS_BADGE_CLASSES: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  awaiting_user: "bg-amber-100 text-amber-800",
  needs_revision: "bg-red-100 text-red-800",
};

function fieldToFormValue(field: StageField, answers: Record<string, unknown> | null): string {
  const value = answers?.[field.name];
  if (field.type === "list") {
    return Array.isArray(value) ? value.join("\n") : "";
  }
  return typeof value === "string" ? value : "";
}

function isAnswered(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => String(item).trim() !== "");
  if (typeof value === "string") return value.trim() !== "";
  return value !== null && value !== undefined;
}

/**
 * Percentage of a stage's questions that have an answer (100 once the stage
 * is marked complete). Null for stages that aren't available yet.
 */
function stageCompletion(
  stage: WizardStageStatus,
  answers: Record<string, unknown> | null = stage.answers,
): number | null {
  if (!stage.implemented || stage.locked) return null;
  if (stage.status === "completed") return 100;
  const stageFields = stage.question_schema?.fields ?? [];
  if (stageFields.length === 0) return 0;
  const answered = stageFields.filter((field) => isAnswered(answers?.[field.name])).length;
  return Math.round((answered / stageFields.length) * 100);
}

// Where a user lands when opening the wizard: the first stage they can work
// on that isn't completed yet, or the first available stage if all are done.
function firstIncompleteStage(stages: WizardStageStatus[]): WizardStageStatus | null {
  const available = stages.filter((s) => s.implemented && !s.locked);
  return available.find((s) => s.status !== "completed") ?? available[0] ?? null;
}

function formValueToAnswer(field: StageField, raw: string): unknown {
  if (field.type === "list") {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return raw;
}

export default function VentureWizardPage() {
  const t = useTranslations("Wizard");
  const locale = useLocale();
  const params = useParams<{ ventureId: string }>();
  const ventureId = params.ventureId;
  const queryClient = useQueryClient();

  const ventureQuery = useQuery({
    queryKey: ["venture", ventureId],
    queryFn: () => getVenture(ventureId),
  });

  const stagesQuery = useQuery({
    queryKey: ["stages", ventureId],
    queryFn: () => listStages(ventureId),
  });

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  // Stage 1: an earlier research run being viewed (null = the latest).
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);
  const historyQuery = useQuery({
    queryKey: ["research-history", ventureId, selectedSlug],
    queryFn: () => stageResearchHistory(ventureId, selectedSlug as ResearchStageSlug),
    enabled: selectedSlug !== null && RESEARCH_STAGES.includes(selectedSlug),
  });
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const stages = stagesQuery.data ?? [];
  const selectedStage = stages.find((s) => s.slug === selectedSlug) ?? null;
  const fields = selectedStage?.question_schema?.fields ?? [];

  function selectStage(stage: WizardStageStatus) {
    if (!stage.implemented || stage.locked) return;
    setSelectedSlug(stage.slug);
    setViewingRunId(null);
    const stageFields = stage.question_schema?.fields ?? [];
    const initial: Record<string, string> = {};
    for (const field of stageFields) {
      initial[field.name] = fieldToFormValue(field, stage.answers);
    }
    setFormValues(initial);
  }

  // Stage 1 starts from the idea the venture was created with, until the
  // founder saves their own wording.
  const [ideaPrefilled, setIdeaPrefilled] = useState(false);
  const defaultIdea =
    ventureQuery.data?.current_idea_statement || ventureQuery.data?.original_idea || "";
  if (
    !ideaPrefilled &&
    selectedStage?.slug === IDEA_DISCOVERY &&
    !selectedStage.answers &&
    defaultIdea
  ) {
    setIdeaPrefilled(true);
    setFormValues((prev) => ({ ...prev, idea_statement: prev.idea_statement || defaultIdea }));
  }

  // On entering the wizard, open the first incomplete stage once the stages
  // have loaded. Done during render (React's "adjust state when data
  // arrives" pattern) so there's no flash of the empty state.
  if (selectedSlug === null && stages.length > 0) {
    const landing = firstIncompleteStage(stages);
    if (landing) selectStage(landing);
  }

  const latestAnalysis = selectedStage?.ai_analysis ?? null;
  const latestResearch =
    isIdeaResearch(latestAnalysis) || isAlternativesResearch(latestAnalysis) ? latestAnalysis : null;
  const viewingRun = historyQuery.data?.find((run) => run.id === viewingRunId) ?? null;
  const displayedResearch = viewingRun?.research ?? latestResearch;

  // The stage being edited reflects what's typed, before it's saved.
  const liveAnswers: Record<string, unknown> = {};
  for (const field of fields) {
    liveAnswers[field.name] = formValueToAnswer(field, formValues[field.name] ?? "");
  }
  const completionOf = (stage: WizardStageStatus) =>
    stageCompletion(stage, stage.slug === selectedSlug ? liveAnswers : stage.answers);

  const saveMutation = useMutation({
    mutationFn: (complete: boolean) => {
      if (!selectedStage) throw new Error("No stage selected");
      const answers: Record<string, unknown> = {};
      for (const field of fields) {
        answers[field.name] = formValueToAnswer(field, formValues[field.name] ?? "");
      }
      return updateStage(ventureId, selectedStage.slug, { answers, complete });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: () => {
      if (!selectedStage) throw new Error("No stage selected");
      return analyzeStage(ventureId, selectedStage.slug);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
    },
  });

  const statusLabels: Record<string, string> = {
    not_started: t("statusNotStarted"),
    in_progress: t("statusInProgress"),
    completed: t("statusCompleted"),
    awaiting_user: t("statusAwaitingUser"),
    needs_revision: t("statusNeedsRevision"),
  };

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold">{t("pageTitle")}</h1>
        {ventureQuery.data && (
          <>
            <span aria-hidden className="text-muted-foreground">
              |
            </span>
            <p className="text-lg font-bold" data-testid="venture-idea">
              {ventureQuery.data.title}
            </p>
          </>
        )}
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="shrink-0 lg:w-64">
          {stagesQuery.isError && (
            <p className="text-destructive text-sm" role="alert">
              {t("errorLoadFailed")}
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {stages.map((stage) => (
              <li key={stage.slug}>
                <button
                  type="button"
                  disabled={!stage.implemented || stage.locked}
                  title={stage.locked ? t("lockedHint") : undefined}
                  onClick={() => selectStage(stage)}
                  aria-current={stage.slug === selectedSlug ? "step" : undefined}
                  className="group flex w-full flex-col items-start gap-1 rounded-full border-2 border-transparent px-4 py-2 text-left text-sm transition-colors disabled:opacity-50 enabled:hover:bg-muted aria-[current=step]:border-blue-600 aria-[current=step]:bg-blue-50 aria-[current=step]:hover:bg-blue-50"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="text-muted-foreground w-5 shrink-0 text-right tabular-nums">
                      {stage.number}.
                    </span>
                    <span className="group-aria-[current=step]:font-bold group-aria-[current=step]:text-blue-700">
                      {locale === "ko" ? stage.title_ko : stage.title_en}
                    </span>
                  </span>
                  <span className="flex w-full items-center gap-2">
                    {stage.locked ? (
                      <span className="flex items-center gap-1 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-700">
                        <Lock aria-hidden className="size-3" />
                        {t("locked")}
                      </span>
                    ) : (
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE_CLASSES[stage.status] ?? ""}`}
                      >
                        {stage.implemented ? statusLabels[stage.status] : t("comingSoon")}
                      </span>
                    )}
                    {completionOf(stage) !== null && (
                      <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                        {completionOf(stage)}%
                      </span>
                    )}
                  </span>
                  {completionOf(stage) !== null && (
                    <ProgressBar
                      value={completionOf(stage)!}
                      label={t("completionLabel", {
                        title: locale === "ko" ? stage.title_ko : stage.title_en,
                      })}
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="min-w-0 flex-1">
          {!selectedStage ? (
            <p className="text-muted-foreground">{t("noStageSelected")}</p>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-bold text-blue-700">
                    {t("stageHeading", {
                      number: selectedStage.number,
                      title: locale === "ko" ? selectedStage.title_ko : selectedStage.title_en,
                    })}
                  </span>
                  <span className="text-muted-foreground text-sm font-normal tabular-nums">
                    {t("percentComplete", { percent: completionOf(selectedStage) ?? 0 })}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {selectedStage.status === "needs_revision" && (
                  <p className="rounded-md bg-red-50 p-2 text-sm text-red-800" role="alert">
                    {t("revisionBanner")}
                  </p>
                )}

                {selectedStage.slug === IDEA_DISCOVERY && (
                  <FeasibilityDegree research={isIdeaResearch(displayedResearch) ? displayedResearch : null} />
                )}

                {selectedStage.slug === IDEA_DISCOVERY && (
                  <IdeaResearchPanel
                    key={ventureId}
                    ventureId={ventureId}
                    analysis={isIdeaResearch(displayedResearch) ? displayedResearch : null}
                    language={locale === "ko" ? "ko" : "en"}
                    historical={viewingRun !== null}
                    onBackToLatest={() => setViewingRunId(null)}
                    onResearched={() => {
                      setViewingRunId(null);
                      queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
                      queryClient.invalidateQueries({ queryKey: ["research-history", ventureId] });
                    }}
                  />
                )}

                {selectedStage.slug === ALTERNATIVES && (
                  <AlternativesResearchPanel
                    key={`${ventureId}-alternatives`}
                    ventureId={ventureId}
                    analysis={isAlternativesResearch(displayedResearch) ? displayedResearch : null}
                    language={locale === "ko" ? "ko" : "en"}
                    historical={viewingRun !== null}
                    onBackToLatest={() => setViewingRunId(null)}
                    onResearched={() => {
                      setViewingRunId(null);
                      queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
                      queryClient.invalidateQueries({ queryKey: ["research-history", ventureId] });
                    }}
                  />
                )}

                <div className="flex flex-col gap-3">
                  {fields.map((field) => (
                    <div key={field.name} className="flex flex-col gap-1">
                      <label htmlFor={field.name} className="text-sm font-medium">
                        {locale === "ko" ? field.label_ko : field.label_en}
                      </label>
                      <Textarea
                        id={field.name}
                        rows={field.type === "list" ? 4 : 3}
                        value={formValues[field.name] ?? ""}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                        }
                        onBlur={() => saveMutation.mutate(false)}
                      />
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    onClick={() => saveMutation.mutate(true)}
                    disabled={saveMutation.isPending}
                  >
                    {t("markComplete")}
                  </Button>
                  {!RESEARCH_STAGES.includes(selectedStage.slug) && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => analyzeMutation.mutate()}
                      disabled={analyzeMutation.isPending}
                    >
                      {analyzeMutation.isPending ? t("analyzing") : t("getFeedback")}
                    </Button>
                  )}
                  {saveMutation.isPending && (
                    <span className="text-muted-foreground text-sm">{t("saving")}</span>
                  )}
                  {!saveMutation.isPending && saveMutation.isSuccess && (
                    <span className="text-muted-foreground text-sm">{t("saved")}</span>
                  )}
                </div>

                {saveMutation.isError && (
                  <p className="text-destructive text-sm" role="alert">
                    {t("errorSaveFailed")}
                  </p>
                )}
                {analyzeMutation.isError && (
                  <p className="text-destructive text-sm" role="alert">
                    {t("errorAnalyzeFailed")}
                  </p>
                )}

                {selectedStage.ai_analysis &&
                  !isIdeaResearch(selectedStage.ai_analysis) &&
                  !isAlternativesResearch(selectedStage.ai_analysis) && (
                  <div className="flex flex-col gap-2 border-t pt-4">
                    <h3 className="font-semibold">{t("feedbackTitle")}</h3>
                    <p className="text-sm">{selectedStage.ai_analysis.summary}</p>

                    <h4 className="text-sm font-medium">{t("feedbackStrengths")}</h4>
                    <ul className="list-disc pl-5 text-sm">
                      {selectedStage.ai_analysis.strengths.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>

                    <h4 className="text-sm font-medium">{t("feedbackGaps")}</h4>
                    <ul className="list-disc pl-5 text-sm">
                      {selectedStage.ai_analysis.gaps.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>

                    <h4 className="text-sm font-medium">{t("feedbackNextSteps")}</h4>
                    <ul className="list-disc pl-5 text-sm">
                      {selectedStage.ai_analysis.suggested_next_steps.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </section>

        {selectedStage && RESEARCH_STAGES.includes(selectedStage.slug) && (
          <aside className="shrink-0 lg:w-72" aria-label={t("researchColumn")}>
            <ResearchSidebar
              research={displayedResearch}
              runs={historyQuery.data ?? []}
              viewingRunId={viewingRunId}
              onSelectRun={setViewingRunId}
            />
          </aside>
        )}
      </div>
    </main>
  );
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      className="bg-muted block h-1.5 w-full overflow-hidden rounded-full"
    >
      <span
        className={`block h-full rounded-full ${value === 100 ? "bg-green-600" : "bg-blue-600"}`}
        style={{ width: `${value}%` }}
      />
    </span>
  );
}
