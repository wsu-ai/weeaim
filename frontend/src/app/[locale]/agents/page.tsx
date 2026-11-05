"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Construction,
  LoaderCircle,
  Lock,
  MessageCircleQuestion,
  Pause,
  Play,
  RotateCw,
  Square,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import {
  ACTIVE_AGENT_STATUSES,
  ApiError,
  cancelAgentRun,
  listVentureAgents,
  listVentures,
  pauseAgentRun,
  resumeAgentRun,
  startAgentRun,
  type VentureAgent,
} from "@/lib/api";
import { useTokenLimitMessage } from "@/lib/token-limit";

const POLL_MS = 3000;

type RowState =
  | "not_built"
  | "locked"
  | "not_run"
  | "queued"
  | "running"
  | "waiting_for_founder"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled";

const STATE_STYLE: Record<RowState, { icon: React.ElementType; className: string; spin?: boolean }> = {
  not_built: { icon: Construction, className: "bg-slate-100 text-slate-600" },
  locked: { icon: Lock, className: "bg-slate-100 text-slate-600" },
  not_run: { icon: CircleDashed, className: "bg-slate-100 text-slate-600" },
  queued: { icon: Clock, className: "bg-sky-50 text-sky-800" },
  running: { icon: LoaderCircle, className: "bg-blue-50 text-blue-800", spin: true },
  waiting_for_founder: { icon: MessageCircleQuestion, className: "bg-amber-50 text-amber-900" },
  paused: { icon: Pause, className: "bg-amber-50 text-amber-900" },
  succeeded: { icon: CircleCheck, className: "bg-green-50 text-green-800" },
  failed: { icon: CircleX, className: "bg-red-50 text-red-800" },
  cancelled: { icon: Square, className: "bg-slate-100 text-slate-700" },
};

function rowState(agent: VentureAgent): RowState {
  if (!agent.available) return "not_built";
  const status = agent.latest?.status;
  if (status && ACTIVE_AGENT_STATUSES.includes(status)) return status;
  if (agent.locked_by.length > 0) return "locked";
  return status ?? "not_run";
}

/**
 * "My AI Agents": every stage's AI agent for one venture -- its status, how
 * long it has worked, how often it ran and the tokens it used -- with stop,
 * pause/resume and re-run.
 */
export default function MyAgentsPage() {
  const t = useTranslations("Agents");
  const venturesQuery = useQuery({ queryKey: ["ventures"], queryFn: listVentures });
  const ventures = venturesQuery.data ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  // The most recently worked-on venture comes first.
  const ventureId = chosen ?? ventures[0]?.id ?? null;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
        {ventures.length > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t("venture")}</span>
            <select
              value={ventureId ?? ""}
              onChange={(e) => setChosen(e.target.value)}
              className="h-9 max-w-xs rounded-md border bg-white px-2"
            >
              {ventures.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {venturesQuery.isPending && <p className="text-muted-foreground text-sm">{t("loading")}</p>}
      {venturesQuery.isError && (
        <p role="alert" className="text-destructive text-sm">
          {t("loadFailed")}
        </p>
      )}
      {venturesQuery.isSuccess && ventures.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-6">
            <p>{t("noVentures")}</p>
            <Link href="/ventures/new" className="font-medium text-blue-700 hover:underline">
              {t("startFirst")}
            </Link>
          </CardContent>
        </Card>
      )}

      {ventureId && <AgentsTable key={ventureId} ventureId={ventureId} />}
    </main>
  );
}

