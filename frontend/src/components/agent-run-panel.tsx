"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CircleCheck, CircleHelp, FileText, Globe, MessageSquareReply, OctagonAlert, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { AgentStopExplanation } from "@/components/agent-stop-explanation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ACTIVE_AGENT_STATUSES,
  ApiError,
  answerAgentRun,
  cancelAgentRun,
  getLatestAgentRun,
  pauseAgentRun,
  resumeAgentRun,
  startAgentRun,
  type AgentRun,
  type AgentRunStep,
} from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";

const POLL_MS = 2000;

/**
 * A stage's AI agent: it works through several steps on its own (reading
 * earlier stages, searching the web, asking the founder) and drafts answers.
 * The run happens on the server; this panel follows it by polling.
 */
export function AgentRunPanel({
  ventureId,
  stageSlug,
  language,
  stageNumbers,
  fieldLabels,
  onFinished,
  onUseAnswers,
  explainStops = false,
}: {
  ventureId: string;
  stageSlug: string;
  language: "en" | "ko";
  /** Stage slug -> number, to name the stages the agent read. */
  stageNumbers: Record<string, number>;
  /** Offer "Tell me why the agent stopped" when a run fails or is stopped. */
  explainStops?: boolean;
  /** The stage's question labels, by field name. */
  fieldLabels: Record<string, string>;
  /** A run finished: reload the stage to show its research. */
  onFinished: () => void;
  /** Put the drafted answers into the stage's form (not saved). */
  onUseAnswers: (answers: Record<string, string | string[]>) => void;
}) {
  const t = useTranslations("AgentRun");
  const tLogin = useTranslations("Login");
  const queryClient = useQueryClient();
  const queryKey = ["agent-run", ventureId, stageSlug];
  const [answer, setAnswer] = useState("");
  const [usedRunId, setUsedRunId] = useState<string | null>(null);
  // The run whose "why it stopped" explanation is open.
  const [whyOpenFor, setWhyOpenFor] = useState<string | null>(null);

  const runQuery = useQuery({
    queryKey,
    queryFn: () => getLatestAgentRun(ventureId, stageSlug),
    refetchInterval: (query) => {
      const run = query.state.data;
      // Only a queued or running agent changes on its own.
      return run && (run.status === "queued" || run.status === "running") ? POLL_MS : false;
    },
  });
  const run = runQuery.data ?? null;
  const active = !!run && ACTIVE_AGENT_STATUSES.includes(run.status);

  const setRun = (next: AgentRun) => queryClient.setQueryData(queryKey, next);
  const startMutation = useMutation({
    mutationFn: () => startAgentRun(ventureId, stageSlug, language),
    onSuccess: (next) => {
      setAnswer("");
      setRun(next);
    },
  });
  const answerMutation = useMutation({
    mutationFn: (text: string) => answerAgentRun(ventureId, run!.id, text),
    onSuccess: (next) => {
      setAnswer("");
      setRun(next);
    },
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelAgentRun(ventureId, run!.id),
    onSuccess: setRun,
  });
  const pauseMutation = useMutation({
    mutationFn: () => pauseAgentRun(ventureId, run!.id),
    onSuccess: setRun,
  });
  const resumeMutation = useMutation({
    mutationFn: () => resumeAgentRun(ventureId, run!.id),
    onSuccess: setRun,
  });

  // Reload the stage when a run we watched (or started) finishes.
  const watching = useRef<string | null>(null);
  useEffect(() => {
    if (!run) return;
    if (ACTIVE_AGENT_STATUSES.includes(run.status)) {
      watching.current = run.id;
    } else if (watching.current === run.id) {
      watching.current = null;
      if (run.status === "succeeded") onFinished();
    }
  }, [run, onFinished]);

  const error =
    startMutation.error ?? answerMutation.error ?? cancelMutation.error ?? pauseMutation.error ?? resumeMutation.error;
  // A stage that isn't ready (e.g. no location, no persona chats) says why.
  const notReady =
    error instanceof ApiError && error.status === 422 && (error.detail === "location_required" || error.detail === "no_conversations")
      ? error.detail
      : null;

  function stepLabel(step: AgentRunStep): { icon: React.ReactNode; text: string } | null {
    const args = step.arguments ?? {};
    if (step.kind === "tool" && step.tool_name === "read_stage") {
      const slug = String(args.slug ?? "");
      return {
        icon: <FileText className="size-4 text-sky-600" />,
        text: t("steps.readStage", { number: stageNumbers[slug] ?? slug }),
      };
    }
    if (step.kind === "tool" && step.tool_name === "propose_answers")
      return { icon: <CircleCheck className="size-4 text-emerald-600" />, text: t("steps.proposed") };
    if (step.kind === "web_search")
      return { icon: <Globe className="size-4 text-violet-600" />, text: t("steps.searched") };
    if (step.kind === "question")
      return {
        icon: <CircleHelp className="size-4 text-amber-600" />,
        text: t("steps.asked", { question: String(args.question ?? "") }),
      };
    if (step.kind === "answer")
      return { icon: <MessageSquareReply className="size-4 text-slate-600" />, text: t("steps.answered") };
    if (step.kind === "error")
      return { icon: <RotateCcw className="size-4 text-slate-500" />, text: t("steps.corrected") };
    if (step.kind === "limit")
      return { icon: <OctagonAlert className="size-4 text-red-600" />, text: t("steps.limit") };
    return null; // model turns aren't shown
  }

  const steps = (run?.steps ?? []).map((s) => ({ step: s, label: stepLabel(s) })).filter((s) => s.label);
  const proposals = Object.entries(run?.proposed_answers ?? {}).filter(([, value]) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value),
  );

  return (
    <section
      aria-labelledby="agent-run-title"
      className="flex flex-col gap-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-4"
      data-testid="agent-run-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">
            <Bot aria-hidden className="size-7" />
          </span>
          <div>
            <h3 id="agent-run-title" className="text-xl font-bold text-indigo-900">
              {t("title")}
            </h3>
            <p className="text-muted-foreground text-sm">{t("description")}</p>
          </div>
        </div>
        {active ? (
          <div className="flex flex-wrap gap-2">
            {(run?.status === "queued" || run?.status === "running") && (
              <Button size="sm" variant="outline" onClick={() => pauseMutation.mutate()} disabled={pauseMutation.isPending}>
                {t("pause")}
              </Button>
            )}
            {run?.status === "paused" && (
              <Button size="sm" onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}>
                {t("resume")}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              {t("cancel")}
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={() => startMutation.mutate()} disabled={startMutation.isPending || runQuery.isLoading}>
            <Bot aria-hidden className="size-4" />
            {run ? t("runAgain") : t("run")}
          </Button>
        )}
      </div>

      {run && (
        <p role="status" className="flex items-center gap-2 text-sm">
          {(run.status === "queued" || run.status === "running") && (
            <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          )}
          <span className="font-medium">{t(`status.${run.status}`)}</span>
          {run.status === "failed" && run.error && <span>{t(`errors.${run.error}`)}</span>}
          <span className="text-muted-foreground">
            {t("stats", { searches: run.web_searches, turns: run.model_turns })}
          </span>
        </p>
      )}

      {steps.length > 0 && (
        <ol className="flex flex-col gap-1.5 text-sm" aria-label={t("stepsLabel")}>
          {steps.map(({ step, label }) => (
            <li key={step.seq} className="flex items-start gap-2">
              <span aria-hidden className="mt-0.5">
                {label!.icon}
              </span>
              <span>{label!.text}</span>
            </li>
          ))}
        </ol>
      )}

      {run?.status === "waiting_for_founder" && run.pending_question && (
        <form
          className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (answer.trim()) answerMutation.mutate(answer.trim());
          }}
        >
          <label htmlFor="agent-answer" className="text-sm font-medium text-amber-900">
            {t("questionLabel")} {run.pending_question}
          </label>
          <Textarea
            id="agent-answer"
            value={answer}
            maxLength={2000}
            rows={2}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <div>
            <Button size="sm" type="submit" disabled={!answer.trim() || answerMutation.isPending}>
              {t("sendAnswer")}
            </Button>
          </div>
        </form>
      )}

      {explainStops && run && (run.status === "failed" || run.status === "cancelled") && (
        <div className="flex flex-col gap-2">
          <div>
            <Button
              size="sm"
              variant="outline"
              aria-expanded={whyOpenFor === run.id}
              onClick={() => setWhyOpenFor(whyOpenFor === run.id ? null : run.id)}
            >
              {t("why.button")}
            </Button>
          </div>
          {whyOpenFor === run.id && (
            <AgentStopExplanation run={run} ventureId={ventureId} onRunAgain={() => startMutation.mutate()} />
          )}
        </div>
      )}

      {run?.status === "succeeded" && proposals.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border bg-white p-3" data-testid="agent-proposals">
          <p className="text-sm font-medium">{t("proposalsTitle")}</p>
          <dl className="flex flex-col gap-2 text-sm">
            {proposals.map(([name, value]) => (
              <div key={name}>
                <dt className="font-semibold text-blue-700">{fieldLabels[name] ?? name}</dt>
                <dd>{Array.isArray(value) ? value.join(", ") : value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onUseAnswers(Object.fromEntries(proposals));
                setUsedRunId(run.id);
              }}
            >
              {t("useAnswers")}
            </Button>
            {usedRunId === run.id && (
              <span role="status" className="text-sm text-emerald-700">
                {t("usedAnswers")}
              </span>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-800">
          {notReady ? t(`errors.${notReady}`) : authErrorMessage(error, tLogin, {
            byStatus: { 409: t("alreadyRunning"), 503: t("failedToStart") },
          })}
        </p>
      )}
    </section>
  );
}
