"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Download, Presentation, RefreshCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { ActionChecklist } from "@/components/action-checklist";
import { Button } from "@/components/ui/button";
import {
  downloadDeck,
  isMarketingPlan,
  researchStage,
  type ActionTimeframe,
  type MarketingChannel,
  type MarketingPlanAnalysis,
} from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";

const TIMEFRAMES: ActionTimeframe[] = ["this_week", "this_month", "this_quarter"];
// Categorical slot 1 of the validated chart palette; text uses text tokens.
const BAR_COLOR = "#2a78d6";
const AXIS_TEXT = "#52514e";
// Links come from the web and are untrusted: open separately, share no
// referrer, and give them no ranking credit.
const EXTERNAL_LINK = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;

function useMoney(currency: string) {
  const format = useFormatter();
  return (value: number) => {
    try {
      return format.number(value, { style: "currency", currency, maximumFractionDigits: 0 });
    } catch {
      return `${format.number(value, { maximumFractionDigits: 0 })} ${currency}`;
    }
  };
}

/**
 * Stage 13: a competitive, differentiated marketing plan, and the venture's
 * presentation deck on request. Budget totals and funnel rates are calculated
 * by the server, never by the AI.
 */
export function MarketingPlanPanel({
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
  analysis: MarketingPlanAnalysis | null;
  language: "en" | "ko";
  completedActions: string[];
  onToggleAction: (actionId: string, done: boolean) => void;
  onResearched: () => void;
  historical?: boolean;
  onBackToLatest?: () => void;
}) {
  const t = useTranslations("MarketingPlan");
  const tChecklist = useTranslations("ActionChecklist");
  const tLogin = useTranslations("Login");
  const format = useFormatter();
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  const researchMutation = useMutation({
    mutationFn: () => researchStage(ventureId, "marketing_plan", language),
    onSuccess: onResearched,
  });

  // Write the plan once, automatically, when there's nothing yet.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!analysis && !historical && !autoStarted.current) {
      autoStarted.current = true;
      researchMutation.mutate();
    }
  }, [analysis, historical, researchMutation]);

  const fresh = isMarketingPlan(researchMutation.data ?? null) ? researchMutation.data : null;
  const shown = historical ? analysis : (fresh ?? analysis);

  return (
    <section aria-labelledby="marketing-plan-title" className="flex flex-col gap-4 rounded-lg border bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="marketing-plan-title" className="font-semibold">
          {t("title")}
        </h3>
        {!historical && (
          <Button size="sm" variant="outline" disabled={researchMutation.isPending} onClick={() => researchMutation.mutate()} title={t("refreshHint")}>
            <RefreshCw aria-hidden className={`size-4 ${researchMutation.isPending ? "animate-spin" : ""}`} />
            {researchMutation.isPending ? t("refreshing") : t("refresh")}
          </Button>
        )}
      </div>

      {!historical && <DeckDownload ventureId={ventureId} language={language} />}

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
        <>
          <p className="text-sm leading-relaxed">{shown.summary}</p>
          <div className="rounded-md border-2 border-blue-200 bg-white p-3" data-testid="positioning-recap">
            <h4 className="text-xs font-semibold tracking-wide text-blue-800 uppercase">{t("positioningTitle")}</h4>
            <p className="text-sm font-medium">{shown.positioning_recap}</p>
          </div>

          <PlanBody plan={shown} />

          <ActionChecklist
            groups={TIMEFRAMES.map((timeframe) => ({
              key: timeframe,
              title: tChecklist(`timeframes.${timeframe}`),
              items: shown.action_items.filter((item) => item.timeframe === timeframe),
            }))}
            completedActions={completedActions}
            onToggle={onToggleAction}
            readOnly={historical}
          />

          <p className="text-muted-foreground flex flex-col gap-0.5 border-t pt-3 text-xs">
            {shown.based_on && <span>{t("basedOn", { date: when(shown.based_on) })}</span>}
            <span>{t("disclaimer", { date: when(shown.researched_at) })}</span>
          </p>
        </>
      )}
    </section>
  );
}

