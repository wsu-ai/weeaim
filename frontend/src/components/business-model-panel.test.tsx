import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../messages/en.json";
import ko from "../../messages/ko.json";
import type { BusinessModelAnalysis, SourcedFigure, ThingToComplete } from "@/lib/api";
import { renderWithProviders, stubApi } from "@/test/auth-helpers";
import { BusinessModelPanel } from "./business-model-panel";

const B = messages.BusinessModel;
const ME = messages.MarketEvidence;
const RESEARCH_PATH = "/api/ventures/v1/stages/business_model/research";

function figure(value: number, extra: Partial<SourcedFigure> = {}): SourcedFigure {
  return {
    value,
    unit: "USD per month",
    explanation: `Explanation of ${value}.`,
    year: 2025,
    is_estimate: false,
    source_title: "SaaS benchmarks",
    source_url: "https://benchmarks.example.com/report",
    source_verified: true,
    search_url: null,
    ...extra,
  };
}

function thing(id: string, title: string, area: ThingToComplete["area"], extra: Partial<ThingToComplete> = {}): ThingToComplete {
  return {
    id,
    title,
    why: `Why ${title}`,
    steps: ["Step one"],
    priority: "high",
    timeframe: "this_week",
    success_metric: `Metric for ${title}`,
    area,
    ...extra,
  };
}

