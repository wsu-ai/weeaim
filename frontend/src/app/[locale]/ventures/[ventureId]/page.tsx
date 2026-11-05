"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  BotMessageSquare,
  Briefcase,
  ChartLine,
  ChartPie,
  ChevronsRight,
  CircleAlert,
  ClipboardCheck,
  Crosshair,
  FlaskConical,
  Gem,
  Languages,
  Lightbulb,
  LoaderCircle,
  Lock,
  Megaphone,
  Package,
  Route,
  Shuffle,
  UserRoundSearch,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { resolveDefaultLocation, type LocationSource } from "@/lib/location";
import { useSession, useSetSession } from "@/lib/session";
import { useTokenLimitMessage } from "@/lib/token-limit";
import { Textarea } from "@/components/ui/textarea";
import { FeasibilityDegree } from "@/components/feasibility-degree";
import { FinancialAnalysisPanel } from "@/components/financial-analysis-panel";
import { AgentRunPanel } from "@/components/agent-run-panel";
import { AlternativesResearchPanel } from "@/components/alternatives-research-panel";
import { BusinessModelPanel } from "@/components/business-model-panel";
import { CompetitivePositionPanel } from "@/components/competitive-position-panel";
import { DfvAssessmentPanel } from "@/components/dfv-assessment-panel";
import { IdeaResearchPanel } from "@/components/idea-research-panel";
import { LearningTools } from "@/components/learning-tools";
import { MarketEvidencePanel } from "@/components/market-evidence-panel";
import { MarketingPlanPanel } from "@/components/marketing-plan-panel";
import { MvpPanel } from "@/components/mvp-panel";
import { PersonaValidationPanel } from "@/components/persona-validation-panel";
import { ResearchSidebar } from "@/components/research-sidebar";
import { ValidationPlanPanel } from "@/components/validation-plan-panel";
import {
  AGENT_STAGES,
  type WebsiteMockup,
  ApiError,
  getLatestAgentRun,
  analysisLanguage,
  cachedTranslation,
  translateStageAnalysis,
  analyzeStage,
  getVenture,
  isAlternativesResearch,
  isBusinessModel,
  isCompetitivePosition,
  isDfvAssessment,
  isFinancialAnalysis,
  isIdeaResearch,
  isMarketResearch,
  isMarketingPlan,
  isMvp,
  isPersonaInsights,
  isValidationPlan,
  updatePreferences,
  stageResearchHistory,
  type FinancialAnswers,
  type FinancialInputs,
  type OfferingType,
  type ResearchStageSlug,
  listStages,
  updateStage,
  type StageField,
  type TargetPersona,
  type ValidationResults,
  type WizardStageStatus,
} from "@/lib/api";

const IDEA_DISCOVERY = "idea_discovery";
const ALTERNATIVES = "existing_alternatives";
const MARKET = "market_evidence";
const PERSONAS = "persona_validation";
const COMPETITIVE = "competitive_position";
const DFV = "dfv_assessment";
const MVP = "mvp";
const BUSINESS_MODEL = "business_model";
const VALIDATION = "validation_plan";
const FINANCIALS = "financial_analysis";
const MARKETING = "marketing_plan";
const RESEARCH_STAGES: string[] = [
  IDEA_DISCOVERY,
  ALTERNATIVES,
  MARKET,
  PERSONAS,
  COMPETITIVE,
  DFV,
  MVP,
  BUSINESS_MODEL,
  VALIDATION,
  FINANCIALS,
  MARKETING,
];
// Stages that end in an action checklist saved as `completed_actions`.
const CHECKLIST_STAGES: string[] = [COMPETITIVE, DFV, BUSINESS_MODEL, MARKETING];

function completedActionsOf(answers: Record<string, unknown> | null): string[] {
  const value = answers?.completed_actions;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

const STATUS_BADGE_CLASSES: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  awaiting_user: "bg-amber-100 text-amber-800",
  needs_revision: "bg-red-100 text-red-800",
};

// Stage name colour in the sidebar: dark grey until started, orange while in
// progress (any started-but-not-completed status), default once completed.
// The current stage's bold blue highlight takes precedence.
function stageTitleColor(status: string): string {
  if (status === "not_started") return "text-gray-700";
  if (status === "completed") return "";
  return "text-orange-600";
}

// A colour icon for each stage, shown between its number and title in the
// sidebar: the icon in a strong hue on a soft tint of the same hue. Full class
// names (not built from parts) so Tailwind includes them.
const STAGE_ICONS: Record<string, { icon: LucideIcon; colors: string }> = {
  idea_discovery: { icon: Lightbulb, colors: "bg-amber-100 text-amber-600" },
  problem_definition: { icon: CircleAlert, colors: "bg-red-100 text-red-600" },
  customer_definition: { icon: Users, colors: "bg-sky-100 text-sky-600" },
  existing_alternatives: { icon: Shuffle, colors: "bg-violet-100 text-violet-600" },
  value_proposition: { icon: Gem, colors: "bg-fuchsia-100 text-fuchsia-600" },
  market_evidence: { icon: ChartPie, colors: "bg-emerald-100 text-emerald-600" },
  persona_validation: { icon: UserRoundSearch, colors: "bg-orange-100 text-orange-600" },
  competitive_position: { icon: Crosshair, colors: "bg-rose-100 text-rose-600" },
  dfv_assessment: { icon: ClipboardCheck, colors: "bg-teal-100 text-teal-600" },
  mvp: { icon: Package, colors: "bg-indigo-100 text-indigo-600" },
  business_model: { icon: Briefcase, colors: "bg-yellow-100 text-yellow-700" },
  validation_plan: { icon: FlaskConical, colors: "bg-lime-100 text-lime-700" },
  financial_analysis: { icon: ChartLine, colors: "bg-green-100 text-green-700" },
  marketing_plan: { icon: Megaphone, colors: "bg-pink-100 text-pink-600" },
  decision_roadmap: { icon: Route, colors: "bg-blue-100 text-blue-600" },
};

