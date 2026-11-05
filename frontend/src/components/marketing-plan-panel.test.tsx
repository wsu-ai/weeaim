import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../messages/en.json";
import ko from "../../messages/ko.json";
import type { MarketingPlanAnalysis } from "@/lib/api";
import { renderWithProviders, stubApi } from "@/test/auth-helpers";
import { MarketingPlanPanel } from "./marketing-plan-panel";

const M = messages.MarketingPlan;
const RESEARCH_PATH = "/api/ventures/v1/stages/marketing_plan/research";
const DECK_PATH = "/api/ventures/v1/deck.pptx?language=en";

const PLAN: MarketingPlanAnalysis = {
  kind: "marketing_plan",
  summary: "Win busy families who want to learn, not reheat.",
  positioning_recap: "The guided cooking coach for busy families.",
  currency: "USD",
  personas: [
    { name: "Busy parent", description: "Works full time.", pains: ["No time", "Picky kids"], where_to_reach: ["Instagram"] },
    { name: "Curious foodie", description: "Loves new cuisines.", pains: ["Hard recipes"], where_to_reach: ["YouTube"] },
  ],
  key_messages: [{ message: "Learn, don't just reheat.", proof_point: "Kits teach nothing.", counters: "Meal kits" }],
  differentiators: [{ claim: "Beginner-first lessons.", versus: "Recipe blogs" }],
  channels: [
    {
      name: "Instagram ads", type: "paid", why: "Where parents scroll.", tactics: ["Short reels"], monthly_budget: 300,
      start_month: 1, kpi_metric: "sign-ups", kpi_target: 100, url: "https://www.instagram.com",
    },
    {
      name: "Grocer partnerships", type: "partnership", why: "Shoppers buy ingredients.", tactics: ["Shelf cards"],
      monthly_budget: 100, start_month: 2, kpi_metric: "partners", kpi_target: 3, url: null,
    },
    {
      name: "Cooking community", type: "community", why: "Peer motivation.", tactics: ["Weekly challenge"],
      monthly_budget: 100, start_month: 1, kpi_metric: "members", kpi_target: 200, url: null,
    },
  ],
  budget: {
    total_monthly: 500,
    by_type: [{ type: "paid", monthly: 300, share: 0.6 }],
    projection_monthly: 300,
    gap_to_projection: 200,
    over_projection: true,
  },
  launch_phases: [
    { name: "Pre-launch", start_week: 0, end_week: 4, activities: ["Build a waitlist"] },
    { name: "Launch", start_week: 5, end_week: 12, activities: ["Run ads"] },
  ],
  funnel: {
    target_month: 6, awareness: 10000, leads: 800, trials: 200, paying: 50,
    rates: { leads_per_awareness: 0.08, trials_per_lead: 0.25, paying_per_trial: 0.25, paying_per_awareness: 0.005 },
  },
  risks: ["Ad costs rise."],
  action_items: [
    { id: "a1", title: "Set up a waitlist page", why: "Early demand.", steps: ["Build it."], priority: "high", timeframe: "this_week", success_metric: "100 sign-ups." },
  ],
  confidence: 0.5,
  sources: [],
  researched_at: "2026-10-13T09:00:00Z",
  based_on: null,
  language: "en",
};

beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:deck"), revokeObjectURL: vi.fn() }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel(
  analysis: MarketingPlanAnalysis | null,
  { locale = "en" as "en" | "ko", historical = false, onToggleAction = vi.fn() } = {},
) {
  renderWithProviders(
    <MarketingPlanPanel
      ventureId="v1"
      analysis={analysis}
      language={locale}
      completedActions={[]}
      onToggleAction={onToggleAction}
      onResearched={vi.fn()}
      historical={historical}
    />,
    locale,
  );
  return onToggleAction;
}