const MODEL: BusinessModelAnalysis = {
  kind: "business_model",
  summary: "A low-entry subscription that grows into coaching.",
  model_name: "Guided cooking subscription",
  model_type: "subscription",
  why_this_model: [
    { reason: "Weekly cooking habit suits recurring billing.", evidence_stage: "customer_definition" },
    { reason: "Low entry tier answers weak willingness to pay.", evidence_stage: "dfv_assessment" },
  ],
  alternatives_considered: [
    { name: "Meal-kit sales", why_not: "Heavy logistics.", when_it_would_fit: "With a delivery partner." },
  ],
  canvas: {
    customer_segments: ["Busy families"],
    value_propositions: ["Learn Korean cooking step by step"],
    channels: ["Instagram"],
    customer_relationships: ["Community challenges"],
    revenue_streams: ["Monthly subscription"],
    key_resources: ["Recipe library"],
    key_activities: ["Producing lessons"],
    key_partnerships: ["Korean grocers"],
    cost_structure: ["Content production"],
  },
  pricing: {
    strategy: "Low entry price, upgrade for coaching.",
    tiers: [
      { name: "Basic", price: "$10 / month", includes: ["Recipe lessons"], target_customer: "Beginners" },
      { name: "Coach", price: "$25 / month", includes: ["Live sessions"], target_customer: "Committed learners" },
    ],
  },
  unit_economics: {
    currency: "USD",
    inputs: {
      monthly_revenue_per_customer: figure(12, {
        is_estimate: true,
        source_title: null,
        source_url: null,
        source_verified: false,
      }),
      monthly_cost_to_serve: figure(3),
      customer_acquisition_cost: figure(60, {
        source_title: "Ad report",
        source_url: null,
        source_verified: false,
        search_url: "https://www.google.com/search?q=Ad+report",
      }),
      monthly_churn_rate: figure(0.05, { unit: "share per month" }),
    },
    metrics: {
      currency: "USD",
      monthly_contribution: 9,
      contribution_margin: 0.75,
      customer_lifetime_months: 20,
      lifetime_value: 180,
      ltv_to_cac: 3,
      cac_payback_months: 6.7,
    },
    health: { ltv_to_cac: "healthy", cac_payback_months: "healthy", contribution_margin: "healthy" },
  },
  launch_kpis: ["Paid conversion rate"],
  key_risks: ["Churn after the first month."],
  things_to_complete: [
    thing("t-price", "Validate the entry price", "finances"),
    thing("t-grocer", "Sign a grocer partner", "go_to_market", { priority: "medium", timeframe: "this_month" }),
    thing("t-churn", "Measure first-month churn", "validation", { timeframe: "this_quarter" }),
  ],
  confidence: 0.5,
  sources: [{ title: "SaaS benchmarks", url: "https://benchmarks.example.com/report" }],
  researched_at: "2026-10-12T09:00:00Z",
  based_on: "2026-10-12T08:30:00Z",
  language: "en",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel(
  analysis: BusinessModelAnalysis | null,
  { completed = [] as string[], onToggle = vi.fn(), locale = "en" as "en" | "ko", historical = false } = {},
) {
  renderWithProviders(
    <BusinessModelPanel
      ventureId="v1"
      analysis={analysis}
      language={locale}
      completedActions={completed}
      onToggleAction={onToggle}
      onResearched={vi.fn()}
      historical={historical}
    />,
    locale,
  );
  return onToggle;
}

describe("BusinessModelPanel", () => {
  it("presents the recommended model and why", () => {
    stubApi({});
    renderPanel(MODEL);

    const card = screen.getByTestId("recommended-model");
    expect(card).toHaveTextContent("Guided cooking subscription");
    expect(card).toHaveTextContent(B.modelTypes.subscription);
    expect(card).toHaveTextContent("Low entry tier answers weak willingness to pay.");
    expect(card).toHaveTextContent(B.evidenceStages.dfv_assessment);
  });

  it("fills all nine blocks of the Business Model Canvas", () => {
    stubApi({});
    renderPanel(MODEL);

    const canvas = screen.getByTestId("business-model-canvas");
    expect(within(canvas).getAllByRole("heading")).toHaveLength(9);
    expect(screen.getByTestId("canvas-key_partnerships")).toHaveTextContent(`${B.canvas.key_partnerships}Korean grocers`);
    expect(screen.getByTestId("canvas-revenue_streams")).toHaveTextContent("Monthly subscription");
    expect(screen.getByTestId("pricing-tiers")).toHaveTextContent("Coach$25 / month");
  });

  it("shows the server-calculated unit economics with health labels", () => {
    stubApi({});
    renderPanel(MODEL);

    expect(screen.getByTestId("metric-monthly_contribution")).toHaveTextContent("$9.00");
    expect(screen.getByTestId("metric-contribution_margin")).toHaveTextContent("75%");
    expect(screen.getByTestId("metric-contribution_margin")).toHaveTextContent(B.health.healthy);
    expect(screen.getByTestId("metric-customer_lifetime_months")).toHaveTextContent("20 months");
    expect(screen.getByTestId("metric-lifetime_value")).toHaveTextContent("$180.00");
    expect(screen.getByTestId("metric-ltv_to_cac")).toHaveTextContent("3×");
    expect(screen.getByTestId("metric-ltv_to_cac")).toHaveTextContent(B.healthTargets.ltv_to_cac);
    expect(screen.getByTestId("metric-cac_payback_months")).toHaveTextContent("6.7 months");
  });

  it("shows when customers never pay back, and unhealthy checks", () => {
    stubApi({});
    renderPanel({
      ...MODEL,
      unit_economics: {
        ...MODEL.unit_economics,
        metrics: { ...MODEL.unit_economics.metrics, monthly_contribution: -2, cac_payback_months: null, ltv_to_cac: 0 },
        health: { ltv_to_cac: "unhealthy", cac_payback_months: "unhealthy", contribution_margin: "watch" },
      },
    });

    const payback = screen.getByTestId("metric-cac_payback_months");
    expect(payback).toHaveTextContent(B.never);
    expect(payback).toHaveTextContent(B.health.unhealthy);
    expect(screen.getByTestId("metric-contribution_margin")).toHaveTextContent(B.health.watch);
  });

  it("marks each input as an estimate, confirmed or unconfirmed", () => {
    stubApi({});
    renderPanel(MODEL);

    expect(screen.getByTestId("input-monthly_revenue_per_customer")).toHaveTextContent(B.estimate);
    const cost = screen.getByTestId("input-monthly_cost_to_serve");
    expect(within(cost).getByRole("link", { name: "SaaS benchmarks" })).toHaveAttribute(
      "href",
      "https://benchmarks.example.com/report",
    );
    expect(cost).toHaveTextContent(ME.sourceConfirmed);
    const cac = screen.getByTestId("input-customer_acquisition_cost");
    expect(cac).toHaveTextContent(ME.sourceUnconfirmed);
    expect(within(cac).queryByRole("link", { name: "Ad report" })).not.toBeInTheDocument();
    expect(screen.getByTestId("input-monthly_churn_rate")).toHaveTextContent("5%");
  });

  it("lists things to complete by area and ticks them off", () => {
    stubApi({});
    const onToggle = renderPanel(MODEL, { completed: ["t-churn"] });

    expect(screen.getByText(B.thingsTitle)).toBeInTheDocument();
    expect(screen.getByTestId("actions-finances")).toHaveTextContent("Validate the entry price");
    expect(screen.getByTestId("actions-go_to_market")).toHaveTextContent(B.areas.go_to_market);
    expect(screen.getByTestId("actions-progress")).toHaveTextContent("1 of 3 done");
    expect(screen.queryByTestId("actions-operations")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Sign a grocer partner" }));
    expect(onToggle).toHaveBeenCalledWith("t-grocer", true);
    expect(screen.getByText("Meal-kit sales")).toBeInTheDocument();
  });

  it("designs automatically, retries, and refreshes", async () => {
    let calls = 0;
    const refreshed = { ...MODEL, model_name: "Coaching marketplace" };
    stubApi({
      [RESEARCH_PATH]: () => {
        calls += 1;
        return calls === 1 ? { status: 503, body: null } : { body: calls === 2 ? MODEL : refreshed };
      },
    });
    renderPanel(null);

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Login.errorUnavailable);
    fireEvent.click(screen.getByRole("button", { name: B.retry }));
    expect(await screen.findByText(MODEL.summary)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: B.refresh }));
    expect(await screen.findByText("Coaching marketplace")).toBeInTheDocument();
    expect(calls).toBe(3);
  });

  it("is read-only for an earlier model", () => {
    stubApi({});
    renderPanel(MODEL, { historical: true });

    expect(screen.getByRole("checkbox", { name: "Validate the entry price" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: B.refresh })).not.toBeInTheDocument();
  });

  it("renders in Korean", () => {
    stubApi({});
    renderPanel({ ...MODEL, language: "ko" }, { locale: "ko" });

    expect(screen.getByText(ko.BusinessModel.canvasTitle)).toBeInTheDocument();
    expect(screen.getByTestId("metric-cac_payback_months")).toHaveTextContent("6.7개월");
    expect(screen.getByText(ko.BusinessModel.thingsTitle)).toBeInTheDocument();
  });
});