/** Decorative: the stage title next to it already names the stage. Larger
 * for the current stage. */
function StageIcon({ slug }: { slug: string }) {
  const { icon: Icon, colors } = STAGE_ICONS[slug] ?? { icon: Lightbulb, colors: "bg-slate-100 text-slate-600" };
  return (
    <span
      aria-hidden
      data-testid={`stage-icon-${slug}`}
      className={`flex size-6 shrink-0 items-center justify-center rounded-full transition-all group-disabled:grayscale group-aria-[current=step]:size-9 group-aria-[current=step]:shadow-sm ${colors}`}
    >
      <Icon className="size-3.5 group-aria-[current=step]:size-5" />
    </span>
  );
}

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

// Share of a stage's % that comes from its AI content; the rest is split
// across the stage's questions.
const AI_CONTENT_WEIGHT = 50;

/**
 * A stage's completion: 50% once its AI content (research, plan or mentor
 * feedback) has been generated, plus 50% split across the questions answered.
 * 100 once the stage is marked complete. Null for stages that aren't
 * available yet.
 */
function stageCompletion(
  stage: WizardStageStatus,
  answers: Record<string, unknown> | null = stage.answers,
): number | null {
  if (!stage.implemented || stage.locked) return null;
  if (stage.status === "completed") return 100;
  const aiShare = stage.ai_analysis ? AI_CONTENT_WEIGHT : 0;
  const stageFields = stage.question_schema?.fields ?? [];
  if (stageFields.length === 0) return aiShare === 0 ? 0 : 100;
  const answered = stageFields.filter((field) => isAnswered(answers?.[field.name])).length;
  return Math.round(aiShare + ((100 - AI_CONTENT_WEIGHT) * answered) / stageFields.length);
}

/** e.g. "1, 2, 5": the numbers of the stages a locked stage waits for. */
function lockedByNumbers(stage: WizardStageStatus, stages: WizardStageStatus[]): string {
  return (stage.locked_by ?? [])
    .map((slug) => stages.find((s) => s.slug === slug)?.number)
    .filter((n): n is number => n !== undefined)
    .join(", ");
}

