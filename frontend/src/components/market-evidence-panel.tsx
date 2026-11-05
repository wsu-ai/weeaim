"use client";

import { useMutation } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  isMarketResearch,
  marketScopes,
  researchStage,
  type MarketResearchAnalysis,
  type MarketScopeResult,
  type SourcedFigure,
} from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";
import { MarketPieChart } from "./market-pie-chart";

// Links come from the web and are untrusted: open separately, share no
// referrer, and give them no ranking credit.
const EXTERNAL_LINK = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;

type Source = {
  source_title: string | null;
  source_url: string | null;
  source_verified: boolean;
  search_url: string | null;
};

type Money = (value: number, currency: string, compact?: boolean) => string;

/**
 * Stage 6: market evidence for three geographies -- global, the founder's
 * country and metropolitan city. TAM/SAM/SOM are computed by the server from
 * the sourced inputs shown; demographics, published reports and vendors back
 * them up.
 */
export function MarketEvidencePanel({
  ventureId,
  analysis,
  language,
  locationReady,
  onResearched,
  historical = false,
  onBackToLatest,
}: {
  ventureId: string;
  analysis: MarketResearchAnalysis | null;
  language: "en" | "ko";
  /** The founder's country and city are saved (research needs them). */
  locationReady: boolean;
  onResearched: () => void;
  historical?: boolean;
  onBackToLatest?: () => void;
}) {
  const t = useTranslations("MarketEvidence");
  const tLogin = useTranslations("Login");
  const format = useFormatter();
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  const researchMutation = useMutation({
    mutationFn: () => researchStage(ventureId, "market_evidence", language),
    onSuccess: onResearched,
  });

  // Research once, automatically, as soon as there's a location and no research.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!analysis && !historical && locationReady && !autoStarted.current) {
      autoStarted.current = true;
      researchMutation.mutate();
    }
  }, [analysis, historical, locationReady, researchMutation]);

  const fresh = isMarketResearch(researchMutation.data ?? null) ? researchMutation.data : null;
  const shown = historical ? analysis : (fresh ?? analysis);

  return (
    <section aria-labelledby="market-evidence-title" className="flex flex-col gap-5 rounded-lg border bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="market-evidence-title" className="font-semibold">
          {t("title")}
        </h3>
        {/* Re-analyzes TAM/SAM/SOM for all three markets (global, country, city). */}
        {!historical && (
          <Button
            size="sm"
            variant="outline"
            disabled={researchMutation.isPending || !locationReady}
            title={locationReady ? t("refreshHint") : t("locationNeeded")}
            onClick={() => researchMutation.mutate()}
          >
            <RefreshCw aria-hidden className={researchMutation.isPending ? "animate-spin" : undefined} />
            {researchMutation.isPending ? t("refreshing") : t("refresh")}
          </Button>
        )}
      </div>

      {!locationReady && !shown && (
        <p role="status" className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {t("locationNeeded")}
        </p>
      )}

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
          <span>
            {authErrorMessage(researchMutation.error, tLogin, {
              byDetail: { location_required: t("locationNeeded") },
              byStatus: { 503: t("failed") },
            })}
          </span>
          <Button size="sm" variant="outline" onClick={() => researchMutation.mutate()}>
            {t("retry")}
          </Button>
        </div>
      )}

      {shown && <MarketEvidenceBody research={shown} />}

      {shown && (
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
          <span className="flex flex-col gap-0.5">
            {shown.based_on && <span>{t("basedOn", { date: when(shown.based_on) })}</span>}
            <span>{t("disclaimer", { date: when(shown.researched_at) })}</span>
          </span>
          {!historical && (
            <Button
              size="sm"
              variant="outline"
              disabled={researchMutation.isPending || !locationReady}
              onClick={() => researchMutation.mutate()}
            >
              {t("rerun")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function MarketEvidenceBody({ research }: { research: MarketResearchAnalysis }) {
  const t = useTranslations("MarketEvidence");
  const format = useFormatter();
  const scopes = marketScopes(research);
  const [selected, setSelected] = useState(0);
  const current = scopes[Math.min(selected, scopes.length - 1)];

  const money: Money = (value, currency, compact = true) =>
    format.number(value, {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 0,
    });
  const scopeName = (scope: MarketScopeResult) =>
    scope.scope === "legacy" ? t("scopes.legacy") : `${t(`scopes.${scope.scope}`)} · ${scope.area_name}`;

  return (
    <>
      <p className="text-sm leading-relaxed">{research.summary}</p>

      {research.location && (
        <p className="text-xs">
          {t("locationUsed", { country: research.location.country, city: research.location.metro_city })}
        </p>
      )}

      {(research.consistency_warnings ?? []).map((warning) => (
        <p key={warning} role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {t(`warnings.${warning}`)}
        </p>
      ))}

      {/* TAM / SAM / SOM across the three geographies */}
      {scopes.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">{t("marketSizeTitle")}</h4>
          <div className="overflow-x-auto rounded-md border bg-white">
            <table className="w-full text-left text-sm" data-testid="market-size-table">
              <thead className="bg-slate-50 text-xs">
                <tr>
                  <th className="p-2">{t("columns.market")}</th>
                  {(["tam", "sam", "som"] as const).map((key) => (
                    <th key={key} className="p-2 text-right" title={t(`${key}.definition`)}>
                      {t(`${key}.label`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scopes.map((scope) => (
                  <tr key={scope.scope} className="border-t" data-testid={`market-row-${scope.scope}`}>
                    <th scope="row" className="p-2 font-medium">
                      {scopeName(scope)}
                    </th>
                    {(["tam", "sam", "som"] as const).map((key) => (
                      <td key={key} className="p-2 text-right font-semibold tabular-nums">
                        {money(scope.market_sizes[key], scope.market_sizes.currency)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="text-muted-foreground mt-2 grid gap-1 text-xs sm:grid-cols-3">
            {(["tam", "sam", "som"] as const).map((key) => (
              <div key={key}>
                <dt className="inline font-semibold">{t(`${key}.label`)}: </dt>
                <dd className="inline">{t(`${key}.definition`)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Details per geography */}
      {current && (
        <div className="rounded-md border bg-white">
          {scopes.length > 1 && (
            <div role="tablist" aria-label={t("detailsLabel")} className="flex flex-wrap gap-1 border-b px-2 pt-2">
              {scopes.map((scope, index) => (
                <button
                  key={scope.scope}
                  role="tab"
                  aria-selected={index === selected}
                  onClick={() => setSelected(index)}
                  className={
                    "-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium " +
                    (index === selected
                      ? "border-blue-700 text-blue-800"
                      : "text-muted-foreground hover:text-foreground border-transparent")
                  }
                >
                  {scopeName(scope)}
                </button>
              ))}
            </div>
          )}
          <div role="tabpanel" className="flex flex-col gap-4 p-3">
            <ScopeDetails scope={current} money={money} />
          </div>
        </div>
      )}

      {/* Business case: vendors */}
      <div>
        <h4 className="mb-2 text-sm font-semibold">{t("vendorsTitle")}</h4>
        {research.vendors.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noneFound")}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {research.vendors.map((v) => (
              <li key={v.name} className="rounded-md border bg-white p-3 text-sm">
                <p className="font-medium">{v.name}</p>
                <p className="text-muted-foreground text-xs">{v.description}</p>
                <p className="mt-1 text-xs">
                  <span className="font-semibold">{t("businessModel")}:</span> {v.business_model}
                </p>
                <p className="text-xs">
                  <span className="font-semibold">{t("traction")}:</span> {v.traction}
                  {v.evidence_url && (
                    <>
                      {" "}
                      <a href={v.evidence_url} {...EXTERNAL_LINK} className="text-blue-700 hover:underline">
                        {t("evidence")} ↗
                      </a>
                    </>
                  )}
                </p>
                <p className="mt-1 text-xs">
                  <a
                    href={v.url ?? v.search_url}
                    {...EXTERNAL_LINK}
                    aria-label={v.url ? t("visitWebsiteOf", { name: v.name }) : t("searchWebFor", { name: v.name })}
                    className="text-blue-700 hover:underline"
                  >
                    {v.url ? t("visitWebsite") : t("searchWeb")} ↗
                  </a>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <ListSection title={t("assumptionsTitle")} items={research.assumptions} />
        <ListSection title={t("gapsTitle")} items={research.data_gaps} />
        <ListSection title={t("nextStepsTitle")} items={research.suggested_next_steps} />
      </div>
    </>
  );
}

/** Formulas, inputs, demographics and published figures for one geography. */
function ScopeDetails({ scope, money }: { scope: MarketScopeResult; money: Money }) {
  const t = useTranslations("MarketEvidence");
  const format = useFormatter();
  const { currency, tam, sam, som } = scope.market_sizes;
  const { total_customers, annual_revenue_per_customer, serviceable_share, obtainable_share } = scope.inputs;
  const count = (value: number) => format.number(value, { maximumFractionDigits: 0 });
  const percent = (share: number) => format.number(share, { style: "percent", maximumFractionDigits: 1 });
  const full = (value: number) => money(value, currency, false);

  return (
    <>
      <MarketPieChart scope={scope} />
      <div>
        <h5 className="mb-2 text-sm font-semibold">{t("calculationTitle")}</h5>
        <ul className="space-y-1 font-mono text-xs" data-testid={`market-formulas-${scope.scope}`}>
          <li>
            TAM = {count(total_customers.value)} {total_customers.unit} × {full(annual_revenue_per_customer.value)}{" "}
            {t("perYear")} = <strong>{full(tam)}</strong>
          </li>
          <li>
            SAM = {full(tam)} × {percent(serviceable_share.value)} = <strong>{full(sam)}</strong>
          </li>
          <li>
            SOM = {full(sam)} × {percent(obtainable_share.value)} = <strong>{full(som)}</strong>
          </li>
        </ul>
        <p className="text-muted-foreground mt-2 text-xs">{t("calculationNote")}</p>
        <ul className="mt-3 flex flex-col gap-2">
          <InputRow label={t("inputs.totalCustomers")} value={`${count(total_customers.value)} ${total_customers.unit}`} figure={total_customers} />
          <InputRow
            label={t("inputs.revenuePerCustomer")}
            value={`${full(annual_revenue_per_customer.value)} ${t("perYear")}`}
            figure={annual_revenue_per_customer}
          />
          <InputRow label={t("inputs.serviceableShare")} value={percent(serviceable_share.value)} figure={serviceable_share} />
          <InputRow label={t("inputs.obtainableShare")} value={percent(obtainable_share.value)} figure={obtainable_share} />
        </ul>
      </div>

      <div>
        <h5 className="mb-1 text-sm font-semibold">{t("demographicsTitle")}</h5>
        <p className="text-muted-foreground mb-2 text-xs">{t("demographicsDescription")}</p>
        {scope.demographics.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noneFound")}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-xs" data-testid={`demographics-${scope.scope}`}>
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-2">{t("columns.segment")}</th>
                  <th className="p-2">{t("columns.geography")}</th>
                  <th className="p-2 text-right">{t("columns.size")}</th>
                  <th className="p-2">{t("columns.year")}</th>
                  <th className="p-2">{t("columns.source")}</th>
                </tr>
              </thead>
              <tbody>
                {scope.demographics.map((d) => (
                  <tr key={`${d.segment}-${d.geography}`} className="border-t align-top">
                    <td className="p-2">
                      <span className="font-medium">{d.segment}</span>
                      <span className="text-muted-foreground block">{d.description}</span>
                    </td>
                    <td className="p-2">{d.geography}</td>
                    <td className="p-2 text-right tabular-nums">
                      {count(d.count)} {t(`units.${d.unit}`)}
                    </td>
                    <td className="p-2">{d.year ?? "—"}</td>
                    <td className="p-2">
                      <SourceLink source={d} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h5 className="mb-2 text-sm font-semibold">{t("publishedTitle")}</h5>
        {scope.published_market_sizes.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noPublished")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {scope.published_market_sizes.map((p) => {
              const comparable = p.currency.toUpperCase() === currency && p.value > 0;
              return (
                <li key={`${p.label}-${p.publisher}`} className="rounded-md border p-3 text-xs">
                  <p className="text-sm">
                    <span className="font-medium">{p.label}</span>:{" "}
                    <strong className="tabular-nums">{money(p.value, p.currency)}</strong>{" "}
                    <span className="text-muted-foreground">
                      ({p.scope}
                      {p.year ? `, ${p.year}` : ""})
                    </span>
                  </p>
                  <p className="mt-1">
                    {p.publisher} · <SourceLink source={p} />
                  </p>
                  {comparable && (
                    <p className="text-muted-foreground mt-1">
                      {t("crossCheck", { ratio: format.number(tam / p.value, { maximumFractionDigits: 2 }) })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

function InputRow({ label, value, figure }: { label: string; value: string; figure: SourcedFigure }) {
  const t = useTranslations("MarketEvidence");
  return (
    <li className="text-xs">
      <span className="font-semibold">{label}:</span> <span className="tabular-nums">{value}</span>
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
}

/** A figure's source: linked and marked confirmed when the search saw it. */
export function SourceLink({ source }: { source: Source }) {
  const t = useTranslations("MarketEvidence");
  if (!source.source_title && !source.source_url) {
    return <span className="text-muted-foreground">{t("noSource")}</span>;
  }
  if (source.source_verified && source.source_url) {
    return (
      <span>
        <a href={source.source_url} {...EXTERNAL_LINK} className="text-blue-700 hover:underline">
          {source.source_title || source.source_url}
        </a>{" "}
        <span className="rounded bg-green-100 px-1 py-0.5 text-[10px] text-green-800">{t("sourceConfirmed")}</span>
      </span>
    );
  }
  return (
    <span>
      {source.source_title}{" "}
      <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800">{t("sourceUnconfirmed")}</span>
      {source.search_url && (
        <>
          {" "}
          <a href={source.search_url} {...EXTERNAL_LINK} className="text-blue-700 hover:underline">
            {t("findSource")} ↗
          </a>
        </>
      )}
    </span>
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
