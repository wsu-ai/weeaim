import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../messages/en.json";
import ko from "../../messages/ko.json";
import type { ActionItem, CompetitivePositionAnalysis } from "@/lib/api";
import { renderWithProviders, stubApi } from "@/test/auth-helpers";
import { CompetitivePositionPanel } from "./competitive-position-panel";

const C = messages.CompetitivePosition;
const A = messages.ActionChecklist;
const RESEARCH_PATH = "/api/ventures/v1/stages/competitive_position/research";

function action(id: string, title: string, extra: Partial<ActionItem> = {}): ActionItem {
  return {
    id,
    title,
    why: `Why ${title}`,
    steps: [`First step of ${title}`, "Second step"],
    priority: "high",
    timeframe: "this_week",
    success_metric: `Metric for ${title}`,
    ...extra,
  };
}

const POSITION: CompetitivePositionAnalysis = {
  kind: "competitive_position",
  summary: "Own the beginner-cook niche that meal kits ignore.",
  positioning_statement:
    "For busy families who want home-cooked Korean food, Kimchi Coach is the guided cooking service that builds skills; unlike meal kits, it teaches.",
  target_segment: "Busy dual-income families",
  market_category: "Guided home cooking",
  competitor_comparison: [
    {
      competitor: "HelloFresh",
      their_position: "Convenience at scale.",
      our_advantage: "Skills that last.",
      our_gap: "No brand yet.",
      url: "https://www.hellofresh.com",
      search_url: "https://www.google.com/search?q=HelloFresh",
    },
    {
      competitor: "Recipe blogs",
      their_position: "Free.",
      our_advantage: "Structured path.",
      our_gap: "Costs money.",
      url: null,
      search_url: "https://www.google.com/search?q=Recipe+blogs",
    },
  ],
  differentiators: [
    { claim: "Beginner-first coaching.", evidence: "No alternative serves beginners.", evidence_stage: "existing_alternatives" },
  ],
  risks: ["A meal-kit company adds coaching."],
  defensibility: "Community makes switching costly.",
  action_items: [
    action("a-low", "Draft a grocer pitch", { priority: "low", timeframe: "this_month" }),
    action("a-interview", "Interview five meal-kit cancellers"),
    action("a-landing", "Publish a landing page", { priority: "medium", timeframe: "this_month" }),
    action("a-partner", "Sign two pilot partners", { timeframe: "this_quarter" }),
  ],
  confidence: 0.6,
  sources: [{ title: "HelloFresh annual report", url: "https://ir.hellofresh.com" }],
  researched_at: "2026-10-12T09:00:00Z",
  based_on: "2026-10-12T08:30:00Z",
  language: "en",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel(
  analysis: CompetitivePositionAnalysis | null,
  {
    completed = [] as string[],
    onToggle = vi.fn(),
    locale = "en" as "en" | "ko",
    historical = false,
  } = {},
) {
  renderWithProviders(
    <CompetitivePositionPanel
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

describe("CompetitivePositionPanel", () => {
  it("shows the positioning statement, segment and category", () => {
    stubApi({});
    renderPanel(POSITION);

    const statement = screen.getByTestId("positioning-statement");
    expect(statement).toHaveTextContent(POSITION.positioning_statement);
    expect(statement).toHaveTextContent("Busy dual-income families");
    expect(statement).toHaveTextContent("Guided home cooking");
  });

  it("groups action items by timeframe, highest priority first", () => {
    stubApi({});
    renderPanel(POSITION);

    expect(within(screen.getByTestId("actions-this_week")).getByText(A.timeframes.this_week)).toBeInTheDocument();
    const month = within(screen.getByTestId("actions-this_month")).getAllByRole("checkbox");
    expect(month.map((box) => box.id)).toEqual(["action-a-landing", "action-a-low"]);
    expect(screen.getByTestId("actions-this_quarter")).toHaveTextContent("Sign two pilot partners");

    const row = screen.getByTestId("action-a-interview");
    expect(row).toHaveTextContent(A.priorities.high);
    expect(row).toHaveTextContent("Why Interview five meal-kit cancellers");
    expect(within(row).getAllByRole("listitem")).toHaveLength(2);
    expect(row).toHaveTextContent(`${A.successMetric} Metric for Interview five meal-kit cancellers`);
  });

  it("makes This week, This month and This quarter collapsible sections with their own progress", () => {
    stubApi({});
    renderPanel(POSITION, { completed: ["a-landing"] });

    for (const timeframe of ["this_week", "this_month", "this_quarter"] as const) {
      const section = screen.getByTestId(`actions-${timeframe}`) as HTMLDetailsElement;
      expect(section.tagName).toBe("DETAILS");
      expect(section.open).toBe(false); // closed until opened
      expect(section.querySelector("summary")).toHaveTextContent(A.timeframes[timeframe]);
    }
    const month = screen.getByTestId("actions-this_month") as HTMLDetailsElement;
    expect(month.querySelector("summary")).toHaveTextContent("1 of 2 done");
    fireEvent.click(month.querySelector("summary")!);
    expect(month.open).toBe(true);
    expect(within(month).getByLabelText("Publish a landing page")).toBeChecked();
  });

  it("ticks action items off and shows progress", () => {
    stubApi({});
    const onToggle = renderPanel(POSITION, { completed: ["a-landing", "stale-id"] });

    expect(screen.getByTestId("actions-progress")).toHaveTextContent("1 of 4 done");
    expect(screen.getByRole("checkbox", { name: "Publish a landing page" })).toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "Interview five meal-kit cancellers" }));
    expect(onToggle).toHaveBeenCalledWith("a-interview", true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Publish a landing page" }));
    expect(onToggle).toHaveBeenCalledWith("a-landing", false);
  });

  it("doesn't let an earlier position be ticked", () => {
    stubApi({});
    renderPanel(POSITION, { historical: true });

    expect(screen.getByRole("checkbox", { name: "Publish a landing page" })).toBeDisabled();
    expect(screen.getByText(A.readOnly)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: C.refresh })).not.toBeInTheDocument();
  });

  it("compares competitors, linking only verified websites", () => {
    stubApi({});
    renderPanel(POSITION);
    const section = screen.getByTestId("comparison-section") as HTMLDetailsElement;
    expect(section.querySelector("summary")).toHaveTextContent("Your Competitive Positioning");
    expect(section.open).toBe(false); // collapsed until opened
    fireEvent.click(section.querySelector("summary")!);
    expect(section.open).toBe(true);

    const table = screen.getByTestId("competitor-comparison");
    expect(within(table).getByRole("link", { name: "HelloFresh ↗" })).toHaveAttribute("href", "https://www.hellofresh.com");
    expect(within(table).getByRole("link", { name: "Search the web for Recipe blogs" })).toHaveAttribute(
      "href",
      "https://www.google.com/search?q=Recipe+blogs",
    );
    expect(table).toHaveTextContent("Skills that last.");
    expect(screen.getByText("Beginner-first coaching.")).toBeInTheDocument();
    expect(screen.getByText(C.evidenceStages.existing_alternatives)).toBeInTheDocument();
    expect(screen.getByText("Community makes switching costly.")).toBeInTheDocument();
  });

  it("works out the position automatically, retries, and refreshes", async () => {
    let calls = 0;
    const refreshed = { ...POSITION, positioning_statement: "Refreshed statement." };
    stubApi({
      [RESEARCH_PATH]: () => {
        calls += 1;
        return calls === 1 ? { status: 503, body: null } : { body: calls === 2 ? POSITION : refreshed };
      },
    });
    renderPanel(null);

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Login.errorUnavailable);
    fireEvent.click(screen.getByRole("button", { name: C.retry }));
    expect(await screen.findByText(POSITION.positioning_statement)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: C.refresh }));
    expect(await screen.findByText("Refreshed statement.")).toBeInTheDocument();
    expect(calls).toBe(3);
  });

  it("renders in Korean", () => {
    stubApi({});
    renderPanel({ ...POSITION, language: "ko" }, { locale: "ko", completed: ["a-low"] });

    expect(screen.getByText(ko.ActionChecklist.title)).toBeInTheDocument();
    expect(screen.getByTestId("actions-progress")).toHaveTextContent("4개 중 1개 완료");
    expect(screen.getByText(ko.ActionChecklist.timeframes.this_week)).toBeInTheDocument();
  });
});