function AgentsTable({ ventureId }: { ventureId: string }) {
  const t = useTranslations("Agents");
  const locale = useLocale();
  const format = useFormatter();
  const queryClient = useQueryClient();
  const queryKey = ["venture-agents", ventureId];
  const [actionError, setActionError] = useState<string | null>(null);
  const tokenLimitMessage = useTokenLimitMessage();

  const agentsQuery = useQuery({
    queryKey,
    queryFn: () => listVentureAgents(ventureId),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((a) => a.latest?.status === "queued" || a.latest?.status === "running")
        ? POLL_MS
        : false,
  });
  const agents = agentsQuery.data ?? [];
  const numberOf = Object.fromEntries(agents.map((a) => [a.slug, a.stage_number]));
  const title = (a: VentureAgent) => (locale === "ko" ? a.title_ko : a.title_en);

  const actionMutation = useMutation({
    mutationFn: ({ kind, agent }: { kind: "stop" | "pause" | "resume" | "rerun"; agent: VentureAgent }) => {
      const runId = agent.latest?.id ?? "";
      if (kind === "stop") return cancelAgentRun(ventureId, runId);
      if (kind === "pause") return pauseAgentRun(ventureId, runId);
      if (kind === "resume") return resumeAgentRun(ventureId, runId);
      const active = !!agent.latest && ACTIVE_AGENT_STATUSES.includes(agent.latest.status);
      return startAgentRun(ventureId, agent.slug, locale === "ko" ? "ko" : "en", active);
    },
    onMutate: () => setActionError(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (error) => {
      const detail = error instanceof ApiError ? error.detail : null;
      setActionError(
        tokenLimitMessage(error) ??
        (detail === "location_required" || detail === "no_conversations"
          ? t(`errors.${detail}`)
          : error instanceof ApiError && error.status === 409
            ? t("errors.conflict")
            : t("errors.failed")),
      );
      queryClient.invalidateQueries({ queryKey });
    },
  });

  function duration(ms: number): string {
    const totalSeconds = Math.round(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return t("durationHM", { h, m });
    if (m > 0) return t("durationMS", { m, s });
    return t("durationS", { s });
  }

  if (agentsQuery.isPending) return <p className="text-muted-foreground text-sm">{t("loading")}</p>;
  if (agentsQuery.isError)
    return (
      <p role="alert" className="text-destructive text-sm">
        {t("loadFailed")}
      </p>
    );

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 px-0 py-0">
        {actionError && (
          <p role="alert" className="mx-4 mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {actionError}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm" data-testid="agents-table">
            <thead className="bg-muted/50 text-muted-foreground text-left text-xs uppercase tracking-wide">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">{t("columns.stage")}</th>
                <th scope="col" className="px-4 py-2.5 font-medium">{t("columns.agent")}</th>
                <th scope="col" className="px-4 py-2.5 font-medium">{t("columns.status")}</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">{t("columns.duration")}</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">{t("columns.runs")}</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">{t("columns.tokens")}</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">{t("columns.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {agents.map((agent) => {
                const state = rowState(agent);
                const style = STATE_STYLE[state];
                const Icon = style.icon;
                const status = agent.latest?.status;
                const active = !!status && ACTIVE_AGENT_STATUSES.includes(status);
                const busy = actionMutation.isPending && actionMutation.variables?.agent.slug === agent.slug;
                const name = t(`names.${agent.slug}`);
                const lockedHint = t("lockedHint", {
                  stages: agent.locked_by.map((slug) => numberOf[slug]).filter(Boolean).join(", "),
                });
                const act = (kind: "stop" | "pause" | "resume" | "rerun") => actionMutation.mutate({ kind, agent });
                return (
                  <tr key={agent.slug} data-testid={`agent-row-${agent.stage_number}`}>
                    <td className="px-4 py-3 tabular-nums font-semibold">
                      {agent.available && agent.locked_by.length === 0 ? (
                        <Link
                          href={`/ventures/${ventureId}?stage=${agent.slug}`}
                          aria-label={t("openStage", { number: agent.stage_number, title: title(agent) })}
                          title={t("openStage", { number: agent.stage_number, title: title(agent) })}
                          className="inline-flex h-7 min-w-11 items-center justify-center rounded-full bg-blue-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none"
                        >
                          {agent.stage_number}
                        </Link>
                      ) : (
                        <span
                          className="inline-flex h-7 min-w-11 cursor-not-allowed items-center justify-center rounded-full bg-slate-300 px-3 text-sm font-semibold text-slate-700"
                          title={agent.available ? lockedHint : t("status.not_built")}
                        >
                          {agent.stage_number}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{name}</span>
                      <span className="text-muted-foreground block text-xs">{title(agent)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}
                        title={state === "locked" ? lockedHint : undefined}
                      >
                        <Icon aria-hidden className={`size-3.5 ${style.spin ? "animate-spin" : ""}`} />
                        {t(`status.${state}`)}
                      </span>
                      {state === "failed" && agent.latest?.error && (
                        <span className="text-muted-foreground block pt-1 text-xs">
                          {t.has(`reasons.${agent.latest.error}`) ? t(`reasons.${agent.latest.error}`) : agent.latest.error}
                        </span>
                      )}
                      {state === "waiting_for_founder" && (
                        <Link
                          href={`/ventures/${ventureId}`}
                          className="block pt-1 text-xs font-medium text-blue-700 hover:underline"
                        >
                          {t("answer")}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{duration(agent.total_active_ms)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{format.number(agent.runs)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{format.number(agent.total_tokens)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <IconAction
                          label={t("actions.stop", { name })}
                          disabled={!active || busy}
                          onClick={() => act("stop")}
                        >
                          <Square />
                        </IconAction>
                        {status === "paused" ? (
                          <IconAction label={t("actions.resume", { name })} disabled={busy} onClick={() => act("resume")}>
                            <Play />
                          </IconAction>
                        ) : (
                          <IconAction
                            label={t("actions.pause", { name })}
                            disabled={!(status === "queued" || status === "running") || busy}
                            onClick={() => act("pause")}
                          >
                            <Pause />
                          </IconAction>
                        )}
                        <IconAction
                          label={t("actions.rerun", { name })}
                          disabled={!agent.available || agent.locked_by.length > 0 || busy}
                          onClick={() => {
                            if (active && !window.confirm(t("rerunConfirm", { name }))) return;
                            act("rerun");
                          }}
                        >
                          <RotateCw />
                        </IconAction>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function IconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}
