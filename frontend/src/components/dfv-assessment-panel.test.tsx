import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../messages/en.json";
import ko from "../../messages/ko.json";
import type { DfvActionItem, DfvAssessmentAnalysis, DfvCriterion, DfvRating } from "@/lib/api";
import { renderWithProviders, stubApi } from "@/test/auth-helpers";
import { DfvAssessmentPanel } from "./dfv-assessment-panel";

const D = messages.DfvAssessment;
const A = messages.ActionChecklist;
const RESEARCH_PATH = "/api/ventures/v1/stages/dfv_assessment/research";

function criterion(name: string, rating: DfvRating, gap: string | null = null): DfvCriterion {
  return {
    criterion: name,
    rating,
    reason: `Reason for ${name}.`,
    evidence: `Evidence for ${name}.`,
    evidence_stage: rating === "weak" ? "none" : "market_evidence",
    evidence_gap: gap,
  };
}

function action(id: string, title: string, extra: Partial<DfvActionItem>): DfvActionItem {
  return {
    id,
    title,
    why: `Why ${title}`,
    steps: ["Step one"],
    priority: "high",
    timeframe: "this_week",
    success_metric: `Metric for ${title}`,
    dimension: "desirability",
    criterion: "willingness_to_pay",
    ...extra,
  };
}

