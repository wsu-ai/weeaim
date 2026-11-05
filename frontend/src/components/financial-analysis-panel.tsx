"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { ProjectionChart } from "@/components/projection-chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  isFinancialAnalysis,
  researchStage,
  type FinancialAnalysisAnalysis,
  type FinancialAnswers,
  type FinancialInputs,
  type FixedCost,
  type FixedCostCategory,
  type OneTimeCost,
  type OperatingCost,
  type OperatingCostCategory,
  type Projection,
  type RevenueDriverName,
} from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";

const DRIVERS: RevenueDriverName[] = [
  "monthly_price_per_customer",
  "starting_customers",
  "new_customers_month_1",
  "monthly_growth_rate_new_customers",
  "monthly_churn_rate",
  "variable_cost_per_customer",
  "customer_acquisition_cost",
];
const RATE_DRIVERS = new Set<RevenueDriverName>(["monthly_growth_rate_new_customers", "monthly_churn_rate"]);
const FIXED_CATEGORIES: FixedCostCategory[] = ["salaries", "rent", "software", "insurance", "legal_accounting", "utilities", "other"];
const OPERATING_CATEGORIES: OperatingCostCategory[] = ["marketing", "ai_infrastructure", "payment_fees", "travel", "support", "other"];
const HORIZON = 36;

/** Money in the projection's currency; a non-ISO code falls back to "1,234 CODE". */
function useMoney(currency: string) {
  const format = useFormatter();
  return (value: number, compact = false) => {
    const options = compact
      ? ({ notation: "compact", maximumFractionDigits: 1 } as const)
      : ({ maximumFractionDigits: 0 } as const);
    try {
      return format.number(value, { style: "currency", currency, ...options });
    } catch {
      return `${format.number(value, options)} ${currency}`;
    }
  };
}

/** Problems that would make the server reject the inputs. */
export function inputProblems(inputs: FinancialInputs): boolean {
  const amounts = [
    ...DRIVERS.map((name) => inputs.revenue_drivers[name].value),
    ...inputs.fixed_costs.map((c) => c.monthly_amount),
    ...inputs.operating_costs.map((c) => c.monthly_amount),
    ...inputs.one_time_costs.map((c) => c.amount),
    inputs.funding.starting_cash,
    inputs.funding.planned_raise_amount,
  ];
  const rates = [
    ...[...RATE_DRIVERS].map((name) => inputs.revenue_drivers[name].value),
    ...inputs.operating_costs.map((c) => c.percent_of_revenue),
    inputs.tax_rate,
    inputs.discount_rate_annual,
  ];
  const months = [
    ...inputs.fixed_costs.map((c) => c.start_month),
    ...inputs.operating_costs.map((c) => c.start_month),
    ...inputs.one_time_costs.map((c) => c.month),
    ...(inputs.funding.planned_raise_month === null ? [] : [inputs.funding.planned_raise_month]),
  ];
  return (
    amounts.some((v) => !Number.isFinite(v) || v < 0) ||
    rates.some((v) => !Number.isFinite(v) || v < 0 || v > 1) ||
    months.some((m) => !Number.isInteger(m) || m < 1 || m > HORIZON) ||
    !inputs.currency.trim()
  );
}

/**
 * Stage 12: a 36-month financial projection. The AI drafts the inputs
 * (operating costs, revenue drivers, funding); the founder edits them; every
 * figure shown is calculated by the server from the inputs, never by the AI.
 */
