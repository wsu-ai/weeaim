import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../messages/en.json";
import ko from "../../messages/ko.json";
import type { ValidationExperiment, ValidationPlanAnalysis, ValidationResults } from "@/lib/api";
import { renderWithProviders, stubApi } from "@/test/auth-helpers";
import { ValidationPlanPanel } from "./validation-plan-panel";

const V = messages.ValidationPlan;
const RESEARCH_PATH = "/api/ventures/v1/stages/validation_plan/research";

function experiment(id: string, title: string, extra: Partial<ValidationExperiment> = {}): ValidationExperiment {
  return {
    id,
    title,
    assumption_tested: `Assumption for ${title}.`,
    method_type: "interviews",
    method: "Talk to landlords.",
    participants: "Daejeon landlords",
    sample_size: 10,
    metric: "landlords naming it a top-3 pain",
    unit: "landlords",
    comparator: "at_least",
    pass_threshold: 6,
    fail_threshold: 3,
    critical: true,
    phase: 1,
    duration_weeks: 2,
    cost_estimate: "Coffee money",
    owner: "Founder",
    ...extra,
  };
}

const PLAN: ValidationPlanAnalysis = {
  kind: "validation_plan",
  summary: "Test demand first, then delivery.",
  prerequisite_fixes: ["Align the Stage 5 answers with property management."],
  assumptions: [
    { assumption: "Maintenance is a top pain.", dimension: "desirability", risk: "high", source_stage: "dfv_assessment" },
    { assumption: "Tenants will use KakaoTalk.", dimension: "feasibility", risk: "medium", source_stage: "mvp" },
  ],
  experiments: [
    experiment("e-interviews", "Run 10 problem interviews"),
    experiment("e-pilot", "Cut manager minutes per request", {
      comparator: "at_most",
      pass_threshold: 10,
      fail_threshold: 20,
      unit: "minutes",
      metric: "manager minutes per request",
      phase: 2,
      duration_weeks: 4,
    }),
    experiment("e-lois", "Collect letters of intent", {
      fail_threshold: null,
      pass_threshold: 3,
      critical: false,
      phase: 2,
      unit: "letters",
      metric: "signed letters",
      sample_size: null,
    }),
  ],
  decision_rules: {
    proceed_if: "Interviews and the pilot pass.",
    narrow_or_pivot_if: "Interviews pass but letters fail.",
    stop_if: "Interviews fail.",
  },
  ethics_and_legal: ["Get consent under PIPA before using tenant data."],
  confidence: 0.5,
  sources: [],
  researched_at: "2026-10-13T09:00:00Z",
  based_on: null,
  language: "en",
};

