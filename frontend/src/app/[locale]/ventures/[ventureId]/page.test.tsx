import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";
import type { WizardStageStatus } from "@/lib/api";
import VentureWizardPage from "./page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ ventureId: "venture-1" }),
}));

const PROBLEM_FIELDS = {
  fields: [
    { name: "problem_statement", label_en: "What problem are you solving?", label_ko: "?", type: "text" },
    { name: "evidence_for_problem", label_en: "Evidence?", label_ko: "?", type: "text" },
    { name: "who_experiences_it", label_en: "Who?", label_ko: "?", type: "text" },
    { name: "frequency_severity", label_en: "How often?", label_ko: "?", type: "text" },
  ],
};

const IDEA_FIELDS = {
  fields: [
    { name: "idea_statement", label_en: "Your idea in your own words", label_ko: "?", type: "text" },
    {
      name: "differentiation_plan",
      label_en: "Based on the research, how will you differentiate your venture?",
      label_ko: "?",
      type: "text",
    },
  ],
};

const FAKE_RESEARCH = {
  kind: "idea_research",
  summary: "Several meal-kit services exist; a Korean-recipe focus is less common.",
  market_status: "some_similar_offerings",
  existing_solutions: [
    { name: "Maangchi", description: "Korean recipe site.", similarity: "partial", url: "https://www.maangchi.com" },
  ],
  feasibility: ["Buildable with existing recipe APIs."],
  viability: ["Subscription willingness is uncertain."],
  differentiation_opportunities: ["Focus on busy U.S. families new to Korean cooking."],
  key_risks: ["Large recipe apps could add the feature."],
  suggested_next_steps: ["Interview ten households."],
  confidence: 0.6,
  feasibility_score: 68,
  feasibility_factors: {
    technical_complexity: { rating: "favorable", reason: "Standard tools." },
    resources_required: { rating: "moderate", reason: "Small team." },
    regulatory_barriers: { rating: "favorable", reason: "Few rules." },
    time_to_market: { rating: "moderate", reason: "A few months." },
    customer_access: { rating: "challenging", reason: "Hard to reach." },
  },
  sources: [{ title: "Maangchi", url: "https://www.maangchi.com" }],
  researched_at: "2026-10-02T09:00:00Z",
  language: "en",
};

/** Most tests start past Stage 1, so the wizard opens on Stage 2. */
function completeStageOne() {
  const ideaStage = stages.find((s) => s.slug === "idea_discovery")!;
  ideaStage.status = "completed";
  ideaStage.answers = { idea_statement: "Saved idea", differentiation_plan: "Niche" };
  ideaStage.ai_analysis = FAKE_RESEARCH as WizardStageStatus["ai_analysis"];
}

const ALTERNATIVES_FIELDS = {
  fields: [
    {
      name: "current_solutions",
      label_en: "How do your target customers solve this problem today?",
      label_ko: "?",
      type: "text",
    },
    { name: "why_switch", label_en: "Why would they switch?", label_ko: "?", type: "text" },
    { name: "biggest_threat", label_en: "Biggest threat?", label_ko: "?", type: "text" },
  ],
};

const FAKE_ALTERNATIVES = {
  kind: "alternatives_research",
  summary: "Customers mostly rely on recipe blogs and meal kits.",
  alternatives: [
    {
      name: "HelloFresh",
      category: "indirect_competitor",
      description: "Meal kit delivery.",
      strengths: ["Convenient."],
      weaknesses: ["Few Korean dishes."],
      pricing: "$9 per serving",
      url: "https://www.hellofresh.com",
      search_url: "https://www.google.com/search?q=HelloFresh",
    },
  ],
  switching_barriers: ["Habit."],
  unmet_needs: ["Guided Korean cooking for beginners."],
  positioning_recommendations: ["Lead with authenticity."],
  suggested_next_steps: ["Interview meal-kit users."],
  confidence: 0.6,
  sources: [{ title: "HelloFresh menu", url: "https://www.hellofresh.com/menus" }],
  researched_at: "2026-10-02T10:00:00Z",
  based_on: "2026-10-02T09:30:00Z",
  language: "en",
};