const ASSESSMENT: DfvAssessmentAnalysis = {
  kind: "dfv_assessment",
  summary: "Customers want it; the economics are unproven.",
  scores: { desirability: 70, feasibility: 80, viability: 35, overall: 62 },
  verdict: "rethink",
  dimensions: {
    desirability: [
      criterion("problem_severity", "strong"),
      criterion("demand_evidence", "moderate", "No pre-orders yet."),
      criterion("willingness_to_pay", "weak", "No pricing test."),
      criterion("differentiation_appeal", "strong"),
    ],
    feasibility: [
      criterion("technical_complexity", "strong"),
      criterion("resources_and_team", "moderate"),
      criterion("regulatory_barriers", "strong"),
      criterion("time_to_market", "moderate"),
    ],
    viability: [
      criterion("market_size", "moderate"),
      criterion("revenue_model", "weak"),
      criterion("unit_economics", "weak", "No cost data."),
      criterion("defensibility", "weak"),
    ],
  },
  assumptions_to_test: ["Families will pay $10 a month."],
  action_items: [
    action("a-price", "Run a pricing test", {}),
    action("a-cost", "Estimate cost to serve", { dimension: "viability", criterion: "unit_economics", timeframe: "this_month" }),
    action("a-team", "Find a technical co-founder", {
      dimension: "feasibility",
      criterion: "resources_and_team",
      priority: "medium",
      timeframe: "this_quarter",
    }),
  ],
  confidence: 0.5,
  sources: [],
  researched_at: "2026-10-12T09:00:00Z",
  based_on: "2026-10-12T08:30:00Z",
  language: "en",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel(
  analysis: DfvAssessmentAnalysis | null,
  { completed = [] as string[], onToggle = vi.fn(), locale = "en" as "en" | "ko", historical = false } = {},
) {
  renderWithProviders(
    <DfvAssessmentPanel
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

describe("DfvAssessmentPanel", () => {
  it("makes Desirability, Feasibility and Viability collapsible sections showing their score", () => {
    stubApi({});
    renderPanel(ASSESSMENT);
    for (const dimension of ["desirability", "feasibility", "viability"] as const) {
      const section = screen.getByTestId(`dfv-section-${dimension}`) as HTMLDetailsElement;
      expect(section.tagName).toBe("DETAILS");
      expect(section.open).toBe(false);
      expect(section.querySelector("summary")).toHaveTextContent(D.dimensions[dimension]);
      expect(section.querySelector("summary")).toHaveTextContent(`${ASSESSMENT.scores[dimension]}%`);
      expect(within(section).getByTestId(`dfv-criteria-${dimension}`)).toBeInTheDocument();
    }
    const viability = screen.getByTestId("dfv-section-viability") as HTMLDetailsElement;
    fireEvent.click(viability.querySelector("summary")!);
    expect(viability.open).toBe(true);
    // The action items for each area collapse the same way.
    expect((screen.getByTestId("actions-viability") as HTMLDetailsElement).tagName).toBe("DETAILS");
  });

  it("outlines any area below 40% in bold red, with a label", () => {
    stubApi({});
    // Viability is 35%; desirability exactly 40% is not below the line.
    renderPanel({ ...ASSESSMENT, scores: { ...ASSESSMENT.scores, desirability: 40 } });

    const viability = screen.getByTestId("dfv-score-viability");
    expect(viability).toHaveClass("border-2", "border-red-600");
    expect(viability).toHaveTextContent(D.lowScore);
    expect(screen.getByTestId("dfv-section-viability")).toHaveClass("border-2", "border-red-600");

    for (const ok of ["desirability", "feasibility", "overall"]) {
      expect(screen.getByTestId(`dfv-score-${ok}`)).not.toHaveClass("border-red-600");
      expect(screen.getByTestId(`dfv-score-${ok}`)).not.toHaveTextContent(D.lowScore);
    }
    expect(screen.getByTestId("dfv-section-desirability")).not.toHaveClass("border-red-600");
  });

  it("shows the verdict and the server-calculated scores", () => {
    stubApi({});
    renderPanel(ASSESSMENT);

    const verdict = screen.getByTestId("dfv-verdict");
    expect(verdict).toHaveTextContent(D.verdicts.rethink.title);
    expect(verdict).toHaveTextContent(D.verdicts.rethink.description);
    expect(screen.getByTestId("dfv-score-desirability")).toHaveTextContent("Desirability70%");
    expect(screen.getByTestId("dfv-score-viability")).toHaveTextContent("35%");
    expect(screen.getByTestId("dfv-score-overall")).toHaveTextContent(`${D.overall}62%`);
    expect(screen.getByRole("progressbar", { name: "Feasibility score" })).toHaveAttribute("aria-valuenow", "80");
  });

  it("lists every criterion with its rating, evidence and what's missing", () => {
    stubApi({});
    renderPanel(ASSESSMENT);

    const rows = within(screen.getByTestId("dfv-criteria-viability")).getAllByRole("row");
    expect(rows).toHaveLength(5); // header + 4 criteria
    const unit = screen.getByTestId("dfv-criterion-unit_economics");
    expect(unit).toHaveTextContent(D.criteria.unit_economics);
    expect(unit).toHaveTextContent(D.ratings.weak);
    expect(unit).toHaveTextContent(D.evidenceStages.none);
    expect(unit).toHaveTextContent(`${D.missing} No cost data.`);
    expect(screen.getByTestId("dfv-criterion-market_size")).toHaveTextContent(D.evidenceStages.market_evidence);
    expect(screen.getByText("Families will pay $10 a month.")).toBeInTheDocument();
  });

  it("groups action items by area, with the criterion each one strengthens", () => {
    stubApi({});
    const onToggle = renderPanel(ASSESSMENT, { completed: ["a-cost"] });

    expect(screen.getByTestId("actions-desirability")).toHaveTextContent("Run a pricing test");
    const viability = screen.getByTestId("actions-viability");
    expect(viability).toHaveTextContent("Estimate cost to serve");
    expect(viability).toHaveTextContent("Strengthens: Unit economics");
    expect(viability).toHaveTextContent(A.timeframes.this_month);
    expect(screen.getByTestId("actions-progress")).toHaveTextContent("1 of 3 done");

    fireEvent.click(screen.getByRole("checkbox", { name: "Run a pricing test" }));
    expect(onToggle).toHaveBeenCalledWith("a-price", true);
  });

  it("doesn't let an earlier assessment be ticked or refreshed", () => {
    stubApi({});
    renderPanel(ASSESSMENT, { historical: true });

    expect(screen.getByRole("checkbox", { name: "Run a pricing test" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: D.refresh })).not.toBeInTheDocument();
  });

  it("assesses automatically, retries, and refreshes", async () => {
    let calls = 0;
    const refreshed = { ...ASSESSMENT, summary: "Refreshed assessment.", verdict: "proceed" as const };
    stubApi({
      [RESEARCH_PATH]: () => {
        calls += 1;
        return calls === 1 ? { status: 503, body: null } : { body: calls === 2 ? ASSESSMENT : refreshed };
      },
    });
    renderPanel(null);

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Login.errorUnavailable);
    fireEvent.click(screen.getByRole("button", { name: D.retry }));
    expect(await screen.findByText(ASSESSMENT.summary)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: D.refresh }));
    expect(await screen.findByText("Refreshed assessment.")).toBeInTheDocument();
    expect(screen.getByTestId("dfv-verdict")).toHaveTextContent(D.verdicts.proceed.title);
    expect(calls).toBe(3);
  });

  it("renders in Korean", () => {
    stubApi({});
    renderPanel({ ...ASSESSMENT, language: "ko" }, { locale: "ko" });

    expect(screen.getByTestId("dfv-verdict")).toHaveTextContent(ko.DfvAssessment.verdicts.rethink.title);
    expect(screen.getByTestId("dfv-criterion-unit_economics")).toHaveTextContent(ko.DfvAssessment.criteria.unit_economics);
    expect(screen.getByText(ko.ActionChecklist.title)).toBeInTheDocument();
  });
});