/** e.g. "2. Problem definition, 5. Value proposition": the stages to finish first. */
function unlockTodo(
  stage: WizardStageStatus,
  stages: WizardStageStatus[],
  titleOf: (stage: WizardStageStatus) => string,
): string {
  return (stage.locked_by ?? [])
    .map((slug) => stages.find((s) => s.slug === slug))
    .filter((s): s is WizardStageStatus => s !== undefined)
    .map((s) => `${s.number}. ${titleOf(s)}`)
    .join(", ");
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
  const tokenLimitMessage = useTokenLimitMessage();
  const format = useFormatter();
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
  // Show AI content in the language it was written in, not translated.
  const [showOriginal, setShowOriginal] = useState(false);
  // Stage 1: an earlier research run being viewed (null = the latest).
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);
  const historyQuery = useQuery({
    queryKey: ["research-history", ventureId, selectedSlug],
    queryFn: () => stageResearchHistory(ventureId, selectedSlug as ResearchStageSlug),
    enabled: selectedSlug !== null && RESEARCH_STAGES.includes(selectedSlug),
  });
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  // Stages 7-9: the action items the founder has ticked off.
  const [completedActions, setCompletedActions] = useState<string[]>([]);

  const stages = stagesQuery.data ?? [];
  const selectedStage = stages.find((s) => s.slug === selectedSlug) ?? null;
  // "Next" goes to the following stage, when it can be opened.
  const following = selectedStage
    ? [...stages].sort((a, b) => a.number - b.number).find((s) => s.number > selectedStage.number)
    : undefined;
  const nextStage = following && following.implemented && !following.locked ? following : null;
  const fields = selectedStage?.question_schema?.fields ?? [];

  function selectStage(stage: WizardStageStatus) {
    if (!stage.implemented || stage.locked) return;
    setSelectedSlug(stage.slug);
    setViewingRunId(null);
    setShowOriginal(false);
    const stageFields = stage.question_schema?.fields ?? [];
    const initial: Record<string, string> = {};
    for (const field of stageFields) {
      initial[field.name] = fieldToFormValue(field, stage.answers);
    }
    setFormValues(initial);
    setCompletedActions(completedActionsOf(stage.answers));
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

  // Stage 6 needs the founder's country and city. Pre-fill them from the
  // account default, then the browser (see lib/location.ts); the founder
  // confirms by saving.
  const session = useSession().data;
  const setSession = useSetSession();
  const [locationPrefilled, setLocationPrefilled] = useState(false);
  const [locationSources, setLocationSources] = useState<{
    country: LocationSource;
    city: LocationSource;
  } | null>(null);
  const [rememberLocation, setRememberLocation] = useState(false);
  const savedMarketAnswers = selectedStage?.slug === MARKET ? (selectedStage.answers ?? {}) : {};
  const locationReady =
    !!String(savedMarketAnswers.user_country ?? "").trim() &&
    !!String(savedMarketAnswers.user_metro_city ?? "").trim();
  if (
    !locationPrefilled &&
    selectedStage?.slug === MARKET &&
    !locationReady &&
    session !== undefined // wait for the account defaults to load
  ) {
    setLocationPrefilled(true);
    const resolved = resolveDefaultLocation({
      saved: {
        country: String(savedMarketAnswers.user_country ?? ""),
        city: String(savedMarketAnswers.user_metro_city ?? ""),
      },
      account: { country: session?.default_country, city: session?.default_metro_city },
    });
    setLocationSources({ country: resolved.countrySource, city: resolved.citySource });
    // Offer to remember it when the account has no default yet.
    setRememberLocation(!session?.default_country || !session?.default_metro_city);
    setFormValues((prev) => ({
      ...prev,
      user_country: prev.user_country || resolved.country,
      user_metro_city: prev.user_metro_city || resolved.city,
    }));
  }

  const rememberLocationMutation = useMutation({
    mutationFn: () =>
      updatePreferences({
        default_country: String(formValues.user_country ?? "").trim(),
        default_metro_city: String(formValues.user_metro_city ?? "").trim(),
      }),
    onSuccess: setSession,
  });

  function saveLocation() {
    saveMutation.mutate(false);
    if (rememberLocation) rememberLocationMutation.mutate();
  }

  // On entering the wizard, open the first incomplete stage once the stages
  // have loaded. Done during render (React's "adjust state when data
  // arrives" pattern) so there's no flash of the empty state.
  // A link can ask for a stage (?stage=<slug>, e.g. from "My AI Agents");
  // it's used when that stage can be opened.
  const requestedSlug = useSearchParams().get("stage");
  if (selectedSlug === null && stages.length > 0) {
    const requested = stages.find((s) => s.slug === requestedSlug && s.implemented && !s.locked);
    const landing = requested ?? firstIncompleteStage(stages);
    if (landing) selectStage(landing);
  }

  // AI content follows the language setting: a stage's analysis written in
  // another language is shown translated (cached by the server), unless the
  // founder asks for the original.
  const savedAnalysis = selectedStage?.ai_analysis ?? null;
  const appLanguage: "en" | "ko" = locale === "ko" ? "ko" : "en";
  const needsTranslation = !!savedAnalysis && analysisLanguage(savedAnalysis) !== appLanguage;
  const cached = savedAnalysis && needsTranslation ? cachedTranslation(savedAnalysis, appLanguage) : null;
  const translationQuery = useQuery({
    queryKey: [
      "translation",
      ventureId,
      selectedSlug,
      appLanguage,
      (savedAnalysis as { researched_at?: string } | null)?.researched_at ?? "",
    ],
    queryFn: () => translateStageAnalysis(ventureId, selectedSlug as string, appLanguage),
    enabled: needsTranslation && !cached && !showOriginal && selectedSlug !== null,
    staleTime: Infinity,
    retry: false,
  });
  const translatedAnalysis = cached ?? translationQuery.data ?? null;
  const latestAnalysis =
    needsTranslation && !showOriginal ? (translatedAnalysis ?? savedAnalysis) : savedAnalysis;
  const latestResearch =
    isIdeaResearch(latestAnalysis) ||
    isAlternativesResearch(latestAnalysis) ||
    isMarketResearch(latestAnalysis) ||
    isCompetitivePosition(latestAnalysis) ||
    isDfvAssessment(latestAnalysis) ||
    isBusinessModel(latestAnalysis) ||
    isMvp(latestAnalysis) ||
    isValidationPlan(latestAnalysis) ||
    isFinancialAnalysis(latestAnalysis) ||
    isMarketingPlan(latestAnalysis) ||
    isPersonaInsights(latestAnalysis)
      ? latestAnalysis
      : null;
  const viewingRun = historyQuery.data?.find((run) => run.id === viewingRunId) ?? null;
  const displayedResearch = viewingRun?.research ?? latestResearch;

  // When the AI mentor's feedback was last received (generic feedback only).
  const feedbackAt =
    latestAnalysis && !("kind" in latestAnalysis) && "analyzed_at" in latestAnalysis
      ? latestAnalysis.analyzed_at
      : undefined;

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
      // Keep saved answers that aren't form fields (e.g. Stage 9's offering type).
      const answers: Record<string, unknown> = { ...(selectedStage.answers ?? {}) };
      for (const field of fields) {
        answers[field.name] = formValueToAnswer(field, formValues[field.name] ?? "");
      }
      if (CHECKLIST_STAGES.includes(selectedStage.slug)) answers.completed_actions = completedActions;
      return updateStage(ventureId, selectedStage.slug, { answers, complete });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
    },
  });

  // A tick saves the stage's saved answers plus the new ticks, so the server
  // sees progress only and leaves the stage's status alone.
  const actionsMutation = useMutation({
    mutationFn: (ids: string[]) => {
      if (!selectedStage) throw new Error("No stage selected");
      const answers = { ...(selectedStage.answers ?? {}), completed_actions: ids };
      return updateStage(ventureId, selectedStage.slug, { answers, complete: false });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
    },
  });

  // Stage 9: the founder's choice of offering type, saved with the stage's
  // saved answers before the MVP is re-designed.
  async function setOfferingType(type: OfferingType) {
    if (!selectedStage) return;
    await updateStage(ventureId, selectedStage.slug, {
      answers: { ...(selectedStage.answers ?? {}), offering_type: type },
      complete: false,
    });
    await queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
  }

  // Stage 11: one experiment's recorded result, saved with the stage's saved
  // answers. The server works out the outcome; the refetch shows it.
  async function saveExperimentResult(experimentId: string, value: number | null, notes: string) {
    if (!selectedStage) return;
    const saved = (selectedStage.answers ?? {}) as ValidationResults & Record<string, unknown>;
    await updateStage(ventureId, selectedStage.slug, {
      answers: {
        ...saved,
        experiment_results: { ...(saved.experiment_results ?? {}), [experimentId]: { value, notes } },
      },
      complete: false,
    });
    await queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
  }

  // Stage 12: the founder's edited inputs, saved with the stage's saved
  // answers. The server recalculates the projection; the refetch shows it.
  async function saveFinancialInputs(inputs: FinancialInputs) {
    if (!selectedStage) return;
    await updateStage(ventureId, selectedStage.slug, {
      answers: { ...(selectedStage.answers ?? {}), financial_inputs: inputs },
      complete: false,
    });
    await queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
  }

  // Stage 7: the founder's personas, saved with the stage's saved answers.
  // The server assigns IDs; the refetch brings them back.
  async function savePersonas(personas: TargetPersona[]) {
    if (!selectedStage) return;
    await updateStage(ventureId, selectedStage.slug, {
      answers: { ...(selectedStage.answers ?? {}), personas },
      complete: false,
    });
    await queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
  }

  function toggleAction(actionId: string, done: boolean) {
    const ids = done
      ? [...completedActions.filter((id) => id !== actionId), actionId]
      : completedActions.filter((id) => id !== actionId);
    setCompletedActions(ids);
    actionsMutation.mutate(ids);
  }

  // Feedback weighs the AI Mentor Agent's drafts against the answers on the
  // page, so it needs both. The agent panel shares this query.
  const agentRunQuery = useQuery({
    queryKey: ["agent-run", ventureId, selectedSlug],
    queryFn: () => getLatestAgentRun(ventureId, selectedSlug as string),
    enabled: selectedSlug !== null && AGENT_STAGES.includes(selectedSlug),
  });
  type FeedbackPrompt = "agent_not_run" | "no_answers";
  const [promptsFor, setPromptsFor] = useState<{ slug: string | null; prompts: FeedbackPrompt[] }>({
    slug: null,
    prompts: [],
  });
  const feedbackPrompts = promptsFor.slug === selectedSlug ? promptsFor.prompts : [];
  const setFeedbackPrompts = (prompts: FeedbackPrompt[]) => setPromptsFor({ slug: selectedSlug, prompts });
  const analyzeMutation = useMutation({
    mutationFn: () => {
      if (!selectedStage) throw new Error("No stage selected");
      return analyzeStage(ventureId, selectedStage.slug, liveAnswers);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
    },
    onError: (error) => {
      const detail = error instanceof ApiError ? error.detail : null;
      if (detail === "agent_not_run" || detail === "no_answers") setFeedbackPrompts([detail]);
    },
  });
  function askForFeedback() {
    // Say up front what's missing; the server checks again.
    const prompts: FeedbackPrompt[] = [];
    if (agentRunQuery.isSuccess && agentRunQuery.data === null) prompts.push("agent_not_run");
    if (!Object.values(liveAnswers).some(isAnswered)) prompts.push("no_answers");
    setFeedbackPrompts(prompts);
    if (prompts.length === 0) analyzeMutation.mutate();
  }

  const statusLabels: Record<string, string> = {
    not_started: t("statusNotStarted"),
    in_progress: t("statusInProgress"),
    completed: t("statusCompleted"),
    awaiting_user: t("statusAwaitingUser"),
    needs_revision: t("statusNeedsRevision"),
  };

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6">
      {/* The title and stage chain stay pinned at the top; everything below
          them scrolls underneath. */}
      <div
        className="sticky top-0 z-30 -mx-6 -mt-6 flex flex-col gap-2 border-b bg-white/95 px-6 pt-4 pb-2 backdrop-blur supports-[backdrop-filter]:bg-white/85"
        data-testid="wizard-top"
      >
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold">{t("pageTitle")}</h1>
          {ventureQuery.data && (
            <>
              <span aria-hidden className="text-muted-foreground">
                |
              </span>
              <p className="text-lg">
                <span className="font-semibold text-blue-700">{t("myVentureIdea")}</span>{" "}
                <span className="font-bold" data-testid="venture-idea">
                  {ventureQuery.data.title}
                </span>
              </p>
            </>
          )}
        </header>

        {stages.length > 0 && (
          <StageChain
            stages={stages}
            currentSlug={selectedSlug}
            titleOf={(stage) => (locale === "ko" ? stage.title_ko : stage.title_en)}
            label={t("stageChainLabel")}
            lockedHint={(stage) =>
              t("chainUnlockTodo", {
                stage: `${stage.number}. ${locale === "ko" ? stage.title_ko : stage.title_en}`,
                todo: unlockTodo(stage, stages, (s) => (locale === "ko" ? s.title_ko : s.title_en)),
              })
            }
            onSelect={selectStage}
          />
        )}
      </div>

      <div className="flex flex-col gap-6 lg:flex-row" data-testid="wizard-content">
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
                  title={
                    stage.locked
                      ? t("lockedHintStages", { stages: lockedByNumbers(stage, stages) })
                      : undefined
                  }
                  onClick={() => selectStage(stage)}
                  aria-current={stage.slug === selectedSlug ? "step" : undefined}
                  className="group flex w-full flex-col items-start gap-1 rounded-xl border-2 border-transparent px-4 py-2 text-left text-sm transition-colors disabled:opacity-50 enabled:hover:bg-muted aria-[current=step]:border-blue-600 aria-[current=step]:bg-blue-50 aria-[current=step]:hover:bg-blue-50"
                >
                  <span className="flex items-center gap-2 leading-5">
                    <span className="text-muted-foreground w-5 shrink-0 text-right tabular-nums group-aria-[current=step]:w-6 group-aria-[current=step]:text-lg group-aria-[current=step]:font-bold group-aria-[current=step]:text-blue-700">
                      {stage.number}.
                    </span>
                    <StageIcon slug={stage.slug} />
                    <span
                      data-testid={`stage-title-${stage.slug}`}
                      className={`${stageTitleColor(stage.status)} group-aria-[current=step]:text-base group-aria-[current=step]:leading-6 group-aria-[current=step]:font-bold group-aria-[current=step]:text-blue-700`}
                    >
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
                <CardTitle className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xl font-bold text-blue-700 sm:text-2xl">
                    {t("stageHeading", {
                      number: selectedStage.number,
                      title: locale === "ko" ? selectedStage.title_ko : selectedStage.title_en,
                    })}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-muted-foreground text-base font-medium tabular-nums sm:text-lg">
                      {t("percentComplete", { percent: completionOf(selectedStage) ?? 0 })}
                    </span>
                    {nextStage && (
                      <Button
                        size="lg"
                        onClick={() => {
                          selectStage(nextStage);
                          window.scrollTo?.({ top: 0, behavior: "smooth" });
                        }}
                        aria-label={t("nextStageLabel", {
                          number: nextStage.number,
                          title: locale === "ko" ? nextStage.title_ko : nextStage.title_en,
                        })}
                        title={t("nextStageLabel", {
                          number: nextStage.number,
                          title: locale === "ko" ? nextStage.title_ko : nextStage.title_en,
                        })}
                        data-testid="next-stage"
                        className="h-10 px-4 text-base [&_svg]:size-5"
                      >
                        {t("nextStage")}
                        <ChevronsRight aria-hidden />
                      </Button>
                    )}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {needsTranslation && viewingRun === null && (
                  <TranslationNotice
                    from={analysisLanguage(savedAnalysis!)}
                    to={appLanguage}
                    showingOriginal={showOriginal}
                    translating={!cached && translationQuery.isFetching}
                    failed={!cached && translationQuery.isError}
                    onToggle={() => setShowOriginal((value) => !value)}
                    onRetry={() => translationQuery.refetch()}
                  />
                )}

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

                {AGENT_STAGES.includes(selectedStage.slug) && viewingRun === null && (
                  <AgentRunPanel
                    key={`${ventureId}-${selectedStage.slug}-agent`}
                    ventureId={ventureId}
                    stageSlug={selectedStage.slug}
                    explainStops={selectedStage.slug === PERSONAS}
                    language={locale === "ko" ? "ko" : "en"}
                    stageNumbers={Object.fromEntries(stages.map((s) => [s.slug, s.number]))}
                    fieldLabels={Object.fromEntries(
                      fields.map((field) => [field.name, locale === "ko" ? field.label_ko : field.label_en]),
                    )}
                    onFinished={() => {
                      queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
                      queryClient.invalidateQueries({ queryKey: ["research-history", ventureId] });
                    }}
                    onUseAnswers={(drafts) =>
                      setFormValues((prev) => {
                        const next = { ...prev };
                        for (const field of fields) {
                          if (field.name in drafts) next[field.name] = fieldToFormValue(field, drafts);
                        }
                        return next;
                      })
                    }
                  />
                )}

                {selectedStage.slug === ALTERNATIVES && (
                  <AlternativesResearchPanel
                    // A finished agent run remounts the panel, so it shows the agent's research.
                    key={`${ventureId}-alternatives-${
                      isAlternativesResearch(savedAnalysis) ? (savedAnalysis.agent_run_id ?? "") : ""
                    }`}
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

                {selectedStage.slug === MARKET && (
                  <MarketEvidencePanel
                    key={`${ventureId}-market`}
                    ventureId={ventureId}
                    analysis={isMarketResearch(displayedResearch) ? displayedResearch : null}
                    locationReady={locationReady}
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

                {selectedStage.slug === PERSONAS && (
                  <PersonaValidationPanel
                    key={`${ventureId}-personas`}
                    ventureId={ventureId}
                    analysis={isPersonaInsights(displayedResearch) ? displayedResearch : null}
                    language={locale === "ko" ? "ko" : "en"}
                    personas={((selectedStage.answers ?? {}).personas as TargetPersona[] | undefined) ?? []}
                    onSavePersonas={savePersonas}
                    historical={viewingRun !== null}
                    onBackToLatest={() => setViewingRunId(null)}
                    onResearched={() => {
                      setViewingRunId(null);
                      queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
                      queryClient.invalidateQueries({ queryKey: ["research-history", ventureId] });
                    }}
                  />
                )}

                {selectedStage.slug === COMPETITIVE && (
                  <CompetitivePositionPanel
                    key={`${ventureId}-competitive`}
                    ventureId={ventureId}
                    analysis={isCompetitivePosition(displayedResearch) ? displayedResearch : null}
                    language={locale === "ko" ? "ko" : "en"}
                    completedActions={completedActions}
                    onToggleAction={toggleAction}
                    historical={viewingRun !== null}
                    onBackToLatest={() => setViewingRunId(null)}
                    onResearched={() => {
                      setViewingRunId(null);
                      queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
                      queryClient.invalidateQueries({ queryKey: ["research-history", ventureId] });
                    }}
                  />
                )}
                {selectedStage.slug === DFV && (
                  <DfvAssessmentPanel
                    key={`${ventureId}-dfv`}
                    ventureId={ventureId}
                    analysis={isDfvAssessment(displayedResearch) ? displayedResearch : null}
                    language={locale === "ko" ? "ko" : "en"}
                    completedActions={completedActions}
                    onToggleAction={toggleAction}
                    historical={viewingRun !== null}
                    onBackToLatest={() => setViewingRunId(null)}
                    onResearched={() => {
                      setViewingRunId(null);
                      queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
                      queryClient.invalidateQueries({ queryKey: ["research-history", ventureId] });
                    }}
                  />
                )}
                {selectedStage.slug === MVP && (
                  <MvpPanel
                    key={`${ventureId}-mvp`}
                    ventureId={ventureId}
                    analysis={isMvp(displayedResearch) ? displayedResearch : null}
                    design={(selectedStage.answers?.mockup_design as WebsiteMockup | undefined) ?? null}
                    language={locale === "ko" ? "ko" : "en"}
                    onSetOfferingType={setOfferingType}
                    historical={viewingRun !== null}
                    onBackToLatest={() => setViewingRunId(null)}
                    onResearched={() => {
                      setViewingRunId(null);
                      queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
                      queryClient.invalidateQueries({ queryKey: ["research-history", ventureId] });
                    }}
                  />
                )}

                {selectedStage.slug === BUSINESS_MODEL && (
                  <BusinessModelPanel
                    key={`${ventureId}-business-model`}
                    ventureId={ventureId}
                    analysis={isBusinessModel(displayedResearch) ? displayedResearch : null}
                    language={locale === "ko" ? "ko" : "en"}
                    completedActions={completedActions}
                    onToggleAction={toggleAction}
                    historical={viewingRun !== null}
                    onBackToLatest={() => setViewingRunId(null)}
                    onResearched={() => {
                      setViewingRunId(null);
                      queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
                      queryClient.invalidateQueries({ queryKey: ["research-history", ventureId] });
                    }}
                  />
                )}
                {selectedStage.slug === VALIDATION && (
                  <ValidationPlanPanel
                    key={`${ventureId}-validation`}
                    ventureId={ventureId}
                    analysis={isValidationPlan(displayedResearch) ? displayedResearch : null}
                    language={locale === "ko" ? "ko" : "en"}
                    results={(selectedStage.answers ?? {}) as ValidationResults}
                    onSaveResult={saveExperimentResult}
                    historical={viewingRun !== null}
                    onBackToLatest={() => setViewingRunId(null)}
                    onResearched={() => {
                      setViewingRunId(null);
                      queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
                      queryClient.invalidateQueries({ queryKey: ["research-history", ventureId] });
                    }}
                  />
                )}
                {selectedStage.slug === FINANCIALS && (
                  <FinancialAnalysisPanel
                    key={`${ventureId}-financials`}
                    ventureId={ventureId}
                    analysis={isFinancialAnalysis(displayedResearch) ? displayedResearch : null}
                    language={locale === "ko" ? "ko" : "en"}
                    answers={(selectedStage.answers ?? {}) as FinancialAnswers}
                    onSaveInputs={saveFinancialInputs}
                    historical={viewingRun !== null}
                    onBackToLatest={() => setViewingRunId(null)}
                    onResearched={() => {
                      setViewingRunId(null);
                      queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
                      queryClient.invalidateQueries({ queryKey: ["research-history", ventureId] });
                    }}
                  />
                )}
                {selectedStage.slug === MARKETING && (
                  <MarketingPlanPanel
                    key={`${ventureId}-marketing`}
                    ventureId={ventureId}
                    analysis={isMarketingPlan(displayedResearch) ? displayedResearch : null}
                    language={locale === "ko" ? "ko" : "en"}
                    completedActions={completedActions}
                    onToggleAction={toggleAction}
                    historical={viewingRun !== null}
                    onBackToLatest={() => setViewingRunId(null)}
                    onResearched={() => {
                      setViewingRunId(null);
                      queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
                      queryClient.invalidateQueries({ queryKey: ["research-history", ventureId] });
                    }}
                  />
                )}
                {actionsMutation.isError && (
                  <p className="text-destructive text-sm" role="alert">
                    {t("errorSaveFailed")}
                  </p>
                )}

                <div className="flex flex-col gap-3">
                  {fields.map((field) => (
                    <div key={field.name} className="flex flex-col gap-1">
                      <label htmlFor={field.name} className="text-sm font-medium">
                        {locale === "ko" ? field.label_ko : field.label_en}
                      </label>
                      {field.type === "short" ? (
                        <Input
                          id={field.name}
                          value={formValues[field.name] ?? ""}
                          onChange={(e) =>
                            setFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                          }
                          onBlur={() => {
                            // Stage 6's pre-filled location is only a guess:
                            // it's saved when the founder confirms it.
                            if (!(selectedStage.slug === MARKET && !locationReady)) {
                              saveMutation.mutate(false);
                            }
                          }}
                        />
                      ) : (
                        <Textarea
                          id={field.name}
                          rows={field.type === "list" ? 4 : 3}
                          value={formValues[field.name] ?? ""}
                          onChange={(e) =>
                            setFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                          }
                          onBlur={() => saveMutation.mutate(false)}
                        />
                      )}
                      {selectedStage.slug === MARKET && field.name === "user_metro_city" && (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={locationReady ? "outline" : "default"}
                            disabled={
                              saveMutation.isPending ||
                              !String(formValues.user_country ?? "").trim() ||
                              !String(formValues.user_metro_city ?? "").trim()
                            }
                            onClick={saveLocation}
                          >
                            {t("saveLocation")}
                          </Button>
                          <label className="flex items-center gap-1.5 text-xs">
                            <input
                              type="checkbox"
                              className="size-3.5"
                              checked={rememberLocation}
                              onChange={(e) => setRememberLocation(e.target.checked)}
                            />
                            {t("rememberLocation")}
                          </label>
                          {!locationReady && locationSources && (
                            <span className="text-muted-foreground w-full text-xs" data-testid="location-sources">
                              {[
                                locationSources.country &&
                                  t("locationSourceCountry", { source: t(`locationSources.${locationSources.country}`) }),
                                locationSources.city &&
                                  t("locationSourceCity", { source: t(`locationSources.${locationSources.city}`) }),
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                          {rememberLocationMutation.isSuccess && (
                            <span role="status" className="w-full text-xs text-green-700">
                              {t("locationRemembered")}
                            </span>
                          )}
                        </div>
                      )}
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
                    // An icon button for the AI mentor; its name doubles as the hover/focus tooltip.
                    <span className="group relative inline-flex">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={analyzeMutation.isPending ? t("analyzing") : t("getFeedback")}
                        onClick={askForFeedback}
                        disabled={analyzeMutation.isPending}
                        className="border-2 border-blue-600 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
                      >
                        {analyzeMutation.isPending ? (
                          <LoaderCircle aria-hidden className="size-5 animate-spin" />
                        ) : (
                          <BotMessageSquare aria-hidden className="size-5" />
                        )}
                      </Button>
                      <span
                        aria-hidden
                        data-testid="mentor-tooltip"
                        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 rounded-md bg-slate-900 px-2 py-1 text-xs whitespace-nowrap text-white opacity-0 shadow transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                      >
                        {analyzeMutation.isPending ? t("analyzing") : t("getFeedback")}
                      </span>
                    </span>
                  )}
                  {!RESEARCH_STAGES.includes(selectedStage.slug) && feedbackAt && (
                    <span className="text-muted-foreground text-xs" data-testid="feedback-time">
                      {t("lastFeedback", {
                        date: format.dateTime(new Date(feedbackAt), { dateStyle: "medium", timeStyle: "short" }),
                      })}
                    </span>
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
                {feedbackPrompts.length > 0 && (
                  <div
                    role="alert"
                    className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
                    data-testid="feedback-prompts"
                  >
                    {feedbackPrompts.includes("agent_not_run") && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex-1">{t("feedbackNeedsAgent")}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            document.getElementById("agent-run-title")?.scrollIntoView?.({ behavior: "smooth", block: "center" })
                          }
                        >
                          {t("goToAgent")}
                        </Button>
                      </div>
                    )}
                    {feedbackPrompts.includes("no_answers") && <span>{t("feedbackNeedsAnswers")}</span>}
                  </div>
                )}
                {analyzeMutation.isError && feedbackPrompts.length === 0 && (
                  <p className="text-destructive text-sm" role="alert">
                    {tokenLimitMessage(analyzeMutation.error) ?? t("errorAnalyzeFailed")}
                  </p>
                )}

                {latestAnalysis &&
                  !isIdeaResearch(latestAnalysis) &&
                  !isAlternativesResearch(latestAnalysis) &&
                  !isMarketResearch(latestAnalysis) &&
                  !isCompetitivePosition(latestAnalysis) &&
                  !isDfvAssessment(latestAnalysis) &&
                  !isBusinessModel(latestAnalysis) &&
                  !isMvp(latestAnalysis) &&
                  !isValidationPlan(latestAnalysis) &&
                  !isFinancialAnalysis(latestAnalysis) &&
                  !isMarketingPlan(latestAnalysis) &&
                  !isPersonaInsights(latestAnalysis) && (
                  <div className="flex flex-col gap-2 border-t pt-4">
                    <h3 className="font-semibold">{t("feedbackTitle")}</h3>
                    <p className="text-sm">{latestAnalysis.summary}</p>

                    <h4 className="text-sm font-medium">{t("feedbackStrengths")}</h4>
                    <ul className="list-disc pl-5 text-sm">
                      {latestAnalysis.strengths.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>

                    <h4 className="text-sm font-medium">{t("feedbackGaps")}</h4>
                    <ul className="list-disc pl-5 text-sm">
                      {latestAnalysis.gaps.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>

                    <h4 className="text-sm font-medium">{t("feedbackNextSteps")}</h4>
                    <ul className="list-disc pl-5 text-sm">
                      {latestAnalysis.suggested_next_steps.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </section>

        {selectedStage && (
          <aside className="flex shrink-0 flex-col gap-4 lg:w-72" aria-label={t("researchColumn")}>
            {/* Professor Notes and Study Guide, on every stage. */}
            <LearningTools
              key={selectedStage.slug}
              ventureId={ventureId}
              stageSlug={selectedStage.slug}
              stageTitle={t("stageHeading", {
                number: selectedStage.number,
                title: locale === "ko" ? selectedStage.title_ko : selectedStage.title_en,
              })}
              language={locale === "ko" ? "ko" : "en"}
            />
            {RESEARCH_STAGES.includes(selectedStage.slug) && (
              <ResearchSidebar
                research={displayedResearch}
                runs={historyQuery.data ?? []}
                viewingRunId={viewingRunId}
                onSelectRun={setViewingRunId}
                externalSources={selectedStage.slug === IDEA_DISCOVERY}
              />
            )}
          </aside>
        )}
      </div>
    </main>
  );
}

/**
 * Every stage as a numbered bubble, chained left to right in order, with the
 * current stage highlighted. Bubbles open their stage (locked ones can't).
 */
function StageChain({
  stages,
  currentSlug,
  titleOf,
  label,
  lockedHint,
  onSelect,
}: {
  stages: WizardStageStatus[];
  currentSlug: string | null;
  titleOf: (stage: WizardStageStatus) => string;
  label: string;
  lockedHint: (stage: WizardStageStatus) => string;
  onSelect: (stage: WizardStageStatus) => void;
}) {
  return (
    <nav aria-label={label} className="overflow-x-auto pb-1" data-testid="stage-chain">
      <ol className="flex min-w-max items-center px-1 py-1">
        {stages.map((stage, index) => {
          const current = stage.slug === currentSlug;
          const available = stage.implemented && !stage.locked;
          const done = stage.status === "completed";
          // A locked stage shows a padlock instead of its numbered bubble.
          const locked = stage.locked && !current;
          const style = locked
            ? "h-8 w-7 text-slate-600"
            : current
              ? "size-9 rounded-full border-2 border-blue-600 bg-blue-600 text-base font-bold text-white shadow-md ring-4 ring-blue-200"
              : done
                ? "size-7 rounded-full border-2 border-green-600 bg-green-50 text-xs font-semibold text-green-800"
                : "size-7 rounded-full border-2 border-slate-300 bg-white text-xs font-medium text-slate-700 disabled:opacity-40";
          return (
            <li key={stage.slug} className="flex items-center">
              {index > 0 && (
                <span
                  aria-hidden
                  className={`h-0.5 w-4 sm:w-6 ${stages[index - 1].status === "completed" ? "bg-green-500" : "bg-slate-300"}`}
                />
              )}
              <button
                type="button"
                disabled={!available}
                onClick={() => onSelect(stage)}
                aria-current={current ? "step" : undefined}
                aria-label={`${stage.number}. ${titleOf(stage)}`}
                title={stage.locked ? lockedHint(stage) : `${stage.number}. ${titleOf(stage)}`}
                data-testid={`chain-stage-${stage.number}`}
                className={`flex shrink-0 items-center justify-center tabular-nums transition-all enabled:hover:border-blue-500 disabled:cursor-not-allowed ${style}`}
              >
                {locked ? <ChainPadlock number={stage.number} /> : stage.number}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** A padlock with the stage number on its body, for locked stages in the chain. */
function ChainPadlock({ number }: { number: number }) {
  return (
    <svg viewBox="0 0 28 32" aria-hidden className="size-full" data-testid={`chain-lock-${number}`}>
      <path d="M8.5 14V9.5a5.5 5.5 0 0 1 11 0V14" fill="none" stroke="#94a3b8" strokeWidth="2.5" />
      <rect x="2" y="12.5" width="24" height="18" rx="4" fill="#f1f5f9" stroke="#94a3b8" strokeWidth="1.5" />
      <text
        x="14"
        y="22"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="11"
        fontWeight="600"
        fill="currentColor"
      >
        {number}
      </text>
    </svg>
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

/** Says when AI content is shown translated, with a way to see the original. */
function TranslationNotice({
  from,
  to,
  showingOriginal,
  translating,
  failed,
  onToggle,
  onRetry,
}: {
  from: "en" | "ko";
  to: "en" | "ko";
  showingOriginal: boolean;
  translating: boolean;
  failed: boolean;
  onToggle: () => void;
  onRetry: () => void;
}) {
  const t = useTranslations("Translation");
  const name = (code: "en" | "ko") => t(`languageNames.${code}`);
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900"
      data-testid="translation-notice"
    >
      <Languages aria-hidden className="size-4 shrink-0" />
      {showingOriginal ? (
        <span className="flex-1">{t("showingOriginal", { language: name(from) })}</span>
      ) : translating ? (
        <span role="status" className="flex-1">{t("translating", { language: name(to) })}</span>
      ) : failed ? (
        <span role="alert" className="flex-1">{t("failed", { language: name(from) })}</span>
      ) : (
        <span className="flex-1">{t("translatedFrom", { language: name(from) })}</span>
      )}
      {failed && !showingOriginal ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t("retry")}
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={onToggle} disabled={translating && !showingOriginal}>
          {showingOriginal ? t("showTranslation", { language: name(to) }) : t("showOriginal", { language: name(from) })}
        </Button>
      )}
    </div>
  );
}
