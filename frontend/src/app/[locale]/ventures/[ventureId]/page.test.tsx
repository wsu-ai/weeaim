import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";
import type { WizardStageStatus } from "@/lib/api";
import VentureWizardPage from "./page";

vi.mock("@/i18n/navigation", async () => (await import("@/test/auth-helpers")).navigationMock);

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useParams: () => ({ ventureId: "venture-1" }),
  useSearchParams: () => searchParams,
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
    ["persona_validation", false, null],
    ["competitive_position", false, null],
    ["dfv_assessment", false, null],
    ["mvp", false, null],
    ["business_model", false, null],
    ["validation_plan", false, null],
    ["financial_analysis", false, null],
    ["marketing_plan", false, null],
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

function badgeOf(slug: string) {
  return screen.getByTestId(`stage-icon-${slug}`);
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
let marketCalls: unknown[];
let preferenceUpdates: unknown[];
let translateCalls: unknown[];
let translatedReply: unknown;
let agentRun: unknown;
let analyzeBodies: unknown[];
const FINISHED_RUN = {
  id: "run-1",
  stage_slug: "problem_definition",
  status: "succeeded",
  language: "en",
  model_turns: 2,
  web_searches: 1,
  tokens_used: 100,
  active_ms: 1000,
  pending_question: null,
  proposed_answers: { problem_statement: "Agent's draft." },
  error: null,
  created_at: "2026-10-14T09:00:00Z",
  finished_at: "2026-10-14T09:01:00Z",
  steps: [],
};
let accountSession: Record<string, unknown>;

beforeEach(() => {
  searchParams = new URLSearchParams();
  stages = baseStages();
  researchCalls = [];
  historyRuns = [];
  alternativesCalls = [];
  alternativesHistory = [];
  marketCalls = [];
  preferenceUpdates = [];
  translateCalls = [];
  translatedReply = null;
  agentRun = null;
  analyzeBodies = [];
  accountSession = {
    email: "founder@test.dev",
    display_name: "Founder",
    organizations: [{ slug: "woosong", name: "Woosong University", role: "member" }],
    active_organization: "woosong",
    default_country: "South Korea",
    default_metro_city: "Seoul",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/agent-runs/latest")) {
        return jsonResponse(agentRun);
      }
      if (url.endsWith("/stages/idea_discovery/research/history")) {
        return jsonResponse(historyRuns);
      }
      if (url.endsWith("/stages/existing_alternatives/research/history")) {
        return jsonResponse(alternativesHistory);
      }
      if (url.endsWith("/research/history")) {
        return jsonResponse([]);
      }
      if (init?.method === "POST" && url.endsWith("/translate")) {
        translateCalls.push({ url, body: JSON.parse(init.body as string) });
        return translatedReply ? jsonResponse(translatedReply) : jsonResponse({ detail: "fail" }, false);
      }
      if (url.endsWith("/api/auth/me/preferences")) {
        preferenceUpdates.push(JSON.parse(init!.body as string));
        return jsonResponse({ ...accountSession, ...JSON.parse(init!.body as string) });
      }
      if (url.endsWith("/api/auth/me")) {
        return jsonResponse(accountSession);
      }
      if (init?.method === "POST" && url.endsWith("/stages/market_evidence/research")) {
        marketCalls.push(JSON.parse(init.body as string));
        return jsonResponse({ status: 422, detail: "test stub" });
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
        analyzeBodies.push(JSON.parse(init.body as string));
        const slug = url.split("/stages/")[1].replace("/analyze", "");
        const stage = stages.find((s) => s.slug === slug)!;
        stage.ai_analysis = {
          summary: "Fake analysis.",
          analyzed_at: "2026-10-14T09:30:00Z",
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
  it("renders 15 stages with 4 implemented and 11 disabled", async () => {
    renderPage();

    const buttons = await screen.findAllByRole("button");
    const stageButtons = buttons.filter((b) => /^\d+\./.test(b.textContent ?? ""));
    expect(stageButtons).toHaveLength(15);
    const enabled = stageButtons.filter((b) => !b.hasAttribute("disabled"));
    expect(enabled).toHaveLength(4);
  });

  it("shows the WeeAIM Venture Wizard title and numbers each stage", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "WeeAIM Venture Wizard" }),
    ).toBeInTheDocument();
    const stageButtons = (await screen.findAllByRole("button")).filter((b) =>
      /^\d+\./.test(b.textContent ?? ""),
    );
    expect(stageButtons.map((b) => b.textContent?.match(/^(\d+)\./)?.[1])).toEqual(
      Array.from({ length: 15 }, (_, i) => String(i + 1)),
    );

    fireEvent.click(screen.getByText("problem_definition"));
    expect(await screen.findByText("Stage 2: problem_definition")).toBeInTheDocument();
  });

  it("shows 'WeeAIM Venture Wizard | My Venture Idea →' and the venture title", async () => {
    renderPage();

    const idea = await screen.findByText("Korean Recipe Cooking Assistant");
    expect(idea).toHaveClass("font-bold");
    const label = screen.getByText(messages.Wizard.myVentureIdea);
    expect(label).toHaveClass("text-blue-700");
    const title = screen.getByRole("heading", { level: 1, name: "WeeAIM Venture Wizard" });
    const header = title.closest("header")!;
    expect(header).toHaveTextContent(
      "WeeAIM Venture Wizard|My Venture Idea → Korean Recipe Cooking Assistant",
    );
  });

  it("shows each available stage's completion percentage", async () => {
    completeStageOne();
    const problem = stages.find((s) => s.slug === "problem_definition")!;
    problem.answers = {
      problem_statement: "Hard to find good recipes.",
      evidence_for_problem: "",
    };
    // The AI mentor's feedback counts as the stage's AI content.
    problem.ai_analysis = {
      summary: "Clear problem.",
      strengths: [],
      gaps: [],
      suggested_next_steps: [],
      confidence: 0.5,
    };
    stages.find((s) => s.slug === "value_proposition")!.status = "completed";
    renderPage();

    const bar = (title: string) =>
      screen.findByRole("progressbar", { name: `${title} completion` });
    // AI content 50% + 1 of 4 questions answered x 50% (blank answers don't count) = 62.5.
    expect(await bar("problem_definition")).toHaveAttribute("aria-valuenow", "63");
    expect(await bar("customer_definition")).toHaveAttribute("aria-valuenow", "0");
    expect(await bar("value_proposition")).toHaveAttribute("aria-valuenow", "100"); // marked complete
    // Stages that aren't available yet have no percentage.
    expect(screen.queryByRole("progressbar", { name: "existing_alternatives completion" })).toBeNull();
    expect(screen.getAllByRole("progressbar")).toHaveLength(4);
    expect(screen.getByText("63% complete")).toBeInTheDocument();
  });

  it("updates the current stage's percentage while typing", async () => {
    completeStageOne();
    renderPage();
    const input = await screen.findByLabelText("What problem are you solving?");

    fireEvent.change(input, { target: { value: "Hard to find good recipes." } });

    // No AI content yet: 1 of 4 questions x 50% = 12.5, rounded.
    expect(
      await screen.findByRole("progressbar", { name: "problem_definition completion" }),
    ).toHaveAttribute("aria-valuenow", "13");
    expect(screen.getByText("13% complete")).toBeInTheDocument();
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

    // The sidebar (the stage chain above has its own current bubble).
    const sidebar = within(document.querySelector("aside")!);
    const current = sidebar.getByRole("button", { current: "step" });
    expect(current).toHaveTextContent("problem_definition");
    expect(current.className).toContain("aria-[current=step]:border-blue-600");
    expect(current.className).toContain("rounded-xl"); // a rectangle with curved corners
    expect(current.className).not.toContain("rounded-full");

    fireEvent.click(screen.getByText("customer_definition"));
    await waitFor(() =>
      expect(sidebar.getByRole("button", { current: "step" })).toHaveTextContent(
        "customer_definition",
      ),
    );
    expect(sidebar.getAllByRole("button", { current: "step" })).toHaveLength(1);
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
    agentRun = FINISHED_RUN; // the AI Mentor Agent has run
    renderPage();

    fireEvent.click(await screen.findByText("problem_definition"));
    // At least one question answered on the page (not saved yet).
    fireEvent.change(await screen.findByLabelText("What problem are you solving?"), {
      target: { value: "Cooking Korean food is intimidating." },
    });
    const mentor = await screen.findByRole("button", { name: messages.Wizard.getFeedback });
    // An icon, not a text label; the same words show as its hover/focus tooltip.
    expect(mentor).not.toHaveTextContent(messages.Wizard.getFeedback);
    expect(mentor.querySelector("svg")).not.toBeNull();
    expect(mentor).toHaveClass("border-2", "border-blue-600"); // a clear border around the icon
    expect(screen.getByTestId("mentor-tooltip")).toHaveTextContent(messages.Wizard.getFeedback);
    expect(screen.queryByTestId("feedback-time")).not.toBeInTheDocument(); // no feedback yet
    fireEvent.click(mentor);

    expect(await screen.findByText("Fake analysis.")).toBeInTheDocument();
    // The time of the last feedback, to the right of the button.
    const time = screen.getByTestId("feedback-time");
    expect(time).toHaveTextContent(/^Last AI feedback: Oct 1[45], 2026/);
    expect(mentor.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Clear problem.")).toBeInTheDocument();
    // The answers on the page go with the request.
    expect(analyzeBodies).toEqual([
      { answers: expect.objectContaining({ problem_statement: "Cooking Korean food is intimidating." }) },
    ]);
  });

  it("asks to run the AI Mentor Agent and answer a question before giving feedback", async () => {
    renderPage(); // no agent run, no answers
    fireEvent.click(await screen.findByText("problem_definition"));
    await screen.findByTestId("agent-run-panel");
    const mentor = await screen.findByRole("button", { name: messages.Wizard.getFeedback });
    await waitFor(() => expect(screen.getByRole("button", { name: messages.AgentRun.run })).toBeEnabled());
    fireEvent.click(mentor);

    const prompts = await screen.findByTestId("feedback-prompts");
    expect(prompts).toHaveTextContent(messages.Wizard.feedbackNeedsAgent);
    expect(prompts).toHaveTextContent(messages.Wizard.feedbackNeedsAnswers);
    expect(within(prompts).getByRole("button", { name: messages.Wizard.goToAgent })).toBeInTheDocument();
    expect(analyzeBodies).toEqual([]); // nothing was sent
  });

  it("asks only for an answer once the agent has run", async () => {
    agentRun = FINISHED_RUN;
    renderPage();
    fireEvent.click(await screen.findByText("problem_definition"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: messages.AgentRun.runAgain })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: messages.Wizard.getFeedback }));

    const prompts = await screen.findByTestId("feedback-prompts");
    expect(prompts).toHaveTextContent(messages.Wizard.feedbackNeedsAnswers);
    expect(prompts).not.toHaveTextContent(messages.Wizard.feedbackNeedsAgent);
    expect(analyzeBodies).toEqual([]);
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
    expect(stage4).toHaveAttribute("title", "Complete stages 1, 2, 3 to unlock this stage.");
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

  it("colours stage names: dark grey not started, orange in progress", async () => {
    completeStageOne(); // completed
    stages.find((s) => s.slug === "problem_definition")!.status = "in_progress";
    stages.find((s) => s.slug === "customer_definition")!.status = "awaiting_user";
    stages.find((s) => s.slug === "value_proposition")!.status = "needs_revision";
    renderPage();
    await screen.findByText("Stage 2: problem_definition");

    const title = (slug: string) => screen.getByTestId(`stage-title-${slug}`);
    expect(title("existing_alternatives")).toHaveClass("text-gray-700"); // not started
    expect(title("customer_definition")).toHaveClass("text-orange-600");
    expect(title("value_proposition")).toHaveClass("text-orange-600");
    // In progress and current: orange underneath, bold blue highlight on top.
    expect(title("problem_definition")).toHaveClass(
      "text-orange-600",
      "group-aria-[current=step]:text-blue-700",
    );
    // Completed: neither grey nor orange.
    expect(title("idea_discovery")).not.toHaveClass("text-gray-700");
    expect(title("idea_discovery")).not.toHaveClass("text-orange-600");
  });

  it("shows Stage 6 locked until stages 1–5 are complete", async () => {
    completeStageOne();
    const market = stages.find((s) => s.slug === "market_evidence")!;
    market.implemented = true;
    market.locked = true;
    market.locked_by = [
      "idea_discovery",
      "problem_definition",
      "customer_definition",
      "existing_alternatives",
      "value_proposition",
    ];
    renderPage();
    await screen.findByText("Stage 2: problem_definition");

    const stage6 = screen.getByText("market_evidence").closest("button")!;
    expect(stage6).toBeDisabled();
    expect(stage6).toHaveTextContent(messages.Wizard.locked);
    expect(stage6).toHaveAttribute("title", "Complete stages 1, 2, 3, 4, 5 to unlock this stage.");
  });

  function unlockStageSix() {
    completeStagesOneToThree();
    for (const slug of ["existing_alternatives", "value_proposition"]) {
      stages.find((s) => s.slug === slug)!.status = "completed";
    }
    const market = stages.find((s) => s.slug === "market_evidence")!;
    market.implemented = true;
    market.locked = false;
    market.question_schema = {
      fields: [
        { name: "user_country", label_en: "Your country", label_ko: "?", type: "short" },
        { name: "user_metro_city", label_en: "Your metropolitan city", label_ko: "?", type: "short" },
        { name: "beachhead_segment", label_en: "Beachhead segment?", label_ko: "?", type: "text" },
        { name: "pricing_assumption", label_en: "Pricing?", label_ko: "?", type: "text" },
        { name: "market_takeaways", label_en: "Takeaways?", label_ko: "?", type: "text" },
      ],
    };
    return market;
  }

  it("pre-fills Stage 6 location from the account default and waits for Save location", async () => {
    const market = unlockStageSix();
    renderPage();

    expect(await screen.findByText("Stage 6: market_evidence")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Your country")).toHaveValue("South Korea"));
    expect(screen.getByLabelText("Your metropolitan city")).toHaveValue("Seoul");
    expect(screen.getByTestId("location-sources")).toHaveTextContent(
      "Country: from your account settings · City: from your account settings",
    );
    // The account already has a default, so it isn't offered again.
    expect(screen.getByLabelText(messages.Wizard.rememberLocation)).not.toBeChecked();
    // A pre-fill isn't researched until the founder confirms it.
    expect(screen.getByText(messages.MarketEvidence.locationNeeded)).toBeInTheDocument();
    expect(marketCalls).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: messages.Wizard.saveLocation }));

    await waitFor(() =>
      expect(market.answers).toMatchObject({ user_country: "South Korea", user_metro_city: "Seoul" }),
    );
    await waitFor(() => expect(marketCalls).toEqual([{ language: "en" }]));
    expect(preferenceUpdates).toEqual([]);
  });

  it("offers to remember the location when the account has no default", async () => {
    accountSession = { ...accountSession, default_country: null, default_metro_city: null };
    unlockStageSix();
    renderPage();

    await screen.findByText("Stage 6: market_evidence");
    await waitFor(() => expect(screen.getByLabelText(messages.Wizard.rememberLocation)).toBeChecked());
    fireEvent.change(screen.getByLabelText("Your country"), { target: { value: "Vietnam" } });
    fireEvent.change(screen.getByLabelText("Your metropolitan city"), { target: { value: "Hanoi" } });
    fireEvent.click(screen.getByRole("button", { name: messages.Wizard.saveLocation }));

    await waitFor(() =>
      expect(preferenceUpdates).toEqual([{ default_country: "Vietnam", default_metro_city: "Hanoi" }]),
    );
    expect(await screen.findByText(messages.Wizard.locationRemembered)).toBeInTheDocument();
  });

  function unlockStageSeven() {
    const market = unlockStageSix();
    market.status = "completed";
    const position = stages.find((s) => s.slug === "competitive_position")!;
    position.implemented = true;
    position.locked = false;
    position.status = "completed";
    position.question_schema = {
      fields: [
        { name: "chosen_positioning", label_en: "Your positioning statement", label_ko: "?", type: "text" },
        { name: "main_competitor_focus", label_en: "Which competitor first?", label_ko: "?", type: "text" },
        { name: "first_actions", label_en: "Which actions this week?", label_ko: "?", type: "text" },
      ],
    };
    position.answers = {
      chosen_positioning: "Skills, not kits",
      main_competitor_focus: "",
      first_actions: "",
      completed_actions: ["a-interview"],
    };
    const action = (id: string, title: string) => ({
      id,
      title,
      why: "Because.",
      steps: ["Do it."],
      priority: "high",
      timeframe: "this_week",
      success_metric: "Done.",
    });
    position.ai_analysis = {
      kind: "competitive_position",
      summary: "Own the beginner niche.",
      positioning_statement: "For busy families, the guided cooking coach.",
      target_segment: "Busy families",
      market_category: "Guided cooking",
      competitor_comparison: [],
      differentiators: [],
      risks: [],
      defensibility: "Community.",
      action_items: [action("a-interview", "Interview cancellers"), action("a-landing", "Publish a landing page")],
      confidence: 0.5,
      sources: [],
      researched_at: "2026-10-12T09:00:00Z",
      based_on: null,
      language: "en",
    } as WizardStageStatus["ai_analysis"];
    return position;
  }

  function lastPut(slug: string) {
    const calls = vi.mocked(fetch).mock.calls.filter(
      ([url, init]) => init?.method === "PUT" && String(url).endsWith(`/stages/${slug}`),
    );
    return calls.length ? JSON.parse(calls[calls.length - 1][1]!.body as string) : null;
  }

  it("shows Stage 7's action items and saves a tick with the saved answers", async () => {
    unlockStageSeven();
    stages.find((s) => s.slug === "competitive_position")!.status = "awaiting_user";
    renderPage();

    expect(await screen.findByText("Stage 8: competitive_position")).toBeInTheDocument();
    expect(screen.getByText("For busy families, the guided cooking coach.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Interview cancellers" })).toBeChecked();
    expect(screen.getByTestId("actions-progress")).toHaveTextContent("1 of 2 done");

    // Unsaved typing isn't sent with a tick: a tick is progress, not an edit.
    fireEvent.change(screen.getByLabelText("Which actions this week?"), { target: { value: "Typing..." } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Publish a landing page" }));

    await waitFor(() =>
      expect(lastPut("competitive_position")).toEqual({
        answers: {
          chosen_positioning: "Skills, not kits",
          main_competitor_focus: "",
          first_actions: "",
          completed_actions: ["a-interview", "a-landing"],
        },
        complete: false,
      }),
    );
    expect(screen.getByTestId("actions-progress")).toHaveTextContent("2 of 2 done");
    // Stage 7 isn't a generic-feedback stage.
    expect(screen.queryByRole("button", { name: messages.Wizard.getFeedback })).not.toBeInTheDocument();
  });

  it("keeps Stage 7's ticks when its answers are autosaved", async () => {
    unlockStageSeven();
    stages.find((s) => s.slug === "competitive_position")!.status = "in_progress";
    renderPage();

    const field = await screen.findByLabelText("Which competitor first?");
    fireEvent.change(field, { target: { value: "HelloFresh" } });
    fireEvent.blur(field);

    await waitFor(() =>
      expect(lastPut("competitive_position")?.answers).toMatchObject({
        main_competitor_focus: "HelloFresh",
        completed_actions: ["a-interview"],
      }),
    );
  });

  it("shows Stage 8's DFV scorecard and saves its action ticks", async () => {
    unlockStageSeven();
    const dfv = stages.find((s) => s.slug === "dfv_assessment")!;
    dfv.implemented = true;
    dfv.locked = false;
    dfv.status = "awaiting_user";
    dfv.question_schema = {
      fields: [
        { name: "biggest_risk", label_en: "Biggest risk?", label_ko: "?", type: "text" },
        { name: "evidence_plan", label_en: "Evidence plan?", label_ko: "?", type: "text" },
        { name: "assessment_reflection", label_en: "Agree?", label_ko: "?", type: "text" },
      ],
    };
    dfv.answers = { biggest_risk: "Viability", evidence_plan: "", assessment_reflection: "", completed_actions: [] };
    const rate = (criterion: string) => ({
      criterion,
      rating: "moderate",
      reason: "Some evidence.",
      evidence: "Stage 6.",
      evidence_stage: "market_evidence",
      evidence_gap: null,
    });
    dfv.ai_analysis = {
      kind: "dfv_assessment",
      summary: "Promising but unproven.",
      scores: { desirability: 60, feasibility: 60, viability: 60, overall: 60 },
      verdict: "strengthen",
      dimensions: {
        desirability: ["problem_severity", "demand_evidence", "willingness_to_pay", "differentiation_appeal"].map(rate),
        feasibility: ["technical_complexity", "resources_and_team", "regulatory_barriers", "time_to_market"].map(rate),
        viability: ["market_size", "revenue_model", "unit_economics", "defensibility"].map(rate),
      },
      assumptions_to_test: [],
      action_items: [
        {
          id: "d-price",
          title: "Run a pricing test",
          why: "Unproven.",
          steps: ["Do it."],
          priority: "high",
          timeframe: "this_week",
          success_metric: "20 sign-ups.",
          dimension: "desirability",
          criterion: "willingness_to_pay",
        },
      ],
      confidence: 0.5,
      sources: [],
      researched_at: "2026-10-12T09:00:00Z",
      based_on: null,
      language: "en",
    } as WizardStageStatus["ai_analysis"];
    renderPage();

    expect(await screen.findByText("Stage 9: dfv_assessment")).toBeInTheDocument();
    expect(screen.getByTestId("dfv-verdict")).toHaveTextContent(messages.DfvAssessment.verdicts.strengthen.title);
    fireEvent.click(screen.getByRole("checkbox", { name: "Run a pricing test" }));

    await waitFor(() =>
      expect(lastPut("dfv_assessment")).toEqual({
        answers: { biggest_risk: "Viability", evidence_plan: "", assessment_reflection: "", completed_actions: ["d-price"] },
        complete: false,
      }),
    );
    expect(screen.queryByRole("button", { name: messages.Wizard.getFeedback })).not.toBeInTheDocument();
  });

  it("shows Stage 9's business model and saves its things-to-complete ticks", async () => {
    // Earlier stages complete so the wizard lands on Stage 9.
    unlockStageSeven();
    const dfv = stages.find((s) => s.slug === "dfv_assessment")!;
    Object.assign(dfv, { implemented: true, locked: false, status: "completed" });
    const business = stages.find((s) => s.slug === "business_model")!;
    business.implemented = true;
    business.locked = false;
    business.status = "awaiting_user";
    business.question_schema = {
      fields: [
        { name: "model_adjustments", label_en: "Changes?", label_ko: "?", type: "text" },
        { name: "launch_price", label_en: "Launch price?", label_ko: "?", type: "text" },
        { name: "first_customers_plan", label_en: "First customers?", label_ko: "?", type: "text" },
      ],
    };
    business.answers = { model_adjustments: "", launch_price: "$10", first_customers_plan: "", completed_actions: [] };
    const blocks = [
      "customer_segments",
      "value_propositions",
      "channels",
      "customer_relationships",
      "revenue_streams",
      "key_resources",
      "key_activities",
      "key_partnerships",
      "cost_structure",
    ];
    const input = (value: number) => ({
      value,
      unit: "USD",
      explanation: "Estimate.",
      year: null,
      is_estimate: true,
      source_title: null,
      source_url: null,
      source_verified: false,
      search_url: null,
    });
    business.ai_analysis = {
      kind: "business_model",
      summary: "Subscription first.",
      model_name: "Guided cooking subscription",
      model_type: "subscription",
      why_this_model: [{ reason: "Recurring habit.", evidence_stage: "customer_definition" }],
      alternatives_considered: [],
      canvas: Object.fromEntries(blocks.map((block) => [block, [`${block} item`]])),
      pricing: { strategy: "Low entry.", tiers: [{ name: "Basic", price: "$10", includes: [], target_customer: "All" }] },
      unit_economics: {
        currency: "USD",
        inputs: {
          monthly_revenue_per_customer: input(12),
          monthly_cost_to_serve: input(3),
          customer_acquisition_cost: input(60),
          monthly_churn_rate: input(0.05),
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
      launch_kpis: [],
      key_risks: [],
      things_to_complete: [
        {
          id: "b-price",
          title: "Validate the entry price",
          why: "Estimate.",
          steps: ["Test it."],
          priority: "high",
          timeframe: "this_week",
          success_metric: "20 sign-ups.",
          area: "finances",
        },
      ],
      confidence: 0.5,
      sources: [],
      researched_at: "2026-10-12T09:00:00Z",
      based_on: null,
      language: "en",
    } as unknown as WizardStageStatus["ai_analysis"];
    renderPage();

    expect(await screen.findByText("Stage 11: business_model")).toBeInTheDocument();
    expect(screen.getByTestId("recommended-model")).toHaveTextContent("Guided cooking subscription");
    fireEvent.click(screen.getByRole("checkbox", { name: "Validate the entry price" }));

    await waitFor(() =>
      expect(lastPut("business_model")).toEqual({
        answers: { model_adjustments: "", launch_price: "$10", first_customers_plan: "", completed_actions: ["b-price"] },
        complete: false,
      }),
    );
  });

  it("saves Stage 9's offering type and keeps it when answers autosave", async () => {
    // Earlier stages complete so the wizard lands on Stage 9.
    unlockStageSeven();
    for (const slug of ["dfv_assessment", "mvp"]) {
      Object.assign(stages.find((s) => s.slug === slug)!, { implemented: true, locked: false, status: "completed" });
    }
    const mvp = stages.find((s) => s.slug === "mvp")!;
    mvp.status = "awaiting_user";
    mvp.question_schema = {
      fields: [
        { name: "mvp_scope_changes", label_en: "Scope changes?", label_ko: "?", type: "text" },
        { name: "build_plan", label_en: "Build plan?", label_ko: "?", type: "text" },
        { name: "test_plan", label_en: "Test plan?", label_ko: "?", type: "text" },
      ],
    };
    mvp.answers = { mvp_scope_changes: "", build_plan: "", test_plan: "", offering_type: "" };
    mvp.ai_analysis = {
      kind: "mvp",
      offering_type: "offline_service",
      offering_type_reason: "Delivered in person.",
      offering_type_source: "ai",
      name: "Kimchi Classes",
      tagline: "Learn in a weekend.",
      summary: "Cooking classes.",
      target_user: "Families",
      problem_solved: "Intimidating recipes.",
      core_features: [{ feature: "Small groups", why: "Hands-on." }],
      left_out_for_now: [],
      how_to_test: ["Run one class."],
      physical_product: null,
      website_mockup: null,
      offline_service: {
        overview: "Weekend classes.",
        customer_journey: [
          { step: "Book", what_happens: "Online." },
          { step: "Cook", what_happens: "With a chef." },
        ],
        delivery: { where: "Kitchens", who_delivers: "Chefs", when: "Weekends" },
        what_customer_gets: [],
        resources_needed: [],
        pricing_note: "$40.",
      },
      image: null,
      image_failed: false,
      confidence: 0.5,
      sources: [],
      researched_at: "2026-10-13T09:00:00Z",
      based_on: null,
      language: "en",
    } as unknown as WizardStageStatus["ai_analysis"];
    renderPage();

    expect(await screen.findByText("Stage 10: mvp")).toBeInTheDocument();
    expect(screen.getByTestId("mvp-service")).toHaveTextContent("Weekend classes.");
    fireEvent.click(screen.getByRole("radio", { name: messages.Mvp.offeringTypes.physical_product }));

    await waitFor(() =>
      expect(lastPut("mvp")).toEqual({
        answers: { mvp_scope_changes: "", build_plan: "", test_plan: "", offering_type: "physical_product" },
        complete: false,
      }),
    );

    const field = screen.getByLabelText("Build plan?");
    fireEvent.change(field, { target: { value: "3D print a jar" } });
    fireEvent.blur(field);
    await waitFor(() =>
      expect(lastPut("mvp")?.answers).toEqual({
        mvp_scope_changes: "",
        build_plan: "3D print a jar",
        test_plan: "",
        offering_type: "physical_product",
      }),
    );
  });

  it("records a Stage 11 experiment result with the saved answers", async () => {
    // Earlier stages complete so the wizard lands on Stage 11.
    unlockStageSeven();
    for (const slug of ["dfv_assessment", "mvp", "business_model"]) {
      Object.assign(stages.find((s) => s.slug === slug)!, { implemented: true, locked: false, status: "completed" });
    }
    const validation = stages.find((s) => s.slug === "validation_plan")!;
    Object.assign(validation, { implemented: true, locked: false, status: "awaiting_user" });
    validation.question_schema = {
      fields: [
        { name: "riskiest_assumption", label_en: "Riskiest?", label_ko: "?", type: "text" },
        { name: "validation_budget", label_en: "Budget?", label_ko: "?", type: "text" },
        { name: "learnings", label_en: "Learnings?", label_ko: "?", type: "text" },
      ],
    };
    validation.answers = {
      riskiest_assumption: "Demand",
      validation_budget: "",
      learnings: "",
      experiment_results: { "e-old": { value: 1, notes: "" } },
      experiment_outcomes: { "e-interviews": "not_run" },
      decision_signal: "not_started",
    };
    validation.ai_analysis = {
      kind: "validation_plan",
      summary: "Test demand first.",
      prerequisite_fixes: [],
      assumptions: [{ assumption: "Demand.", dimension: "desirability", risk: "high", source_stage: "dfv_assessment" }],
      experiments: [
        {
          id: "e-interviews",
          title: "Run 10 problem interviews",
          assumption_tested: "Demand.",
          method_type: "interviews",
          method: "Talk.",
          participants: "Landlords",
          sample_size: 10,
          metric: "yes answers",
          unit: "landlords",
          comparator: "at_least",
          pass_threshold: 6,
          fail_threshold: 3,
          critical: true,
          phase: 1,
          duration_weeks: 2,
          cost_estimate: "Low",
          owner: "Founder",
        },
      ],
      decision_rules: { proceed_if: "Pass.", narrow_or_pivot_if: "Mixed.", stop_if: "Fail." },
      ethics_and_legal: [],
      confidence: 0.5,
      sources: [],
      researched_at: "2026-10-13T09:00:00Z",
      based_on: null,
      language: "en",
    } as unknown as WizardStageStatus["ai_analysis"];
    renderPage();

    expect(await screen.findByText("Stage 12: validation_plan")).toBeInTheDocument();
    const card = screen.getByTestId("experiment-e-interviews");
    fireEvent.change(within(card).getByLabelText("Result (landlords)"), { target: { value: "7" } });
    fireEvent.click(within(card).getByRole("button", { name: messages.ValidationPlan.saveResult }));

    await waitFor(() =>
      expect(lastPut("validation_plan")).toEqual({
        answers: {
          riskiest_assumption: "Demand",
          validation_budget: "",
          learnings: "",
          experiment_results: { "e-old": { value: 1, notes: "" }, "e-interviews": { value: 7, notes: "" } },
          experiment_outcomes: { "e-interviews": "not_run" },
          decision_signal: "not_started",
        },
        complete: false,
      }),
    );
  });

  it("saves Stage 12 inputs with the saved answers", async () => {
    // Earlier stages complete so the wizard lands on Stage 12.
    unlockStageSeven();
    for (const slug of ["dfv_assessment", "mvp", "business_model", "validation_plan"]) {
      Object.assign(stages.find((s) => s.slug === slug)!, { implemented: true, locked: false, status: "completed" });
    }
    const financials = stages.find((s) => s.slug === "financial_analysis")!;
    Object.assign(financials, { implemented: true, locked: false, status: "awaiting_user" });
    financials.question_schema = {
      fields: [
        { name: "funding_plan", label_en: "Funding plan?", label_ko: "?", type: "text" },
        { name: "biggest_cost_risk", label_en: "Cost risk?", label_ko: "?", type: "text" },
        { name: "financial_takeaways", label_en: "Takeaways?", label_ko: "?", type: "text" },
      ],
    };
    const inputs = {
      currency: "USD",
      revenue_drivers: Object.fromEntries(
        [
          "monthly_price_per_customer",
          "starting_customers",
          "new_customers_month_1",
          "monthly_growth_rate_new_customers",
          "monthly_churn_rate",
          "variable_cost_per_customer",
          "customer_acquisition_cost",
        ].map((name) => [name, { value: name.includes("rate") ? 0.05 : 10, explanation: "", is_estimate: true }]),
      ),
      fixed_costs: [{ name: "Salary", category: "salaries", monthly_amount: 3000, start_month: 1, note: "" }],
      operating_costs: [],
      one_time_costs: [],
      funding: { starting_cash: 10000, planned_raise_amount: 0, planned_raise_month: null },
      tax_rate: 0.1,
      discount_rate_annual: 0.1,
    };
    financials.answers = {
      funding_plan: "Savings",
      biggest_cost_risk: "",
      financial_takeaways: "",
      financial_inputs: inputs,
      inputs_source: "ai_draft",
      projection: null,
    };
    financials.ai_analysis = {
      kind: "financial_analysis",
      summary: "Lean start.",
      assumption_notes: [],
      inputs,
      confidence: 0.5,
      sources: [],
      researched_at: "2026-10-13T09:00:00Z",
      based_on: null,
      language: "en",
    } as unknown as WizardStageStatus["ai_analysis"];
    renderPage();

    expect(await screen.findByText("Stage 13: financial_analysis")).toBeInTheDocument();
    const fixed = screen.getByTestId("fixed-costs");
    fireEvent.change(within(fixed).getByLabelText(`${messages.FinancialAnalysis.columns.monthlyAmount} 1`), {
      target: { value: "3500" },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.FinancialAnalysis.save }));

    await waitFor(() => expect(lastPut("financial_analysis")?.answers.financial_inputs.fixed_costs[0].monthly_amount).toBe(3500));
    expect(lastPut("financial_analysis").answers.funding_plan).toBe("Savings");
    expect(lastPut("financial_analysis").complete).toBe(false);
  });

  function koreanAlternatives() {
    completeStagesOneToThree();
    const alternatives = stages.find((s) => s.slug === "existing_alternatives")!;
    alternatives.status = "awaiting_user";
    alternatives.answers = { current_solutions: "", why_switch: "", biggest_threat: "" };
    alternatives.ai_analysis = {
      ...FAKE_ALTERNATIVES,
      summary: "한국어로 작성된 요약입니다.",
      language: "ko",
    } as WizardStageStatus["ai_analysis"];
    return alternatives;
  }

  it("translates AI content written in another language, with the original a click away", async () => {
    koreanAlternatives();
    translatedReply = { ...FAKE_ALTERNATIVES, summary: "A summary written in Korean.", language: "en", translated_from: "ko" };
    renderPage();

    expect(await screen.findByText("A summary written in Korean.")).toBeInTheDocument();
    expect(translateCalls).toEqual([
      { url: expect.stringContaining("/stages/existing_alternatives/translate"), body: { language: "en" } },
    ]);
    const notice = screen.getByTestId("translation-notice");
    expect(notice).toHaveTextContent("written in Korean and translated by AI");

    fireEvent.click(within(notice).getByRole("button", { name: "Show original (Korean)" }));
    expect(await screen.findByText("한국어로 작성된 요약입니다.")).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("translation-notice")).getByRole("button", { name: "Show in English" }));
    expect(await screen.findByText("A summary written in Korean.")).toBeInTheDocument();
    expect(translateCalls).toHaveLength(1);
  });

  it("uses a cached translation without asking again", async () => {
    const alternatives = koreanAlternatives();
    (alternatives.ai_analysis as unknown as Record<string, unknown>).translations = {
      en: { ...FAKE_ALTERNATIVES, summary: "Cached English summary.", language: "en", translation_version: 2 },
    };
    renderPage();

    expect(await screen.findByText("Cached English summary.")).toBeInTheDocument();
    expect(translateCalls).toEqual([]);
  });

  it("shows the original when translation fails, with a retry", async () => {
    koreanAlternatives();
    renderPage();

    expect(await screen.findByText("한국어로 작성된 요약입니다.")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("translation-notice")).toHaveTextContent("Couldn't translate the AI content"),
    );
    translatedReply = { ...FAKE_ALTERNATIVES, summary: "Translated on retry.", language: "en" };
    fireEvent.click(within(screen.getByTestId("translation-notice")).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Translated on retry.")).toBeInTheDocument();
  });

  it("doesn't translate content already in the selected language", async () => {
    completeStagesOneToThree();
    const alternatives = stages.find((s) => s.slug === "existing_alternatives")!;
    alternatives.status = "awaiting_user";
    alternatives.ai_analysis = FAKE_ALTERNATIVES as WizardStageStatus["ai_analysis"];
    renderPage();

    expect(await screen.findByText(FAKE_ALTERNATIVES.summary)).toBeInTheDocument();
    expect(screen.queryByTestId("translation-notice")).not.toBeInTheDocument();
    expect(translateCalls).toEqual([]);
  });

  it("counts a stage's AI content as half of its completion", async () => {
    completeStagesOneToThree();
    const alternatives = stages.find((s) => s.slug === "existing_alternatives")!;
    alternatives.status = "awaiting_user";
    alternatives.ai_analysis = FAKE_ALTERNATIVES as WizardStageStatus["ai_analysis"];
    alternatives.answers = { current_solutions: "Spreadsheets", why_switch: "", biggest_threat: "" };
    renderPage();

    // AI research 50% + 1 of 3 questions x 50% = 66.7 -> 67.
    expect(
      await screen.findByRole("progressbar", { name: "existing_alternatives completion" }),
    ).toHaveAttribute("aria-valuenow", "67");
  });

  it("saves Stage 7 personas with the stage's other answers", async () => {
    // Earlier stages complete so the wizard lands on Stage 7.
    completeStagesOneToThree();
    for (const slug of ["existing_alternatives", "value_proposition", "market_evidence"]) {
      Object.assign(stages.find((s) => s.slug === slug)!, { implemented: true, locked: false, status: "completed" });
    }
    const personas = stages.find((s) => s.slug === "persona_validation")!;
    Object.assign(personas, { implemented: true, locked: false, status: "in_progress" });
    personas.question_schema = {
      fields: [
        { name: "validation_takeaways", label_en: "Takeaways?", label_ko: "?", type: "text" },
        { name: "next_real_test", label_en: "Next real test?", label_ko: "?", type: "text" },
      ],
    };
    personas.answers = { validation_takeaways: "Price matters", next_real_test: "", personas: [] };
    renderPage();

    expect(await screen.findByText("Stage 7: persona_validation")).toBeInTheDocument();
    const card = screen.getByTestId("persona-card-0");
    fireEvent.change(within(card).getByLabelText(messages.PersonaValidation.fields.name), { target: { value: "Landlord" } });
    fireEvent.click(screen.getByRole("button", { name: messages.PersonaValidation.savePersonas }));

    await waitFor(() => expect(lastPut("persona_validation")?.answers.personas[0].name).toBe("Landlord"));
    expect(lastPut("persona_validation").answers.validation_takeaways).toBe("Price matters");
    expect(lastPut("persona_validation").complete).toBe(false);
  });

  it("shows each stage's icon between its number and title", async () => {
    renderPage();
    await screen.findByText("Stage 1: idea_discovery");

    for (const stage of stages) {
      const title = screen.getByTestId(`stage-title-${stage.slug}`);
      const icon = screen.getByTestId(`stage-icon-${stage.slug}`);
      const row = title.parentElement!;
      const number = within(row).getByText(`${stage.number}.`);
      expect(icon).toHaveAttribute("aria-hidden", "true");
      // Number, then icon, then title.
      expect(number.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(icon.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // Each stage has its own icon, in its own colour.
    const badge = (slug: string) => screen.getByTestId(`stage-icon-${slug}`);
    const kinds = new Set(stages.map((stage) => badge(stage.slug).querySelector("svg")?.getAttribute("class")?.match(/lucide-[a-z-]+/)?.[0]));
    expect(kinds.size).toBe(stages.length);
    const colours = new Set(stages.map((stage) => badge(stage.slug).className.match(/bg-[a-z]+-100/)?.[0]));
    expect(colours.size).toBe(stages.length);
    expect([...colours]).not.toContain(undefined);
  });

  it("shows the current stage's number, icon and title larger", async () => {
    renderPage();
    const title = await screen.findByTestId("stage-title-idea_discovery");
    const button = title.closest("button")!;
    expect(button).toHaveAttribute("aria-current", "step");
    // Sizes switch on the current stage (aria-current) via group variants.
    expect(badgeOf("idea_discovery")).toHaveClass("size-6", "group-aria-[current=step]:size-9");
    expect(badgeOf("idea_discovery").querySelector("svg")).toHaveClass("size-3.5", "group-aria-[current=step]:size-5");
    expect(title).toHaveClass("group-aria-[current=step]:text-base");
    expect(within(button).getByText("1.")).toHaveClass("group-aria-[current=step]:text-lg");
    // Other stages aren't current, so they keep the normal sizes.
    expect(screen.getByTestId("stage-title-problem_definition").closest("button")).not.toHaveAttribute("aria-current");
  });

  it("shows no time for older feedback saved without one", async () => {
    completeStageOne();
    stages.find((s) => s.slug === "problem_definition")!.ai_analysis = {
      summary: "Older feedback.",
      strengths: [],
      gaps: [],
      suggested_next_steps: [],
      confidence: 0.5,
    };
    renderPage();

    expect(await screen.findByText("Older feedback.")).toBeInTheDocument();
    expect(screen.queryByTestId("feedback-time")).not.toBeInTheDocument();
  });

  it("chains every stage number in order under the title, highlighting the current one", async () => {
    completeStageOne();
    renderPage();
    await screen.findByText("Stage 2: problem_definition");

    const chain = screen.getByTestId("stage-chain");
    // Right under the program name and the idea's title.
    expect(screen.getByTestId("venture-idea").compareDocumentPosition(chain) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const bubbles = within(chain).getAllByRole("button");
    expect(bubbles.map((b) => b.textContent)).toEqual(Array.from({ length: 15 }, (_, i) => String(i + 1)));
    expect(within(chain).getAllByRole("button", { current: "step" })).toEqual([screen.getByTestId("chain-stage-2")]);
    expect(screen.getByTestId("chain-stage-2")).toHaveClass("bg-blue-600", "text-white");
    expect(screen.getByTestId("chain-stage-1")).toHaveClass("border-green-600"); // completed
    expect(screen.getByTestId("chain-stage-4")).toBeDisabled(); // locked
    // Locked stages show a padlock with the stage number on it, and say what unlocks them.
    expect(screen.getByTestId("chain-lock-4")).toBeInTheDocument();
    expect(screen.getByTestId("chain-stage-4")).toHaveTextContent("4");
    expect(screen.getByTestId("chain-stage-4")).toHaveAttribute(
      "title",
      "To unlock 4. existing_alternatives, first complete: 1. idea_discovery, 2. problem_definition, 3. customer_definition",
    );
    expect(screen.getByTestId("chain-stage-4")).toHaveAccessibleName("4. existing_alternatives");
    expect(screen.queryByTestId("chain-lock-3")).not.toBeInTheDocument();
    expect(screen.getByTestId("chain-stage-3")).toHaveTextContent("3");
    expect(screen.getByTestId("chain-stage-2")).toHaveAccessibleName("2. problem_definition");

    // Clicking a bubble opens its stage, and the highlight follows.
    fireEvent.click(screen.getByTestId("chain-stage-3"));
    expect(await screen.findByText("Stage 3: customer_definition")).toBeInTheDocument();
    expect(within(chain).getByRole("button", { current: "step" })).toHaveTextContent("3");
  });

  it("keeps the title and stage chain pinned while the content below scrolls", async () => {
    renderPage();
    await screen.findByText("Stage 1: idea_discovery");

    const top = screen.getByTestId("wizard-top");
    expect(top).toHaveClass("sticky", "top-0");
    // Pinned: the program name, the idea's title and the stage chain.
    expect(within(top).getByText(messages.Wizard.pageTitle)).toBeInTheDocument();
    expect(within(top).getByTestId("venture-idea")).toBeInTheDocument();
    expect(within(top).getByTestId("stage-chain")).toBeInTheDocument();
    // Scrolls underneath: the stage list and the stage's content.
    const content = screen.getByTestId("wizard-content");
    expect(top).not.toContainElement(content);
    expect(content).toContainElement(screen.getByTestId("stage-title-idea_discovery"));
    expect(content).toHaveTextContent("Stage 1: idea_discovery");
  });
});

describe("Stage AI agent", () => {
  it("offers the agent on Stage 4 and fills the form with its drafts, unsaved", async () => {
    completeStagesOneToThree();
    const alternatives = stages.find((s) => s.slug === "existing_alternatives")!;
    alternatives.status = "awaiting_user";
    alternatives.ai_analysis = FAKE_ALTERNATIVES as WizardStageStatus["ai_analysis"];
    alternatives.answers = { current_solutions: "", why_switch: "Typed already", biggest_threat: "" };
    agentRun = {
      id: "run-1",
      stage_slug: "existing_alternatives",
      status: "succeeded",
      language: "en",
      model_turns: 3,
      web_searches: 2,
      tokens_used: 900,
      pending_question: null,
      proposed_answers: { current_solutions: "Meal kits.", why_switch: "", biggest_threat: "Big kit brands." },
      error: null,
      created_at: "2026-10-14T09:00:00Z",
      finished_at: "2026-10-14T09:02:00Z",
      steps: [],
    };
    renderPage();

    const panel = await screen.findByTestId("agent-run-panel");
    expect(await within(panel).findByRole("button", { name: messages.AgentRun.runAgain })).toBeInTheDocument();
    fireEvent.click(await within(panel).findByRole("button", { name: messages.AgentRun.useAnswers }));

    expect(screen.getByLabelText(ALTERNATIVES_FIELDS.fields[0].label_en)).toHaveValue("Meal kits.");
    expect(screen.getByLabelText(ALTERNATIVES_FIELDS.fields[1].label_en)).toHaveValue("Typed already");
    expect(screen.getByLabelText(ALTERNATIVES_FIELDS.fields[2].label_en)).toHaveValue("Big kit brands.");
  });

  it("is offered on feedback stages too, e.g. Stage 2", async () => {
    completeStageOne();
    renderPage();
    expect(await screen.findByText(/Stage 2:/)).toBeInTheDocument();
    expect(await screen.findByTestId("agent-run-panel")).toBeInTheDocument();
  });
});

describe("Next stage button", () => {
  it("sits right of the title and percentage, and opens the next stage", async () => {
    completeStageOne();
    renderPage();
    expect(await screen.findByText("Stage 2: problem_definition")).toBeInTheDocument();

    const next = screen.getByTestId("next-stage");
    expect(next).toHaveTextContent(messages.Wizard.nextStage);
    expect(next).toHaveAccessibleName("Next: Stage 3. customer_definition");
    // Same title row, after the title and the % complete.
    const title = screen.getByText("Stage 2: problem_definition");
    const percent = screen.getByText(/% complete/);
    expect(title.compareDocumentPosition(percent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(percent.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(next);
    expect(await screen.findByText("Stage 3: customer_definition")).toBeInTheDocument();
  });

  it("is hidden when the next stage is locked", async () => {
    completeStageOne();
    renderPage();
    await screen.findByText("Stage 2: problem_definition");
    fireEvent.click(screen.getByTestId("next-stage")); // to Stage 3; Stage 4 is locked
    expect(await screen.findByText("Stage 3: customer_definition")).toBeInTheDocument();
    expect(screen.queryByTestId("next-stage")).not.toBeInTheDocument();
  });
});

describe("Opening a stage from a link", () => {
  it("opens the stage named in ?stage=", async () => {
    completeStageOne();
    searchParams = new URLSearchParams("stage=customer_definition");
    renderPage();
    expect(await screen.findByText("Stage 3: customer_definition")).toBeInTheDocument();
  });

  it("falls back to the first open stage when the requested one is locked", async () => {
    completeStageOne();
    searchParams = new URLSearchParams("stage=existing_alternatives"); // locked in this fixture
    renderPage();
    expect(await screen.findByText("Stage 2: problem_definition")).toBeInTheDocument();
  });
});
