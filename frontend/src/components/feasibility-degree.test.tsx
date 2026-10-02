import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import messages from "../../messages/en.json";
import ko from "../../messages/ko.json";
import type { IdeaResearchAnalysis } from "@/lib/api";
import { renderWithProviders } from "@/test/auth-helpers";
import { FeasibilityDegree } from "./feasibility-degree";

const F = messages.Feasibility;

const BASE: IdeaResearchAnalysis = {
  kind: "idea_research",
  summary: "s",
  market_status: "some_similar_offerings",
  existing_solutions: [],
  feasibility: [],
  viability: [],
  differentiation_opportunities: [],
  key_risks: [],
  suggested_next_steps: [],
  confidence: 0.5,
  sources: [],
  researched_at: "2026-10-02T09:00:00Z",
  language: "en",
};

const SCORED: IdeaResearchAnalysis = {
  ...BASE,
  feasibility_score: 68,
  feasibility_factors: {
    technical_complexity: { rating: "favorable", reason: "Standard tools." },
    resources_required: { rating: "moderate", reason: "Small team." },
    regulatory_barriers: { rating: "favorable", reason: "Few rules." },
    time_to_market: { rating: "moderate", reason: "A few months." },
    customer_access: { rating: "challenging", reason: "Hard to reach." },
  },
};

describe("FeasibilityDegree", () => {
  it("shows the labelled percentage with a bar", () => {
    renderWithProviders(<FeasibilityDegree research={SCORED} />);

    expect(screen.getByText(F.label).closest("p")).toHaveTextContent("Degree of Feasibility: 68%");
    expect(screen.getByRole("progressbar", { name: F.label })).toHaveAttribute("aria-valuenow", "68");
  });

  it("explains how the percentage was calculated", () => {
    renderWithProviders(<FeasibilityDegree research={SCORED} />);

    expect(screen.getByText(F.howCalculated)).toBeInTheDocument();
    expect(screen.getByText(F.factors.customer_access)).toBeInTheDocument();
    expect(screen.getByText("Hard to reach.")).toBeInTheDocument();
    expect(screen.getByText(F.ratings.challenging)).toBeInTheDocument();
    expect(screen.getByText(F.method)).toBeInTheDocument();
  });

  it("asks for a re-run when older research has no percentage", () => {
    renderWithProviders(<FeasibilityDegree research={BASE} />);

    expect(screen.getByTestId("feasibility-score")).toHaveTextContent("—");
    expect(screen.getByText(F.rerunToCalculate)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("says it's pending before any research exists", () => {
    renderWithProviders(<FeasibilityDegree research={null} />);

    expect(screen.getByText(F.pending)).toBeInTheDocument();
  });

  it("renders in Korean", () => {
    renderWithProviders(<FeasibilityDegree research={SCORED} />, "ko");

    expect(screen.getByText(ko.Feasibility.label).closest("p")).toHaveTextContent("68%");
  });
});