describe("MarketingPlanPanel", () => {
  it("shows positioning, personas, messages and differentiators", () => {
    stubApi({});
    renderPanel(PLAN);

    expect(screen.getByTestId("positioning-recap")).toHaveTextContent(PLAN.positioning_recap);
    expect(within(screen.getByTestId("personas")).getByText("Busy parent")).toBeInTheDocument();
    expect(screen.getByTestId("personas")).toHaveTextContent("No time, Picky kids");
    const messages_ = screen.getByTestId("key-messages");
    expect(messages_).toHaveTextContent("“Learn, don't just reheat.”");
    expect(messages_).toHaveTextContent("Counters Meal kits");
    expect(screen.getByText("vs. Recipe blogs")).toBeInTheDocument();
  });

  it("lists channels with verified links only", () => {
    stubApi({});
    renderPanel(PLAN);

    const table = screen.getByTestId("channels-table");
    expect(within(table).getByRole("link", { name: "Open Instagram ads" })).toHaveAttribute("href", "https://www.instagram.com");
    expect(within(table).queryByRole("link", { name: "Open Grocer partnerships" })).not.toBeInTheDocument();
    expect(table).toHaveTextContent(M.channelTypes.partnership);
    expect(table).toHaveTextContent("$300");
    expect(table).toHaveTextContent("100 sign-ups");
  });

  it("charts the budget and flags spending above the projection", () => {
    stubApi({});
    renderPanel(PLAN);

    expect(screen.getByRole("img", { name: "Bar chart of the monthly budget per channel; total $500." })).toBeInTheDocument();
    const budget = screen.getByTestId("budget");
    expect(budget).toHaveTextContent("Total: $500 a month");
    expect(within(budget).getByRole("alert")).toHaveTextContent(
      "This plan costs $200 a month more than your financial projection allows",
    );
  });

  it("explains how the budget compares when within the projection, or without one", () => {
    stubApi({});
    renderPanel({ ...PLAN, budget: { ...PLAN.budget, projection_monthly: null, gap_to_projection: null, over_projection: false } });
    expect(screen.getByText(M.budgetNoProjection)).toBeInTheDocument();
  });

  it("shows the funnel with calculated conversion rates and the launch timeline", () => {
    stubApi({});
    renderPanel(PLAN);

    const funnel = screen.getByTestId("funnel");
    expect(funnel).toHaveTextContent("Funnel targets by month 6");
    expect(funnel).toHaveTextContent("10,000");
    expect(funnel).toHaveTextContent("8% of the step before");
    expect(funnel).toHaveTextContent("0.5% from awareness to paying (calculated)");
    expect(screen.getByTestId("launch-phases")).toHaveTextContent("Weeks 5–12");
  });

  it("ticks action items", () => {
    stubApi({});
    const onToggleAction = renderPanel(PLAN);
    fireEvent.click(screen.getByRole("checkbox", { name: "Set up a waitlist page" }));
    expect(onToggleAction).toHaveBeenCalledWith("a1", true);
  });

  it("creates and downloads the presentation deck on request", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-disposition": 'attachment; filename="kimchikit-deck.pptx"' }),
      blob: async () => new Blob(["pptx"]),
      json: async () => null,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderPanel(PLAN);

    fireEvent.click(screen.getByRole("button", { name: M.deckButton }));

    expect(await screen.findByText("Deck downloaded: kimchikit-deck.pptx")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(DECK_PATH), expect.objectContaining({ credentials: "include" }));
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it("reports when the deck can't be created", async () => {
    stubApi({ [DECK_PATH]: { status: 500, body: null } });
    renderPanel(PLAN);

    fireEvent.click(screen.getByRole("button", { name: M.deckButton }));
    expect(await screen.findByText(M.deckFailed)).toBeInTheDocument();
  });

  it("writes the plan automatically, retries, and refreshes", async () => {
    let calls = 0;
    stubApi({
      [RESEARCH_PATH]: () => {
        calls += 1;
        return calls === 1 ? { status: 503, body: null } : { body: { ...PLAN, summary: `Plan ${calls}` } };
      },
    });
    renderPanel(null);

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Login.errorUnavailable);
    fireEvent.click(screen.getByRole("button", { name: M.retry }));
    expect(await screen.findByText("Plan 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: M.refresh }));
    await waitFor(() => expect(screen.getByText("Plan 3")).toBeInTheDocument());
  });

  it("is read-only for an earlier plan", () => {
    stubApi({});
    renderPanel(PLAN, { historical: true });
    expect(screen.queryByTestId("deck-download")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Set up a waitlist page" })).toBeDisabled();
  });

  it("renders in Korean", () => {
    stubApi({});
    renderPanel({ ...PLAN, language: "ko" }, { locale: "ko" });
    expect(screen.getByText(ko.MarketingPlan.title)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ko.MarketingPlan.deckButton })).toBeInTheDocument();
  });
});