/** Completes stages 1-3 so Stage 4 unlocks, as the server would report. */
function completeStagesOneToThree() {
  completeStageOne();
  for (const slug of ["problem_definition", "customer_definition"]) {
    stages.find((s) => s.slug === slug)!.status = "completed";
  }
  const alternatives = stages.find((s) => s.slug === "existing_alternatives")!;
  alternatives.locked = false;
  alternatives.locked_by = [];
}

function baseStages(): WizardStageStatus[] {
  const slugs: [string, boolean, unknown][] = [
    ["idea_discovery", true, IDEA_FIELDS],
    ["problem_definition", true, PROBLEM_FIELDS],
    ["customer_definition", true, { fields: [] }],
    ["existing_alternatives", true, ALTERNATIVES_FIELDS],
    ["value_proposition", true, { fields: [] }],
    ["market_evidence", false, null],
    ["competitive_position", false, null],
    ["dfv_assessment", false, null],
    ["business_model", false, null],
    ["validation_plan", false, null],
    ["decision_roadmap", false, null],
  ];
  return slugs.map(([slug, implemented, question_schema], index) => ({
    slug,
    number: index + 1,
    title_en: slug,
    title_ko: slug,
    implemented,
    status: "not_started",
    answers: null,
    ai_analysis: null,
    question_schema: question_schema as WizardStageStatus["question_schema"],
    locked: slug === "existing_alternatives",
    locked_by:
      slug === "existing_alternatives"
        ? ["idea_discovery", "problem_definition", "customer_definition"]
        : [],
  }));
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <VentureWizardPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

let stages: WizardStageStatus[];
let researchCalls: unknown[];
let historyRuns: unknown[];
let alternativesCalls: unknown[];
let alternativesHistory: unknown[];

beforeEach(() => {
  stages = baseStages();
  researchCalls = [];
  historyRuns = [];
  alternativesCalls = [];
  alternativesHistory = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/stages/idea_discovery/research/history")) {
        return jsonResponse(historyRuns);
      }
      if (url.endsWith("/stages/existing_alternatives/research/history")) {
        return jsonResponse(alternativesHistory);
      }
      if (init?.method === "POST" && url.endsWith("/stages/existing_alternatives/research")) {
        alternativesCalls.push(JSON.parse(init.body as string));
        const alternatives = stages.find((s) => s.slug === "existing_alternatives")!;
        alternatives.ai_analysis = FAKE_ALTERNATIVES as WizardStageStatus["ai_analysis"];
        alternatives.answers ??= { current_solutions: "", why_switch: "", biggest_threat: "" };
        alternatives.status = "awaiting_user";
        alternativesHistory = [
          { id: "alt-run-1", created_at: FAKE_ALTERNATIVES.researched_at, research: FAKE_ALTERNATIVES },
        ];
        return jsonResponse(FAKE_ALTERNATIVES);
      }
      if (url.endsWith("/api/ventures/venture-1")) {
        return jsonResponse({
          id: "venture-1",
          title: "Korean Recipe Cooking Assistant",
          original_idea: "An AI-powered cooking assistant for Korean recipes.",
        });
      }
      if (url.endsWith("/stages") && (!init || init.method === undefined)) {
        return jsonResponse(stages);
      }
      if (init?.method === "PUT") {
        const slug = url.split("/stages/")[1];
        const body = JSON.parse(init.body as string);
        const stage = stages.find((s) => s.slug === slug)!;
        stage.answers = body.answers;
        stage.status = body.complete ? "completed" : "in_progress";
        return jsonResponse(null);
      }
      if (init?.method === "POST" && url.endsWith("/stages/idea_discovery/research")) {
        researchCalls.push(JSON.parse(init.body as string));
        const ideaStage = stages.find((s) => s.slug === "idea_discovery")!;
        ideaStage.ai_analysis = FAKE_RESEARCH as WizardStageStatus["ai_analysis"];
        ideaStage.answers ??= { idea_statement: "From research", differentiation_plan: "" };
        ideaStage.status = "awaiting_user";
        return jsonResponse(FAKE_RESEARCH);
      }
      if (init?.method === "POST" && url.endsWith("/analyze")) {
        const slug = url.split("/stages/")[1].replace("/analyze", "");
        const stage = stages.find((s) => s.slug === slug)!;
        stage.ai_analysis = {
          summary: "Fake analysis.",
          strengths: ["Clear problem."],
          gaps: ["No evidence."],
          suggested_next_steps: ["Interview customers."],
          confidence: 0.5,
        };
        stage.status = "awaiting_user";
        return jsonResponse(stage.ai_analysis);
      }
      return jsonResponse(stages);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VentureWizardPage", () => {
  it("renders 11 stages with 4 implemented and 7 disabled", async () => {
    renderPage();

    const buttons = await screen.findAllByRole("button");
    const stageButtons = buttons.filter((b) => b.textContent?.includes("_"));
    expect(stageButtons).toHaveLength(11);
    const enabled = stageButtons.filter((b) => !b.hasAttribute("disabled"));
    expect(enabled).toHaveLength(4);
  });

  it("shows the WeeAIM Venture Wizard title and numbers each stage", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "WeeAIM Venture Wizard" }),
    ).toBeInTheDocument();
    const stageButtons = (await screen.findAllByRole("button")).filter((b) =>
      b.textContent?.includes("_"),
    );
    expect(stageButtons.map((b) => b.textContent?.match(/^(\d+)\./)?.[1])).toEqual(
      Array.from({ length: 11 }, (_, i) => String(i + 1)),
    );

    fireEvent.click(screen.getByText("problem_definition"));
    expect(await screen.findByText("Stage 2: problem_definition")).toBeInTheDocument();
  });

  it("shows the venture idea in bold next to the wizard title", async () => {
    renderPage();

    const idea = await screen.findByText("Korean Recipe Cooking Assistant");
    expect(idea).toHaveClass("font-bold");
    const title = screen.getByRole("heading", { level: 1, name: "WeeAIM Venture Wizard" });
    expect(idea.parentElement).toBe(title.parentElement);
  });

  it("shows each available stage's completion percentage", async () => {
    completeStageOne();
    stages.find((s) => s.slug === "problem_definition")!.answers = {
      problem_statement: "Hard to find good recipes.",
      evidence_for_problem: "",
    };
    stages.find((s) => s.slug === "value_proposition")!.status = "completed";
    renderPage();

    const bar = (title: string) =>
      screen.findByRole("progressbar", { name: `${title} completion` });
    // 1 of 4 questions answered (blank answers don't count).
    expect(await bar("problem_definition")).toHaveAttribute("aria-valuenow", "25");
    expect(await bar("customer_definition")).toHaveAttribute("aria-valuenow", "0");
    expect(await bar("value_proposition")).toHaveAttribute("aria-valuenow", "100");
    // Stages that aren't available yet have no percentage.
    expect(screen.queryByRole("progressbar", { name: "existing_alternatives completion" })).toBeNull();
    expect(screen.getAllByRole("progressbar")).toHaveLength(4);
    expect(screen.getByText("25% complete")).toBeInTheDocument();
  });

  it("updates the current stage's percentage while typing", async () => {
    completeStageOne();
    renderPage();
    const input = await screen.findByLabelText("What problem are you solving?");

    fireEvent.change(input, { target: { value: "Hard to find good recipes." } });

    expect(
      await screen.findByRole("progressbar", { name: "problem_definition completion" }),
    ).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("25% complete")).toBeInTheDocument();
  });

  it("opens on the first incomplete stage", async () => {
    renderPage();

    // A new venture starts at Stage 1, Idea Discovery.
    expect(await screen.findByText("Stage 1: idea_discovery")).toBeInTheDocument();
    expect(screen.getByLabelText("Your idea in your own words")).toBeInTheDocument();
  });

  it("opens on Stage 2 once Stage 1 is complete", async () => {
    completeStageOne();
    renderPage();

    expect(await screen.findByText("Stage 2: problem_definition")).toBeInTheDocument();
  });

  it("highlights only the current stage", async () => {
    completeStageOne();
    renderPage();
    await screen.findByText("Stage 2: problem_definition");

    const current = screen.getByRole("button", { current: "step" });
    expect(current).toHaveTextContent("problem_definition");
    expect(current.className).toContain("aria-[current=step]:border-blue-600");
    expect(current.className).toContain("rounded-full");

    fireEvent.click(screen.getByText("customer_definition"));
    await waitFor(() =>
      expect(screen.getByRole("button", { current: "step" })).toHaveTextContent(
        "customer_definition",
      ),
    );
    expect(screen.getAllByRole("button", { current: "step" })).toHaveLength(1);
  });

  it("shows the current stage's name in bold blue", async () => {
    completeStageOne();
    renderPage();

    const heading = await screen.findByText("Stage 2: problem_definition");
    expect(heading).toHaveClass("font-bold", "text-blue-700");
    const sidebarTitle = screen.getByText("problem_definition");
    expect(sidebarTitle).toHaveClass(
      "group-aria-[current=step]:font-bold",
      "group-aria-[current=step]:text-blue-700",
    );
    expect(sidebarTitle.closest("button")).toHaveAttribute("aria-current", "step");
    expect(sidebarTitle.closest("button")).toHaveClass("group");
  });

  it("skips completed stages when choosing where to start", async () => {
    completeStageOne();
    stages.find((s) => s.slug === "problem_definition")!.status = "completed";
    stages.find((s) => s.slug === "customer_definition")!.status = "in_progress";
    renderPage();

    expect(await screen.findByText("Stage 3: customer_definition")).toBeInTheDocument();
  });

  it("opens the first available stage when every stage is complete", async () => {
    completeStageOne();
    for (const stage of stages) stage.status = "completed";
    renderPage();

    expect(await screen.findByText("Stage 1: idea_discovery")).toBeInTheDocument();
  });

  it("restores saved answers in the stage it opens on", async () => {
    completeStageOne();
    const problem = stages.find((s) => s.slug === "problem_definition")!;
    problem.status = "in_progress";
    problem.answers = { problem_statement: "Hard to find good recipes." };
    renderPage();

    expect(await screen.findByLabelText("What problem are you solving?")).toHaveValue(
      "Hard to find good recipes.",
    );
  });

  it("autosaves on blur and shows the saved indicator", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("problem_definition"));
    const input = await screen.findByLabelText("What problem are you solving?");
    fireEvent.change(input, { target: { value: "Hard to find good recipes." } });
    fireEvent.blur(input);

    await waitFor(() => expect(screen.getByText(messages.Wizard.saved)).toBeInTheDocument());
    expect(stages.find((s) => s.slug === "problem_definition")?.answers?.problem_statement).toBe(
      "Hard to find good recipes.",
    );
  });

  it("marks a stage complete", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("problem_definition"));
    fireEvent.click(await screen.findByRole("button", { name: messages.Wizard.markComplete }));

    await waitFor(() =>
      expect(stages.find((s) => s.slug === "problem_definition")?.status).toBe("completed"),
    );
  });

  it("gets AI feedback and renders it", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("problem_definition"));
    fireEvent.click(await screen.findByRole("button", { name: messages.Wizard.getFeedback }));

    expect(await screen.findByText("Fake analysis.")).toBeInTheDocument();
    expect(screen.getByText("Clear problem.")).toBeInTheDocument();
  });

  it("shows the revision banner for a needs_revision stage", async () => {
    stages = baseStages();
    completeStageOne();
    const valueProp = stages.find((s) => s.slug === "value_proposition")!;
    valueProp.status = "needs_revision";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(stages)));

    renderPage();

    fireEvent.click(await screen.findByText("value_proposition"));
    expect(await screen.findByText(messages.Wizard.revisionBanner)).toBeInTheDocument();
  });

  it("researches the idea automatically on first opening Stage 1", async () => {
    renderPage();

    expect(
      await screen.findByText("Several meal-kit services exist; a Korean-recipe focus is less common."),
    ).toBeInTheDocument();
    expect(researchCalls).toEqual([{ language: "en" }]);
    // The idea field starts from the idea the venture was created with.
    expect(screen.getByLabelText("Your idea in your own words")).toHaveValue(
      "An AI-powered cooking assistant for Korean recipes.",
    );
    // Stage 1 has research instead of the generic feedback button.
    expect(screen.queryByRole("button", { name: messages.Wizard.getFeedback })).not.toBeInTheDocument();
  });

  it("shows the Degree of Feasibility between the stage title and the research", async () => {
    renderPage();

    const score = await screen.findByTestId("feasibility-score");
    await waitFor(() => expect(score).toHaveTextContent("68%"));
    const title = screen.getByText("Stage 1: idea_discovery");
    const research = screen.getByText(messages.IdeaResearch.title);
    // Document order: stage title, then the degree, then the research section.
    expect(title.compareDocumentPosition(score) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(score.compareDocumentPosition(research) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows saved research without researching again", async () => {
    const ideaStage = stages.find((s) => s.slug === "idea_discovery")!;
    ideaStage.ai_analysis = FAKE_RESEARCH as WizardStageStatus["ai_analysis"];
    ideaStage.answers = { idea_statement: "My saved idea", differentiation_plan: "" };
    ideaStage.status = "awaiting_user";
    renderPage();

    expect(await screen.findByText(messages.IdeaResearch.differentiationTitle)).toBeInTheDocument();
    expect(screen.getByLabelText("Your idea in your own words")).toHaveValue("My saved idea");
    expect(researchCalls).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: messages.IdeaResearch.rerun }));
    await waitFor(() => expect(researchCalls).toHaveLength(1));
  });

  it("shows Stage 1 sources and research history in a third column", async () => {
    const ideaStage = stages.find((s) => s.slug === "idea_discovery")!;
    ideaStage.ai_analysis = FAKE_RESEARCH as WizardStageStatus["ai_analysis"];
    ideaStage.answers = { idea_statement: "My saved idea", differentiation_plan: "" };
    ideaStage.status = "awaiting_user";
    historyRuns = [
      { id: "run-2", created_at: "2026-10-02T09:00:00Z", research: FAKE_RESEARCH },
      {
        id: "run-1",
        created_at: "2026-10-01T09:00:00Z",
        research: {
          ...FAKE_RESEARCH,
          summary: "An older take on the idea.",
          feasibility_score: 52,
          sources: [{ title: "Older source", url: "https://older.example.com" }],
        },
      },
    ];
    renderPage();

    const column = await screen.findByRole("complementary", {
      name: messages.Wizard.researchColumn,
    });
    expect(within(column).getByRole("link", { name: "Maangchi" })).toHaveAttribute(
      "href",
      "https://www.maangchi.com",
    );
    expect(await within(column).findByText("52%")).toBeInTheDocument();

    // Reopen the earlier run: the panel, sources and degree all switch to it.
    fireEvent.click(within(column).getByText("52%").closest("button")!);
    expect(await screen.findByText("An older take on the idea.")).toBeInTheDocument();
    expect(within(column).getByRole("link", { name: "Older source" })).toBeInTheDocument();
    expect(screen.getByTestId("feasibility-score")).toHaveTextContent("52%");

    fireEvent.click(screen.getByRole("button", { name: messages.IdeaResearch.backToLatest }));
    expect(await screen.findByText(FAKE_RESEARCH.summary)).toBeInTheDocument();
  });

  it("shows Stage 4 locked until stages 1–3 are complete", async () => {
    completeStageOne();
    renderPage();
    await screen.findByText("Stage 2: problem_definition");

    const stage4 = screen.getByText("existing_alternatives").closest("button")!;
    expect(stage4).toBeDisabled();
    expect(stage4).toHaveTextContent(messages.Wizard.locked);
    expect(stage4).toHaveAttribute("title", messages.Wizard.lockedHint);
    expect(
      screen.queryByRole("progressbar", { name: "existing_alternatives completion" }),
    ).not.toBeInTheDocument();

    fireEvent.click(stage4);
    expect(screen.queryByText("Stage 4: existing_alternatives")).not.toBeInTheDocument();
    expect(alternativesCalls).toEqual([]);
  });

  it("opens on Stage 4 once unlocked and researches alternatives from stages 1–3", async () => {
    completeStagesOneToThree();
    renderPage();

    expect(await screen.findByText("Stage 4: existing_alternatives")).toBeInTheDocument();
    expect(
      await screen.findByText("Customers mostly rely on recipe blogs and meal kits."),
    ).toBeInTheDocument();
    expect(alternativesCalls).toEqual([{ language: "en" }]);
    expect(screen.getByLabelText("How do your target customers solve this problem today?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: messages.Wizard.getFeedback })).not.toBeInTheDocument();

    const column = screen.getByRole("complementary", { name: messages.Wizard.researchColumn });
    expect(
      await within(column).findByRole("link", { name: "HelloFresh menu" }),
    ).toHaveAttribute("href", "https://www.hellofresh.com/menus");
  });
});