export function FinancialAnalysisPanel({
  ventureId,
  analysis,
  language,
  answers,
  onSaveInputs,
  onResearched,
  historical = false,
  onBackToLatest,
}: {
  ventureId: string;
  analysis: FinancialAnalysisAnalysis | null;
  language: "en" | "ko";
  /** The stage's saved answers: the inputs in use and the server's projection. */
  answers: FinancialAnswers;
  onSaveInputs: (inputs: FinancialInputs) => Promise<void>;
  onResearched: () => void;
  /** Showing an earlier saved draft instead of the latest. */
  historical?: boolean;
  onBackToLatest?: () => void;
}) {
  const t = useTranslations("FinancialAnalysis");
  const tLogin = useTranslations("Login");
  const format = useFormatter();
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  const researchMutation = useMutation({
    mutationFn: () => researchStage(ventureId, "financial_analysis", language),
    onSuccess: onResearched,
  });

  // Draft once, automatically, when there's nothing yet.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!analysis && !historical && !autoStarted.current) {
      autoStarted.current = true;
      researchMutation.mutate();
    }
  }, [analysis, historical, researchMutation]);

  const fresh = isFinancialAnalysis(researchMutation.data ?? null) ? researchMutation.data : null;
  const shown = historical ? analysis : (fresh ?? analysis);
  const inputs = historical ? (shown?.inputs ?? null) : (answers.financial_inputs ?? shown?.inputs ?? null);
  const projection = historical ? null : (answers.projection ?? null);

  return (
    <section aria-labelledby="financial-analysis-title" className="flex flex-col gap-4 rounded-lg border bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="financial-analysis-title" className="font-semibold">
          {t("title")}
        </h3>
        {!historical && (
          <Button size="sm" variant="outline" disabled={researchMutation.isPending} onClick={() => researchMutation.mutate()} title={t("refreshHint")}>
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

      {shown && <p className="text-sm leading-relaxed">{shown.summary}</p>}

      {!historical && inputs && (
        <p className="text-muted-foreground text-xs" data-testid="inputs-source">
          {answers.inputs_source === "founder" ? t("sourceFounder") : t("sourceAi")}
        </p>
      )}

      {projection && inputs && <ProjectionView projection={projection} inputs={inputs} />}

      {inputs && shown && (
        <InputsEditor
          // Re-mount when the saved inputs change, so a new draft shows at once.
          key={JSON.stringify(inputs)}
          saved={inputs}
          draft={shown.inputs}
          readOnly={historical}
          onSave={onSaveInputs}
        />
      )}

      {shown && shown.assumption_notes.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-semibold">{t("notesTitle")}</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {shown.assumption_notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {shown && (
        <p className="text-muted-foreground flex flex-col gap-0.5 border-t pt-3 text-xs">
          <span>{t("taxNote")}</span>
          {shown.based_on && <span>{t("basedOn", { date: when(shown.based_on) })}</span>}
          <span>{t("disclaimer", { date: when(shown.researched_at) })}</span>
        </p>
      )}
    </section>
  );
}

