"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { ActionChecklist } from "@/components/action-checklist";
import { SourceLink } from "@/components/market-evidence-panel";
import { Button } from "@/components/ui/button";
import {
  isBusinessModel,
  researchStage,
  type BusinessModelAnalysis,
  type CanvasBlock,
  type CompletionArea,
  type HealthStatus,
  type UnitEconomicsInput,
} from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";

const AREAS: CompletionArea[] = ["validation", "customers", "offering", "go_to_market", "operations", "finances"];
const INPUTS: UnitEconomicsInput[] = [
  "monthly_revenue_per_customer",
  "monthly_cost_to_serve",
  "customer_acquisition_cost",
  "monthly_churn_rate",
];

// The classic canvas layout on wide screens (10-column grid); one column on phones.
const CANVAS_LAYOUT: { block: CanvasBlock; className: string }[] = [
  { block: "key_partnerships", className: "lg:col-span-2 lg:row-span-2" },
  { block: "key_activities", className: "lg:col-span-2" },
  { block: "value_propositions", className: "lg:col-span-2 lg:row-span-2 border-blue-300 bg-blue-50/50" },
  { block: "customer_relationships", className: "lg:col-span-2" },
  { block: "customer_segments", className: "lg:col-span-2 lg:row-span-2" },
  { block: "key_resources", className: "lg:col-span-2" },
  { block: "channels", className: "lg:col-span-2" },
  { block: "cost_structure", className: "lg:col-span-5" },
  { block: "revenue_streams", className: "lg:col-span-5" },
];

// Health carries an icon and a text label, never colour alone.
const HEALTH_STYLE: Record<HealthStatus, { icon: typeof CheckCircle2; classes: string }> = {
  healthy: { icon: CheckCircle2, classes: "bg-green-50 text-green-800" },
  watch: { icon: AlertTriangle, classes: "bg-amber-50 text-amber-800" },
  unhealthy: { icon: XCircle, classes: "bg-red-50 text-red-800" },
};

/**
 * Stage 9: the business model recommended from stages 1-8, with unit
 * economics calculated by the server from sourced inputs, and the things
 * still to complete as a checklist.
 */
