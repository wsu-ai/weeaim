import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../messages/en.json";
import ko from "../../messages/ko.json";
import type { FinancialAnalysisAnalysis, FinancialAnswers, FinancialInputs, Projection } from "@/lib/api";
import { renderWithProviders, stubApi } from "@/test/auth-helpers";
import { FinancialAnalysisPanel, inputProblems } from "./financial-analysis-panel";
import { yTicks } from "./projection-chart";

const F = messages.FinancialAnalysis;
const RESEARCH_PATH = "/api/ventures/v1/stages/financial_analysis/research";

const driver = (value: number, is_estimate = true) => ({ value, explanation: "", is_estimate });

const INPUTS: FinancialInputs = {
  currency: "USD",
  revenue_drivers: {
    monthly_price_per_customer: { value: 100, explanation: "Stage 10 price.", is_estimate: false },
    starting_customers: driver(0),
    new_customers_month_1: driver(10),
    monthly_growth_rate_new_customers: driver(0.1),
    monthly_churn_rate: driver(0.05),
    variable_cost_per_customer: driver(20),
    customer_acquisition_cost: driver(50),
  },
  fixed_costs: [
    { name: "Founder salary", category: "salaries", monthly_amount: 3000, start_month: 1, note: "" },
    { name: "Co-working desk", category: "rent", monthly_amount: 300, start_month: 1, note: "" },
  ],
  operating_costs: [
    { name: "Card fees", category: "payment_fees", monthly_amount: 0, percent_of_revenue: 0.03, start_month: 1, note: "" },
  ],
  one_time_costs: [{ name: "Incorporation", amount: 1000, month: 1, note: "" }],
  funding: { starting_cash: 20000, planned_raise_amount: 0, planned_raise_month: null },
  tax_rate: 0.1,
  discount_rate_annual: 0.12,
};

/** A 36-month projection where the cash runs out in month 9. */
function projection(overrides: Partial<Projection["metrics"]> = {}, warnings: Projection["warnings"] = []): Projection {
  const months = Array.from({ length: 36 }, (_, i) => ({
    month: i + 1,
    new_customers: 10,
    customers: 10 * (i + 1),
    revenue: 1000 * (i + 1),
    variable_costs: 200 * (i + 1),
    acquisition_costs: 500,
    fixed_costs: 3300,
    operating_costs: 30 * (i + 1),
    one_time_costs: i === 0 ? 1000 : 0,
    total_costs: 4000 + 230 * (i + 1),
    ebitda: 770 * (i + 1) - 4000,
    tax: 0,
    net_cash_flow: 770 * (i + 1) - 4000,
    cash_balance: 20000 - 2500 * (i + 1),
  }));
  return {
    months,
    yearly: [1, 2, 3].map((year) => ({
      year,
      revenue: 100000 * year,
      total_costs: 80000 * year,
      ebitda: 20000 * year,
      net_cash_flow: 18000 * year,
      closing_customers: 120.4 * year,
      closing_cash: 50000 * year,
    })),
    metrics: {
      currency: "USD",
      total_revenue: 666000,
      gross_margin: 0.8,
      burn_rate_average: 2500,
      burn_rate_peak: 4530,
      cash_out_month: 9,
      runway_months: 8,
      operating_break_even_month: 6,
      break_even_customers: 43,
      break_even_revenue: 4300,
      contribution_per_customer: 77,
      payback_month: 14,
      funding_needed: 70000,
      lowest_cash_month: 36,
      npv: 120000,
      irr_monthly: 0.05,
      irr_annual: 0.7959,
      closing_cash: -70000,
      ...overrides,
    },
    warnings,
  };
}

const DRAFT: FinancialAnalysisAnalysis = {
  kind: "financial_analysis",
  summary: "A lean first year funded by savings.",
  assumption_notes: ["Salaries assume one founder."],
  inputs: INPUTS,
  confidence: 0.5,
  sources: [],
  researched_at: "2026-10-13T09:00:00Z",
  based_on: null,
  language: "en",
};