function ProjectionView({ projection, inputs }: { projection: Projection; inputs: FinancialInputs }) {
  const t = useTranslations("FinancialAnalysis");
  const format = useFormatter();
  const m = projection.metrics;
  const money = useMoney(m.currency);
  const percent = (value: number) => format.number(value, { style: "percent", maximumFractionDigits: 1 });
  const month = (value: number | null) => (value === null ? t("never") : t("monthN", { month: value }));

  const tiles: { key: string; label: string; value: string; detail?: string; alert?: boolean }[] = [
    {
      key: "runway",
      label: t("kpis.runway"),
      value: m.runway_months === null ? t("beyondHorizon") : t("runwayMonths", { months: m.runway_months }),
      detail: m.cash_out_month === null ? undefined : t("runwayOut", { month: m.cash_out_month }),
      alert: m.cash_out_month !== null,
    },
    {
      key: "burn",
      label: t("kpis.burn"),
      value: money(m.burn_rate_average),
      detail: t("kpis.burnPeak", { amount: money(m.burn_rate_peak) }),
    },
    { key: "break-even", label: t("kpis.breakEven"), value: month(m.operating_break_even_month) },
    {
      key: "break-even-customers",
      label: t("kpis.breakEvenCustomers"),
      value: m.break_even_customers === null ? t("never") : format.number(m.break_even_customers),
      detail: m.break_even_revenue === null ? undefined : t("kpis.breakEvenRevenue", { amount: money(m.break_even_revenue) }),
      alert: m.break_even_customers === null,
    },
    { key: "payback", label: t("kpis.payback"), value: month(m.payback_month) },
    {
      key: "funding",
      label: t("kpis.fundingNeeded"),
      value: money(m.funding_needed),
      detail: m.funding_needed > 0 ? t("kpis.fundingLow", { month: m.lowest_cash_month }) : undefined,
    },
    {
      key: "irr",
      label: t("kpis.irr"),
      value: m.irr_annual === null ? t("irrNone") : percent(m.irr_annual),
      detail: t("kpis.irrNote"),
    },
    {
      key: "npv",
      label: t("kpis.npv"),
      value: money(m.npv),
      detail: t("kpis.npvNote", { rate: percent(inputs.discount_rate_annual) }),
    },
    {
      key: "gross-margin",
      label: t("kpis.grossMargin"),
      value: m.gross_margin === null ? t("notApplicable") : percent(m.gross_margin),
    },
    { key: "closing-cash", label: t("kpis.closingCash"), value: money(m.closing_cash) },
  ];

  const cash = projection.months.map((row) => row.cash_balance);

  return (
    <>
      {projection.warnings.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="financial-warnings">
          {projection.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t(`warnings.${warning}`)}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <div
            key={tile.key}
            className={`rounded-md border bg-white p-3 ${tile.alert ? "border-red-300" : ""}`}
            data-testid={`kpi-${tile.key}`}
          >
            <p className="text-muted-foreground text-xs">{tile.label}</p>
            <p className="text-lg leading-tight font-bold tabular-nums">{tile.value}</p>
            {tile.detail && <p className="text-muted-foreground mt-0.5 text-[11px]">{tile.detail}</p>}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-4 rounded-md border bg-white p-3">
        <h4 className="text-sm font-semibold">{t("chartsTitle")}</h4>
        <div>
          <p className="mb-1 text-xs font-semibold">{t("cashChartTitle")}</p>
          <ProjectionChart
            series={[{ key: "cash", label: t("cash"), values: cash }]}
            label={t("cashChartLabel", { start: money(cash[0] ?? 0), end: money(cash[cash.length - 1] ?? 0) })}
            formatValue={(v) => money(v)}
            formatTick={(v) => money(v, true)}
            monthLabel={(n) => t("monthN", { month: n })}
            marker={m.cash_out_month === null ? undefined : { month: m.cash_out_month, label: t("runOutMarker") }}
          />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold">{t("flowChartTitle")}</p>
          <ProjectionChart
            series={[
              { key: "revenue", label: t("revenue"), values: projection.months.map((row) => row.revenue) },
              { key: "costs", label: t("totalCosts"), values: projection.months.map((row) => row.total_costs) },
            ]}
            label={t("flowChartLabel")}
            formatValue={(v) => money(v)}
            formatTick={(v) => money(v, true)}
            monthLabel={(n) => t("monthN", { month: n })}
          />
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">{t("yearlyTitle")}</h4>
        <div className="overflow-x-auto rounded-md border bg-white">
          <table className="w-full text-right text-xs tabular-nums" data-testid="yearly-table">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className="p-2 text-left font-semibold" />
                {(["revenue", "totalCosts", "ebitda", "netCash", "customers", "cash"] as const).map((col) => (
                  <th key={col} scope="col" className="p-2 font-semibold">
                    {t(`yearColumns.${col}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projection.yearly.map((row) => (
                <tr key={row.year} className="border-t">
                  <th scope="row" className="p-2 text-left font-medium">
                    {t("yearN", { year: row.year })}
                  </th>
                  <td className="p-2">{money(row.revenue)}</td>
                  <td className="p-2">{money(row.total_costs)}</td>
                  <td className="p-2">{money(row.ebitda)}</td>
                  <td className="p-2">{money(row.net_cash_flow)}</td>
                  <td className="p-2">{format.number(Math.round(row.closing_customers))}</td>
                  <td className="p-2">{money(row.closing_cash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <details className="rounded-md border bg-white">
        <summary className="cursor-pointer p-2 text-sm font-semibold">{t("monthlyTitle")}</summary>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-right text-xs tabular-nums" data-testid="monthly-table">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                {(["month", "customers", "revenue", "totalCosts", "ebitda", "net", "cash"] as const).map((col) => (
                  <th key={col} scope="col" className={`p-2 font-semibold ${col === "month" ? "text-left" : ""}`}>
                    {t(`monthColumns.${col}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projection.months.map((row) => (
                <tr key={row.month} className="border-t">
                  <th scope="row" className="p-2 text-left font-medium">
                    {row.month}
                  </th>
                  <td className="p-2">{format.number(Math.round(row.customers))}</td>
                  <td className="p-2">{money(row.revenue)}</td>
                  <td className="p-2">{money(row.total_costs)}</td>
                  <td className="p-2">{money(row.ebitda)}</td>
                  <td className="p-2">{money(row.net_cash_flow)}</td>
                  <td className={`p-2 ${row.cash_balance < 0 ? "font-semibold text-red-800" : ""}`}>{money(row.cash_balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

/** A number field; percent fields show 0-100 and store 0-1. */
function NumberField({
  id,
  label,
  value,
  onChange,
  percent = false,
  integer = false,
  disabled,
  className = "w-28",
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  percent?: boolean;
  integer?: boolean;
  disabled: boolean;
  className?: string;
}) {
  const shown = percent ? Math.round(value * 100 * 10000) / 10000 : value;
  return (
    <Input
      id={id}
      aria-label={label}
      type="number"
      inputMode="decimal"
      step={integer ? 1 : "any"}
      className={`h-8 ${className}`}
      value={Number.isFinite(shown) ? shown : ""}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value === "" ? 0 : Number(e.target.value);
        onChange(percent ? raw / 100 : raw);
      }}
    />
  );
}

function InputsEditor({
  saved,
  draft,
  readOnly,
  onSave,
}: {
  saved: FinancialInputs;
  draft: FinancialInputs;
  readOnly: boolean;
  onSave: (inputs: FinancialInputs) => Promise<void>;
}) {
  const t = useTranslations("FinancialAnalysis");
  const [edited, setEdited] = useState<FinancialInputs | null>(null);
  const inputs = edited ?? saved;
  const invalid = inputProblems(inputs);
  const saveMutation = useMutation({
    mutationFn: (value: FinancialInputs) => onSave(value),
    onSuccess: () => setEdited(null),
  });

  const update = (change: (copy: FinancialInputs) => void) => {
    const copy = structuredClone(inputs);
    change(copy);
    setEdited(copy);
  };
  const isDraft = JSON.stringify(saved) === JSON.stringify(draft);

  return (
    <form
      className="flex flex-col gap-4 rounded-md border bg-white p-3"
      aria-labelledby="financial-inputs-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) saveMutation.mutate(inputs);
      }}
    >
      <div>
        <h4 id="financial-inputs-title" className="text-sm font-semibold">
          {t("inputsTitle")}
        </h4>
        <p className="text-muted-foreground text-xs">{t("inputsNote")}</p>
      </div>

      <fieldset className="flex flex-col gap-2" data-testid="revenue-drivers">
        <legend className="mb-1 text-sm font-semibold">{t("driversTitle")}</legend>
        {DRIVERS.map((name) => {
          const driver = inputs.revenue_drivers[name];
          return (
            <div key={name} className="flex flex-wrap items-center gap-2 text-xs">
              <label htmlFor={`driver-${name}`} className="w-56 font-medium">
                {t(`drivers.${name}`)}
              </label>
              <NumberField
                id={`driver-${name}`}
                label={t(`drivers.${name}`)}
                value={driver.value}
                percent={RATE_DRIVERS.has(name)}
                disabled={readOnly}
                onChange={(value) =>
                  update((c) => {
                    c.revenue_drivers[name].value = value;
                  })
                }
              />
              {driver.is_estimate && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">{t("estimate")}</span>
              )}
              {driver.explanation && <span className="text-muted-foreground flex-1">{driver.explanation}</span>}
            </div>
          );
        })}
      </fieldset>

      <CostTable<FixedCost>
        title={t("fixedCostsTitle")}
        testId="fixed-costs"
        rows={inputs.fixed_costs}
        readOnly={readOnly}
        categories={FIXED_CATEGORIES.map((c) => ({ value: c, label: t(`fixedCategories.${c}`) }))}
        columns={[
          { key: "monthly_amount", label: t("columns.monthlyAmount") },
          { key: "start_month", label: t("columns.startMonth"), integer: true },
        ]}
        onChange={(rows) => update((c) => (c.fixed_costs = rows))}
        newRow={() => ({ name: t("newRow"), category: "other", monthly_amount: 0, start_month: 1, note: "" })}
      />
      <CostTable<OperatingCost>
        title={t("operatingCostsTitle")}
        testId="operating-costs"
        rows={inputs.operating_costs}
        readOnly={readOnly}
        categories={OPERATING_CATEGORIES.map((c) => ({ value: c, label: t(`operatingCategories.${c}`) }))}
        columns={[
          { key: "monthly_amount", label: t("columns.monthlyAmount") },
          { key: "percent_of_revenue", label: t("columns.percentOfRevenue"), percent: true },
          { key: "start_month", label: t("columns.startMonth"), integer: true },
        ]}
        onChange={(rows) => update((c) => (c.operating_costs = rows))}
        newRow={() => ({
          name: t("newRow"),
          category: "other",
          monthly_amount: 0,
          percent_of_revenue: 0,
          start_month: 1,
          note: "",
        })}
      />
      <CostTable<OneTimeCost>
        title={t("oneTimeCostsTitle")}
        testId="one-time-costs"
        rows={inputs.one_time_costs}
        readOnly={readOnly}
        columns={[
          { key: "amount", label: t("columns.amount") },
          { key: "month", label: t("columns.month"), integer: true },
        ]}
        onChange={(rows) => update((c) => (c.one_time_costs = rows))}
        newRow={() => ({ name: t("newRow"), amount: 0, month: 1, note: "" })}
      />

      <fieldset className="flex flex-wrap gap-4 text-xs" data-testid="funding">
        <legend className="mb-1 text-sm font-semibold">{t("fundingTitle")}</legend>
        <LabelledNumber id="starting-cash" label={t("startingCash")} value={inputs.funding.starting_cash} disabled={readOnly}
          onChange={(v) => update((c) => (c.funding.starting_cash = v))} />
        <LabelledNumber id="raise-amount" label={t("raiseAmount")} value={inputs.funding.planned_raise_amount} disabled={readOnly}
          onChange={(v) => update((c) => (c.funding.planned_raise_amount = v))} />
        <div className="flex flex-col gap-1">
          <label htmlFor="raise-month" className="font-medium">
            {t("raiseMonth")}
          </label>
          <Input
            id="raise-month"
            type="number"
            min={1}
            max={HORIZON}
            step={1}
            className="h-8 w-20"
            disabled={readOnly}
            value={inputs.funding.planned_raise_month ?? ""}
            onChange={(e) =>
              update((c) => (c.funding.planned_raise_month = e.target.value === "" ? null : Number(e.target.value)))
            }
          />
        </div>
        <LabelledNumber id="tax-rate" label={t("taxRate")} value={inputs.tax_rate} percent disabled={readOnly}
          onChange={(v) => update((c) => (c.tax_rate = v))} />
        <LabelledNumber id="discount-rate" label={t("discountRate")} value={inputs.discount_rate_annual} percent disabled={readOnly}
          onChange={(v) => update((c) => (c.discount_rate_annual = v))} />
        <div className="flex flex-col gap-1">
          <label htmlFor="currency" className="font-medium">
            {t("currency")}
          </label>
          <Input id="currency" className="h-8 w-20 uppercase" maxLength={3} disabled={readOnly} value={inputs.currency}
            onChange={(e) => update((c) => (c.currency = e.target.value.toUpperCase()))} />
        </div>
      </fieldset>

      {invalid && (
        <p role="alert" className="text-sm text-red-800">
          {t("invalid")}
        </p>
      )}
      {saveMutation.isError && (
        <p role="alert" className="text-sm text-red-800">
          {t("failed")}
        </p>
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={edited === null || invalid || saveMutation.isPending}>
            {saveMutation.isPending ? t("saving") : t("save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={(isDraft && edited === null) || saveMutation.isPending}
            onClick={() => saveMutation.mutate(draft)}
          >
            <RotateCcw aria-hidden className="size-4" />
            {t("reset")}
          </Button>
          {saveMutation.isSuccess && edited === null && (
            <span role="status" className="text-xs text-green-700">
              {t("saved")}
            </span>
          )}
        </div>
      )}
    </form>
  );
}

function LabelledNumber(props: {
  id: string;
  label: string;
  value: number;
  percent?: boolean;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={props.id} className="font-medium">
        {props.label}
      </label>
      <NumberField {...props} />
    </div>
  );
}

type CostRow = { name: string; note: string; category?: string } & Record<string, unknown>;

function CostTable<T extends CostRow>({
  title,
  testId,
  rows,
  columns,
  categories,
  readOnly,
  onChange,
  newRow,
}: {
  title: string;
  testId: string;
  rows: T[];
  columns: { key: keyof T & string; label: string; percent?: boolean; integer?: boolean }[];
  categories?: { value: string; label: string }[];
  readOnly: boolean;
  onChange: (rows: T[]) => void;
  newRow: () => T;
}) {
  const t = useTranslations("FinancialAnalysis");
  const set = (index: number, key: string, value: unknown) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  return (
    <fieldset data-testid={testId}>
      <legend className="mb-1 text-sm font-semibold">{title}</legend>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left">
              <th scope="col" className="p-1 font-semibold">{t("columns.name")}</th>
              {categories && <th scope="col" className="p-1 font-semibold">{t("columns.category")}</th>}
              {columns.map((col) => (
                <th key={col.key} scope="col" className="p-1 font-semibold">
                  {col.label}
                </th>
              ))}
              <th scope="col" className="p-1 font-semibold">{t("columns.note")}</th>
              <th scope="col" className="p-1">
                <span className="sr-only">{t("removeRow", { name: "" })}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t">
                <td className="p-1">
                  <Input aria-label={`${t("columns.name")} ${index + 1}`} className="h-8 min-w-36" value={row.name}
                    disabled={readOnly} onChange={(e) => set(index, "name", e.target.value)} />
                </td>
                {categories && (
                  <td className="p-1">
                    <select
                      aria-label={`${t("columns.category")} ${index + 1}`}
                      className="h-8 rounded-md border bg-white px-1"
                      value={row.category}
                      disabled={readOnly}
                      onChange={(e) => set(index, "category", e.target.value)}
                    >
                      {categories.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key} className="p-1">
                    <NumberField
                      id={`${testId}-${index}-${col.key}`}
                      label={`${col.label} ${index + 1}`}
                      value={Number(row[col.key] ?? 0)}
                      percent={col.percent}
                      integer={col.integer}
                      className={col.integer ? "w-16" : "w-28"}
                      disabled={readOnly}
                      onChange={(value) => set(index, col.key, value)}
                    />
                  </td>
                ))}
                <td className="p-1">
                  <Input aria-label={`${t("columns.note")} ${index + 1}`} className="h-8 min-w-32" value={row.note}
                    disabled={readOnly} onChange={(e) => set(index, "note", e.target.value)} />
                </td>
                <td className="p-1">
                  {!readOnly && (
                    <Button type="button" size="sm" variant="ghost" aria-label={t("removeRow", { name: row.name })}
                      onClick={() => onChange(rows.filter((_, i) => i !== index))}>
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && rows.length < 25 && (
        <Button type="button" size="sm" variant="outline" className="mt-1" onClick={() => onChange([...rows, newRow()])}>
          <Plus aria-hidden className="size-4" />
          {t("addRow")}
        </Button>
      )}
    </fieldset>
  );
}