const RESULTS: ValidationResults = {
  experiment_results: { "e-interviews": { value: 7, notes: "7 of 10" }, "e-pilot": { value: 15, notes: "" } },
  experiment_outcomes: { "e-interviews": "passed", "e-pilot": "inconclusive", "e-lois": "not_run" },
  decision_signal: "keep_testing",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel(
  analysis: ValidationPlanAnalysis | null,
  {
    results = RESULTS,
    locale = "en" as "en" | "ko",
    historical = false,
    onSaveResult = vi.fn(async (id: string, value: number | null, notes: string) => {
      void [id, value, notes];
    }),
  } = {},
) {
  renderWithProviders(
    <ValidationPlanPanel
      ventureId="v1"
      analysis={analysis}
      language={locale}
      results={results}
      onSaveResult={onSaveResult}
      onResearched={vi.fn()}
      historical={historical}
    />,
    locale,
  );
  return onSaveResult;
}

describe("ValidationPlanPanel", () => {
  it("shows the server's decision signal and outcome counts", () => {
    stubApi({});
    renderPanel(PLAN);

    const banner = screen.getByTestId("decision-signal");
    expect(banner).toHaveTextContent(V.signals.keep_testing.title);
    expect(banner).toHaveTextContent(V.signalNote);
    expect(screen.getByTestId("outcome-counts")).toHaveTextContent("1 passed · 0 failed · 1 inconclusive · 1 not run");
  });

  it("lists fixes, assumptions and experiments by phase", () => {
    stubApi({});
    renderPanel(PLAN);

    expect(screen.getByTestId("prerequisite-fixes")).toHaveTextContent("Align the Stage 5 answers");
    const assumptions = within(screen.getByTestId("assumptions")).getAllByRole("listitem");
    expect(assumptions[0]).toHaveTextContent(V.risk.high);
    expect(assumptions[1]).toHaveTextContent(V.dimensions.feasibility);
    expect(within(screen.getByTestId("phase-1")).getByText("Run 10 problem interviews")).toBeInTheDocument();
    expect(screen.getByTestId("phase-2")).toHaveTextContent(V.phases["2"]);
    expect(screen.getByTestId("decision-rules")).toHaveTextContent("Interviews fail.");
  });

  it("states each pass/fail bar in words", () => {
    stubApi({});
    renderPanel(PLAN);

    const interviews = screen.getByTestId("experiment-e-interviews");
    expect(interviews).toHaveTextContent(V.critical);
    expect(within(interviews).getByTestId("thresholds")).toHaveTextContent(
      "Pass if landlords naming it a top-3 pain is at least 6 landlordsFail if at most 3 landlords",
    );
    expect(within(interviews).getByTestId("outcome")).toHaveTextContent(V.outcomes.passed);
    expect(interviews).toHaveTextContent("Daejeon landlords (10)");

    const pilot = screen.getByTestId("experiment-e-pilot");
    expect(within(pilot).getByTestId("thresholds")).toHaveTextContent(
      "Pass if manager minutes per request is at most 10 minutesFail if at least 20 minutes",
    );
    expect(within(pilot).getByTestId("outcome")).toHaveTextContent(V.outcomes.inconclusive);
    expect(pilot).toHaveTextContent("4 weeks");

    const lois = screen.getByTestId("experiment-e-lois");
    expect(lois).toHaveTextContent(V.failOtherwise);
    expect(lois).not.toHaveTextContent(V.critical);
  });

  it("records a result and notes", async () => {
    stubApi({});
    const onSaveResult = renderPanel(PLAN);

    const lois = screen.getByTestId("experiment-e-lois");
    const save = within(lois).getByRole("button", { name: V.saveResult });
    expect(save).toBeDisabled(); // nothing changed yet
    fireEvent.change(within(lois).getByLabelText("Result (letters)"), { target: { value: "4" } });
    fireEvent.change(within(lois).getByLabelText(V.notesLabel), { target: { value: "Two cafes, two landlords" } });
    fireEvent.click(save);

    await waitFor(() => expect(onSaveResult).toHaveBeenCalledWith("e-lois", 4, "Two cafes, two landlords"));
  });

  it("shows saved results and rejects a non-number", () => {
    stubApi({});
    const onSaveResult = renderPanel(PLAN);

    const interviews = screen.getByTestId("experiment-e-interviews");
    const input = within(interviews).getByLabelText("Result (landlords)");
    expect(input).toHaveValue("7");
    fireEvent.change(input, { target: { value: "seven" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(within(interviews).getByRole("button", { name: V.saveResult })).toBeDisabled();
    expect(onSaveResult).not.toHaveBeenCalled();
  });

  it("is read-only for an earlier plan", () => {
    stubApi({});
    renderPanel(PLAN, { historical: true });

    expect(screen.queryByTestId("decision-signal")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: V.saveResult })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: V.refresh })).not.toBeInTheDocument();
  });

  it("plans automatically, retries, and refreshes", async () => {
    let calls = 0;
    stubApi({
      [RESEARCH_PATH]: () => {
        calls += 1;
        return calls === 1 ? { status: 503, body: null } : { body: { ...PLAN, summary: `Plan ${calls}` } };
      },
    });
    renderPanel(null, { results: {} });

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Login.errorUnavailable);
    fireEvent.click(screen.getByRole("button", { name: V.retry }));
    expect(await screen.findByText("Plan 2")).toBeInTheDocument();
    expect(screen.getByTestId("decision-signal")).toHaveTextContent(V.signals.not_started.title);

    fireEvent.click(screen.getByRole("button", { name: V.refresh }));
    expect(await screen.findByText("Plan 3")).toBeInTheDocument();
  });

  it("renders in Korean", () => {
    stubApi({});
    renderPanel({ ...PLAN, language: "ko" }, { locale: "ko" });

    expect(screen.getByText(ko.ValidationPlan.title)).toBeInTheDocument();
    expect(screen.getByTestId("decision-signal")).toHaveTextContent(ko.ValidationPlan.signals.keep_testing.title);
    expect(within(screen.getByTestId("experiment-e-pilot")).getByTestId("thresholds")).toHaveTextContent(
      "manager minutes per request 10 minutes 이하이면 통과",
    );
  });
});