const ANSWERS: FinancialAnswers = {
  financial_inputs: INPUTS,
  inputs_source: "ai_draft",
  projection: projection({}, ["runway_before_break_even"]),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel(
  analysis: FinancialAnalysisAnalysis | null,
  {
    answers = ANSWERS,
    locale = "en" as "en" | "ko",
    historical = false,
    onSaveInputs = vi.fn(async (inputs: FinancialInputs) => {
      void inputs;
    }),
  } = {},
) {
  renderWithProviders(
    <FinancialAnalysisPanel
      ventureId="v1"
      analysis={analysis}
      language={locale}
      answers={answers}
      onSaveInputs={onSaveInputs}
      onResearched={vi.fn()}
      historical={historical}
    />,
    locale,
  );
  return onSaveInputs;
}

describe("FinancialAnalysisPanel", () => {
  it("shows the server-calculated KPIs", () => {
    stubApi({});
    renderPanel(DRAFT);

    expect(screen.getByTestId("kpi-runway")).toHaveTextContent("8 months");
    expect(screen.getByTestId("kpi-runway")).toHaveTextContent("Cash runs out in month 9");
    expect(screen.getByTestId("kpi-burn")).toHaveTextContent("$2,500");
    expect(screen.getByTestId("kpi-burn")).toHaveTextContent("Peak burn $4,530/month");
    expect(screen.getByTestId("kpi-break-even")).toHaveTextContent("Month 6");
    expect(screen.getByTestId("kpi-break-even-customers")).toHaveTextContent("43");
    expect(screen.getByTestId("kpi-break-even-customers")).toHaveTextContent("$4,300/month in revenue");
    expect(screen.getByTestId("kpi-payback")).toHaveTextContent("Month 14");
    expect(screen.getByTestId("kpi-funding")).toHaveTextContent("$70,000");
    expect(screen.getByTestId("kpi-irr")).toHaveTextContent("79.6%");
    expect(screen.getByTestId("kpi-irr")).toHaveTextContent(F.kpis.irrNote);
    expect(screen.getByTestId("kpi-npv")).toHaveTextContent("At 12% a year");
    expect(screen.getByTestId("kpi-gross-margin")).toHaveTextContent("80%");
    expect(screen.getByTestId("inputs-source")).toHaveTextContent(F.sourceAi);
  });

  it("explains missing results and warnings in words", () => {
    stubApi({});
    renderPanel(DRAFT, {
      answers: {
        ...ANSWERS,
        projection: projection(
          { runway_months: null, cash_out_month: null, irr_annual: null, operating_break_even_month: null, break_even_customers: null, break_even_revenue: null },
          ["negative_contribution", "zero_churn"],
        ),
      },
    });

    expect(screen.getByTestId("kpi-runway")).toHaveTextContent(F.beyondHorizon);
    expect(screen.getByTestId("kpi-irr")).toHaveTextContent(F.irrNone);
    expect(screen.getByTestId("kpi-break-even")).toHaveTextContent(F.never);
    expect(screen.getByTestId("kpi-break-even-customers")).toHaveTextContent(F.never);
    const warnings = screen.getByTestId("financial-warnings");
    expect(warnings).toHaveTextContent(F.warnings.negative_contribution);
    expect(warnings).toHaveTextContent(F.warnings.zero_churn);
  });

  it("charts cash and revenue vs costs, with a runway marker and accessible labels", () => {
    stubApi({});
    renderPanel(DRAFT);

    const cash = screen.getByRole("img", { name: /cash balance over 36 months, from \$17,500 to -\$70,000/ });
    expect(cash).toBeInTheDocument();
    expect(screen.getByTestId("chart-marker")).toHaveTextContent(F.runOutMarker);
    expect(screen.getByRole("img", { name: F.flowChartLabel })).toBeInTheDocument();
    const flow = screen.getByTestId("chart-revenue-costs");
    expect(within(flow).getByText(F.revenue)).toBeInTheDocument(); // legend
    expect(within(flow).getByText(F.totalCosts)).toBeInTheDocument();
  });

  it("shows every series at a month with the keyboard crosshair", () => {
    stubApi({});
    renderPanel(DRAFT);

    const flow = screen.getByRole("img", { name: F.flowChartLabel });
    fireEvent.keyDown(flow, { key: "ArrowRight" });
    fireEvent.keyDown(flow, { key: "ArrowRight" });
    const tooltip = screen.getByTestId("chart-tooltip");
    expect(tooltip).toHaveTextContent("Month 2");
    expect(tooltip).toHaveTextContent("Revenue: $2,000");
    expect(tooltip).toHaveTextContent("Total costs: $4,460");
  });

  it("shows yearly and monthly tables", () => {
    stubApi({});
    renderPanel(DRAFT);

    const yearly = screen.getByTestId("yearly-table");
    expect(within(yearly).getAllByRole("row")).toHaveLength(4);
    expect(yearly).toHaveTextContent("Year 2");
    expect(yearly).toHaveTextContent("$200,000");
    expect(within(screen.getByTestId("monthly-table")).getAllByRole("row")).toHaveLength(37);
  });

  it("edits expenses and saves the inputs for the server to recalculate", async () => {
    stubApi({});
    const onSaveInputs = renderPanel(DRAFT);

    const save = screen.getByRole("button", { name: F.save });
    expect(save).toBeDisabled();
    const fixed = screen.getByTestId("fixed-costs");
    fireEvent.change(within(fixed).getByLabelText(`${F.columns.monthlyAmount} 1`), { target: { value: "4500" } });
    fireEvent.click(within(fixed).getByRole("button", { name: F.addRow }));
    fireEvent.change(within(fixed).getByLabelText(`${F.columns.name} 3`), { target: { value: "Insurance" } });
    fireEvent.change(within(fixed).getByLabelText(`${F.columns.category} 3`), { target: { value: "insurance" } });
    fireEvent.change(within(fixed).getByLabelText(`${F.columns.monthlyAmount} 3`), { target: { value: "120" } });
    fireEvent.click(within(screen.getByTestId("one-time-costs")).getByRole("button", { name: "Remove Incorporation" }));
    fireEvent.change(screen.getByLabelText(F.drivers.monthly_churn_rate), { target: { value: "8" } });
    fireEvent.click(save);

    await waitFor(() => expect(onSaveInputs).toHaveBeenCalledTimes(1));
    const saved = onSaveInputs.mock.calls[0][0];
    expect(saved.fixed_costs[0].monthly_amount).toBe(4500);
    expect(saved.fixed_costs[2]).toEqual({ name: "Insurance", category: "insurance", monthly_amount: 120, start_month: 1, note: "" });
    expect(saved.one_time_costs).toEqual([]);
    expect(saved.revenue_drivers.monthly_churn_rate.value).toBe(0.08);
  });

  it("blocks invalid inputs and resets to the AI draft", async () => {
    stubApi({});
    const onSaveInputs = renderPanel(DRAFT, {
      answers: { ...ANSWERS, inputs_source: "founder", financial_inputs: { ...INPUTS, tax_rate: 0.3 } },
    });

    expect(screen.getByTestId("inputs-source")).toHaveTextContent(F.sourceFounder);
    fireEvent.change(screen.getByLabelText(F.taxRate), { target: { value: "150" } });
    expect(screen.getByText(F.invalid)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: F.save })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: F.reset }));
    await waitFor(() => expect(onSaveInputs).toHaveBeenCalledWith(INPUTS));
  });

  it("validates inputs the way the server does", () => {
    expect(inputProblems(INPUTS)).toBe(false);
    expect(inputProblems({ ...INPUTS, tax_rate: 1.2 })).toBe(true);
    expect(inputProblems({ ...INPUTS, one_time_costs: [{ name: "x", amount: 1, month: 37, note: "" }] })).toBe(true);
    expect(inputProblems({ ...INPUTS, funding: { ...INPUTS.funding, starting_cash: -1 } })).toBe(true);
  });

  it("drafts automatically, retries, and refreshes", async () => {
    let calls = 0;
    stubApi({
      [RESEARCH_PATH]: () => {
        calls += 1;
        return calls === 1 ? { status: 503, body: null } : { body: { ...DRAFT, summary: `Draft ${calls}` } };
      },
    });
    renderPanel(null, { answers: {} });

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Login.errorUnavailable);
    fireEvent.click(screen.getByRole("button", { name: F.retry }));
    expect(await screen.findByText("Draft 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: F.refresh }));
    expect(await screen.findByText("Draft 3")).toBeInTheDocument();
  });

  it("is read-only for an earlier draft", () => {
    stubApi({});
    renderPanel(DRAFT, { historical: true });

    expect(screen.queryByTestId("kpi-runway")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: F.save })).not.toBeInTheDocument();
    expect(screen.getByLabelText(F.startingCash)).toBeDisabled();
  });

  it("renders in Korean", () => {
    stubApi({});
    renderPanel({ ...DRAFT, language: "ko" }, { locale: "ko" });

    expect(screen.getByText(ko.FinancialAnalysis.title)).toBeInTheDocument();
    expect(screen.getByTestId("kpi-runway")).toHaveTextContent("8개월");
    expect(screen.getByText(ko.FinancialAnalysis.fixedCostsTitle)).toBeInTheDocument();
  });

  it("makes clean axis ticks that include zero and cover the data", () => {
    expect(yTicks(-70000, 20000)).toEqual([-75000, -50000, -25000, 0, 25000]);
    expect(yTicks(0, 950)).toEqual([0, 250, 500, 750, 1000]);
    expect(yTicks(120, 4800)).toEqual([0, 2000, 4000, 6000]);
    expect(yTicks(0, 0)).toEqual([0, 0.25]);
  });
});