function DeckDownload({ ventureId, language }: { ventureId: string; language: "en" | "ko" }) {
  const t = useTranslations("MarketingPlan");
  const [filename, setFilename] = useState<string | null>(null);
  const deckMutation = useMutation({
    mutationFn: () => downloadDeck(ventureId, language),
    onSuccess: ({ blob, filename: name }) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setFilename(name);
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border bg-white p-3" data-testid="deck-download">
      <Presentation aria-hidden className="size-6 shrink-0 text-blue-700" />
      <div className="min-w-48 flex-1">
        <p className="text-sm font-semibold">{t("deckTitle")}</p>
        <p className="text-muted-foreground text-xs">{t("deckDescription")}</p>
      </div>
      <Button onClick={() => deckMutation.mutate()} disabled={deckMutation.isPending}>
        <Download aria-hidden className="size-4" />
        {deckMutation.isPending ? t("deckBuilding") : t("deckButton")}
      </Button>
      {deckMutation.isSuccess && filename && (
        <p role="status" className="w-full text-xs text-green-700">
          {t("deckReady", { filename })}
        </p>
      )}
      {deckMutation.isError && (
        <p role="alert" className="w-full text-xs text-red-800">
          {t("deckFailed")}
        </p>
      )}
    </div>
  );
}

function PlanBody({ plan }: { plan: MarketingPlanAnalysis }) {
  const t = useTranslations("MarketingPlan");
  const format = useFormatter();
  const money = useMoney(plan.currency);
  const percent = (value: number | null) =>
    value === null ? "—" : format.number(value, { style: "percent", maximumFractionDigits: 1 });
  const budget = plan.budget;

  return (
    <>
      <div>
        <h4 className="mb-2 text-sm font-semibold">{t("personasTitle")}</h4>
        <div className="grid gap-2 sm:grid-cols-2" data-testid="personas">
          {plan.personas.map((persona) => (
            <div key={persona.name} className="rounded-md border bg-white p-3 text-sm">
              <p className="font-semibold">{persona.name}</p>
              <p className="text-muted-foreground text-xs">{persona.description}</p>
              <p className="mt-1 text-xs">
                <span className="font-semibold">{t("pains")}:</span> {persona.pains.join(", ")}
              </p>
              <p className="text-xs">
                <span className="font-semibold">{t("reach")}:</span> {persona.where_to_reach.join(", ")}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 text-sm font-semibold">{t("messagesTitle")}</h4>
          <ul className="flex flex-col gap-2" data-testid="key-messages">
            {plan.key_messages.map((item, index) => (
              <li key={index} className="rounded-md border bg-white p-3 text-sm">
                <p className="font-medium">“{item.message}”</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  <span className="font-semibold">{t("proof")}</span> {item.proof_point}
                </p>
                <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                  {t("counters", { alternative: item.counters })}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {plan.differentiators.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-semibold">{t("differentiatorsTitle")}</h4>
            <ul className="flex flex-col gap-1.5 text-sm">
              {plan.differentiators.map((item, index) => (
                <li key={index}>
                  <span className="font-medium">{item.claim}</span>{" "}
                  <span className="text-muted-foreground text-xs">{t("versus", { alternative: item.versus })}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">{t("channelsTitle")}</h4>
        <div className="overflow-x-auto rounded-md border bg-white">
          <table className="w-full text-left text-xs" data-testid="channels-table">
            <thead className="bg-slate-50">
              <tr>
                {(["channel", "type", "budget", "start", "kpi"] as const).map((col) => (
                  <th key={col} scope="col" className="p-2 font-semibold">
                    {t(`columns.${col}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plan.channels.map((channel) => (
                <ChannelRow key={channel.name} channel={channel} money={money} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-md border bg-white p-3" data-testid="budget">
        <h4 className="mb-2 text-sm font-semibold">{t("budgetTitle")}</h4>
        <BudgetChart channels={plan.channels} money={money} total={money(budget.total_monthly)} />
        <p className="mt-2 text-sm font-semibold">{t("budgetTotal", { total: money(budget.total_monthly) })}</p>
        <p className="text-muted-foreground text-xs">{t("budgetCalculated")}</p>
        {budget.projection_monthly === null ? (
          <p className="text-muted-foreground mt-1 text-xs">{t("budgetNoProjection")}</p>
        ) : budget.over_projection ? (
          <p role="alert" className="mt-1 flex items-start gap-1.5 text-xs text-amber-900">
            <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {t("budgetOver", { amount: money(budget.gap_to_projection ?? 0) })}
          </p>
        ) : (
          <p className="text-muted-foreground mt-1 text-xs">{t("budgetVsProjection", { amount: money(budget.projection_monthly) })}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 text-sm font-semibold">{t("launchTitle")}</h4>
          <ol className="flex flex-col gap-2 border-l-2 border-blue-200 pl-3" data-testid="launch-phases">
            {plan.launch_phases.map((phase) => (
              <li key={phase.name} className="text-sm">
                <p className="font-medium">
                  {phase.name}{" "}
                  <span className="text-muted-foreground text-xs font-normal">
                    {t("weeks", { start: phase.start_week, end: phase.end_week })}
                  </span>
                </p>
                <ul className="list-disc pl-4 text-xs">
                  {phase.activities.map((activity, index) => (
                    <li key={index}>{activity}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
        <div data-testid="funnel">
          <h4 className="mb-2 text-sm font-semibold">{t("funnelTitle", { month: plan.funnel.target_month })}</h4>
          <dl className="flex flex-col gap-1 text-sm">
            {(
              [
                ["awareness", null],
                ["leads", plan.funnel.rates.leads_per_awareness],
                ["trials", plan.funnel.rates.trials_per_lead],
                ["paying", plan.funnel.rates.paying_per_trial],
              ] as const
            ).map(([step, rate]) => (
              <div key={step} className="flex items-baseline justify-between gap-2 rounded bg-white px-2 py-1">
                <dt>{t(`funnelSteps.${step}`)}</dt>
                <dd className="tabular-nums">
                  <span className="font-semibold">{format.number(plan.funnel[step])}</span>
                  {rate !== null && (
                    <span className="text-muted-foreground ml-2 text-xs">{t("stepRate", { rate: percent(rate) })}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-1 text-xs font-medium">{t("overallRate", { rate: percent(plan.funnel.rates.paying_per_awareness) })}</p>
        </div>
      </div>

      {plan.risks.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-semibold">{t("risksTitle")}</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {plan.risks.map((risk, index) => (
              <li key={index}>{risk}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function ChannelRow({ channel, money }: { channel: MarketingChannel; money: (value: number) => string }) {
  const t = useTranslations("MarketingPlan");
  const format = useFormatter();
  return (
    <tr className="border-t align-top">
      <th scope="row" className="p-2 font-medium">
        {channel.url ? (
          <a href={channel.url} {...EXTERNAL_LINK} aria-label={t("visitChannel", { name: channel.name })} className="text-blue-700 hover:underline">
            {channel.name} ↗
          </a>
        ) : (
          channel.name
        )}
        <span className="text-muted-foreground block font-normal">{channel.why}</span>
      </th>
      <td className="p-2">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 whitespace-nowrap text-slate-700">{t(`channelTypes.${channel.type}`)}</span>
      </td>
      <td className="p-2 tabular-nums">{money(channel.monthly_budget)}</td>
      <td className="p-2 tabular-nums">{channel.start_month}</td>
      <td className="p-2">
        <span className="tabular-nums">{format.number(channel.kpi_target)}</span> {channel.kpi_metric}
      </td>
    </tr>
  );
}

/** Horizontal bars: <= 24px thick, rounded 4px at the tip, square at the
 * baseline, value at the tip in text colour, a tooltip on each bar. */
function BudgetChart({
  channels,
  money,
  total,
}: {
  channels: MarketingChannel[];
  money: (value: number) => string;
  total: string;
}) {
  const t = useTranslations("MarketingPlan");
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...channels.map((c) => c.monthly_budget), 1);
  const LABEL_W = 150;
  const VALUE_W = 80;
  const WIDTH = 600;
  const ROW = 34;
  const BAR = 20;
  const plotW = WIDTH - LABEL_W - VALUE_W;
  const height = channels.length * ROW;

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full" role="img" aria-label={t("budgetChartLabel", { total })} data-testid="budget-chart">
        <line x1={LABEL_W} x2={LABEL_W} y1={0} y2={height} stroke="#a8a29e" strokeWidth={1} />
        {channels.map((channel, index) => {
          const w = (channel.monthly_budget / max) * plotW;
          const y = index * ROW + (ROW - BAR) / 2;
          const r = Math.min(4, w / 2);
          // Square at the baseline (left), 4px rounded at the tip (right).
          const path =
            w <= 0
              ? ""
              : `M${LABEL_W},${y} H${LABEL_W + w - r} Q${LABEL_W + w},${y} ${LABEL_W + w},${y + r} V${y + BAR - r} Q${LABEL_W + w},${y + BAR} ${LABEL_W + w - r},${y + BAR} H${LABEL_W} Z`;
          return (
            <g
              key={channel.name}
              tabIndex={0}
              onPointerEnter={() => setActive(index)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              className="outline-none"
            >
              {/* A full-row hit target, bigger than the bar. */}
              <rect x={0} y={index * ROW} width={WIDTH} height={ROW} fill="transparent" />
              <text x={LABEL_W - 8} y={y + BAR / 2} dy="0.32em" textAnchor="end" fontSize={11} fill={AXIS_TEXT}>
                {channel.name.length > 24 ? `${channel.name.slice(0, 23)}…` : channel.name}
              </text>
              {path && <path d={path} fill={BAR_COLOR} opacity={active === null || active === index ? 1 : 0.55} />}
              <text x={LABEL_W + w + 6} y={y + BAR / 2} dy="0.32em" fontSize={11} fill="#0b0b0b">
                {money(channel.monthly_budget)}
              </text>
            </g>
          );
        })}
      </svg>
      {active !== null && channels[active] && (
        <div role="status" className="pointer-events-none absolute right-0 top-0 rounded-md border bg-white px-2 py-1 text-xs shadow" data-testid="budget-tooltip">
          <p className="font-semibold">{channels[active].name}</p>
          <p>
            {t(`channelTypes.${channels[active].type}`)} · {money(channels[active].monthly_budget)}
          </p>
        </div>
      )}
    </figure>
  );
}