export function BusinessModelPanel({
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
  analysis: BusinessModelAnalysis | null;
  language: "en" | "ko";
  /** IDs of the things to complete the founder has ticked off. */
  completedActions: string[];
  onToggleAction: (actionId: string, done: boolean) => void;
  onResearched: () => void;
  /** Showing an earlier saved run instead of the latest model. */
  historical?: boolean;
  onBackToLatest?: () => void;
}) {
  const t = useTranslations("BusinessModel");
  const tLogin = useTranslations("Login");
  const format = useFormatter();
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  const researchMutation = useMutation({
    mutationFn: () => researchStage(ventureId, "business_model", language),
    onSuccess: onResearched,
  });

  // Design the model once, automatically, when there's nothing yet.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!analysis && !historical && !autoStarted.current) {
      autoStarted.current = true;
      researchMutation.mutate();
    }
  }, [analysis, historical, researchMutation]);

  const fresh = isBusinessModel(researchMutation.data ?? null) ? researchMutation.data : null;
  const shown = historical ? analysis : (fresh ?? analysis);

  return (
    <section aria-labelledby="business-model-title" className="flex flex-col gap-4 rounded-lg border bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="business-model-title" className="font-semibold">
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
        <ModelBody
          model={shown}
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

function ModelBody({
  model,
  completedActions,
  onToggleAction,
  readOnly,
}: {
  model: BusinessModelAnalysis;
  completedActions: string[];
  onToggleAction: (actionId: string, done: boolean) => void;
  readOnly: boolean;
}) {
  const t = useTranslations("BusinessModel");
  const stageLabel = (stage: string) => (t.has(`evidenceStages.${stage}`) ? t(`evidenceStages.${stage}`) : stage);

  return (
    <>
      <p className="text-sm leading-relaxed">{model.summary}</p>

      <div className="rounded-md border-2 border-blue-200 bg-white p-4" data-testid="recommended-model">
        <h4 className="text-xs font-semibold tracking-wide text-blue-800 uppercase">{t("recommended")}</h4>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold">
          {model.model_name}
          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-normal text-blue-800">
            {t.has(`modelTypes.${model.model_type}`) ? t(`modelTypes.${model.model_type}`) : model.model_type}
          </span>
        </p>
        <h5 className="mt-3 mb-1 text-sm font-semibold">{t("whyTitle")}</h5>
        <ul className="flex flex-col gap-1 text-sm">
          {model.why_this_model.map((item, index) => (
            <li key={index} className="flex flex-wrap items-baseline gap-2">
              <span>• {item.reason}</span>
              <span className="rounded bg-slate-100 px-1 py-0.5 text-xs whitespace-nowrap text-slate-700">
                {stageLabel(item.evidence_stage)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">{t("canvasTitle")}</h4>
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-10" data-testid="business-model-canvas">
          {CANVAS_LAYOUT.map(({ block, className }) => (
            <div key={block} className={`rounded-md border bg-white p-3 ${className}`} data-testid={`canvas-${block}`}>
              <h5 className="mb-1 text-xs font-semibold">{t(`canvas.${block}`)}</h5>
              <ul className="list-disc space-y-0.5 pl-4 text-xs">
                {model.canvas[block].map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mb-1 text-sm font-semibold">{t("pricingTitle")}</h4>
        <p className="mb-2 text-sm">{model.pricing.strategy}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="pricing-tiers">
          {model.pricing.tiers.map((tier) => (
            <div key={tier.name} className="rounded-md border bg-white p-3 text-sm">
              <p className="font-semibold">{tier.name}</p>
              <p className="text-base font-bold">{tier.price}</p>
              <p className="text-muted-foreground text-xs">{t("tierFor", { customer: tier.target_customer })}</p>
              <ul className="mt-1 list-disc pl-4 text-xs">
                {tier.includes.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <UnitEconomics economics={model.unit_economics} />

      {model.alternatives_considered.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">{t("alternativesTitle")}</h4>
          <ul className="grid gap-2 sm:grid-cols-3">
            {model.alternatives_considered.map((alt) => (
              <li key={alt.name} className="rounded-md border bg-white p-3 text-xs">
                <p className="text-sm font-medium">{alt.name}</p>
                <p className="mt-1">
                  <span className="font-semibold">{t("whyNot")}</span> {alt.why_not}
                </p>
                <p className="mt-1">
                  <span className="font-semibold">{t("whenFits")}</span> {alt.when_it_would_fit}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <ListSection title={t("kpisTitle")} items={model.launch_kpis} />
        <ListSection title={t("risksTitle")} items={model.key_risks} />
      </div>

      <ActionChecklist
        title={t("thingsTitle")}
        groups={AREAS.map((area) => ({
          key: area,
          title: t(`areas.${area}`),
          items: model.things_to_complete.filter((item) => item.area === area),
        }))}
        completedActions={completedActions}
        onToggle={onToggleAction}
        readOnly={readOnly}
        showTimeframe
      />
    </>
  );
}

function UnitEconomics({ economics }: { economics: BusinessModelAnalysis["unit_economics"] }) {
  const t = useTranslations("BusinessModel");
  const format = useFormatter();
  const { metrics, health, inputs, currency } = economics;

  const money = (value: number) => {
    try {
      return format.number(value, { style: "currency", currency, maximumFractionDigits: 2 });
    } catch {
      // Not an ISO currency code: show the number and the code as given.
      return `${format.number(value, { maximumFractionDigits: 2 })} ${currency}`;
    }
  };
  const percent = (share: number) => format.number(share, { style: "percent", maximumFractionDigits: 1 });
  const months = (value: number) => t("months", { count: value });

  const cards: { key: keyof typeof metrics; value: string; health?: HealthStatus }[] = [
    { key: "monthly_contribution", value: money(metrics.monthly_contribution) },
    {
      key: "contribution_margin",
      value: metrics.contribution_margin === null ? t("notApplicable") : percent(metrics.contribution_margin),
      health: health.contribution_margin,
    },
    { key: "customer_lifetime_months", value: months(metrics.customer_lifetime_months) },
    { key: "lifetime_value", value: money(metrics.lifetime_value) },
    {
      key: "ltv_to_cac",
      value:
        metrics.ltv_to_cac === null
          ? t("notApplicable")
          : t("ratio", { value: format.number(metrics.ltv_to_cac, { maximumFractionDigits: 2 }) }),
      health: health.ltv_to_cac,
    },
    {
      key: "cac_payback_months",
      value: metrics.cac_payback_months === null ? t("never") : months(metrics.cac_payback_months),
      health: health.cac_payback_months,
    },
  ];

  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold">{t("economicsTitle")}</h4>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {cards.map((card) => {
          const style = card.health ? HEALTH_STYLE[card.health] : null;
          const Icon = style?.icon;
          return (
            <div key={card.key} className="rounded-md border bg-white p-3" data-testid={`metric-${card.key}`}>
              <p className="text-muted-foreground text-xs">{t(`metrics.${card.key}`)}</p>
              <p className="text-lg font-bold tabular-nums">{card.value}</p>
              {card.health && style && Icon && (
                <p className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                  <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${style.classes}`}>
                    <Icon aria-hidden className="size-3" />
                    {t(`health.${card.health}`)}
                  </span>
                  <span className="text-muted-foreground">
                    {t(`healthTargets.${card.key as "ltv_to_cac" | "cac_payback_months" | "contribution_margin"}`)}
                  </span>
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-muted-foreground mt-2 text-xs">{t("economicsNote")}</p>

      <h5 className="mt-3 mb-1 text-sm font-semibold">{t("inputsTitle")}</h5>
      <ul className="flex flex-col gap-2" data-testid="economics-inputs">
        {INPUTS.map((name) => {
          const figure = inputs[name];
          const value = name === "monthly_churn_rate" ? percent(figure.value) : money(figure.value);
          return (
            <li key={name} className="text-xs" data-testid={`input-${name}`}>
              <span className="font-semibold">{t(`inputs.${name}`)}:</span> <span className="tabular-nums">{value}</span>
              {figure.is_estimate && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">{t("estimate")}</span>
              )}
              <span className="text-muted-foreground block">{figure.explanation}</span>
              <span className="block">
                <SourceLink source={figure} />
                {figure.year && <span className="text-muted-foreground"> · {figure.year}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold">{title}</h4>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
