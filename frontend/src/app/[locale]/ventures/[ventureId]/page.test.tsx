import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function baseStages(): WizardStageStatus[] {
  const slugs: [string, boolean, unknown][] = [
    ["idea_discovery", false, null],
    ["problem_definition", true, PROBLEM_FIELDS],
    ["customer_definition", true, { fields: [] }],
    ["existing_alternatives", false, null],
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

beforeEach(() => {
  stages = baseStages();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
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
  it("renders 11 stages with 3 implemented and 8 disabled", async () => {
    renderPage();

    const buttons = await screen.findAllByRole("button");
    const stageButtons = buttons.filter((b) => b.textContent?.includes("_"));
    expect(stageButtons).toHaveLength(11);
    const enabled = stageButtons.filter((b) => !b.hasAttribute("disabled"));
    expect(enabled).toHaveLength(3);
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
    const valueProp = stages.find((s) => s.slug === "value_proposition")!;
    valueProp.status = "needs_revision";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(stages)));

    renderPage();

    fireEvent.click(await screen.findByText("value_proposition"));
    expect(await screen.findByText(messages.Wizard.revisionBanner)).toBeInTheDocument();
  });
});
