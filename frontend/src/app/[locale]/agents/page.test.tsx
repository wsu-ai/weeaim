import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../../../../messages/en.json";
import ko from "../../../../messages/ko.json";
import type { VentureAgent } from "@/lib/api";
import { renderWithProviders, stubApi } from "@/test/auth-helpers";
import MyAgentsPage from "./page";

vi.mock("@/i18n/navigation", async () => (await import("@/test/auth-helpers")).navigationMock);

const A = en.Agents;
const SLUGS = [
  "idea_discovery",
  "problem_definition",
  "customer_definition",
  "existing_alternatives",
  "value_proposition",
  "market_evidence",
  "persona_validation",
  "competitive_position",
  "dfv_assessment",
  "mvp",
  "business_model",
  "validation_plan",
  "financial_analysis",
  "marketing_plan",
  "decision_roadmap",
];

function venture(id: string, title: string) {
  return {
    id,
    organization_id: "o1",
    title,
    original_idea: title,
    current_idea_statement: null,
    status: "active",
    current_wizard_stage: "idea_discovery",
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-02T09:00:00Z",
    completed_stages: 0,
    total_stages: 15,
    feasibility_score: null,
    researched_at: null,
    can_delete: true,
  };
}

function agents(overrides: Record<string, Partial<VentureAgent>> = {}): VentureAgent[] {
  return SLUGS.map((slug, i) => ({
    stage_number: i + 1,
    slug,
    title_en: slug,
    title_ko: slug,
    available: slug !== "decision_roadmap",
    locked_by: [],
    runs: 0,
    total_active_ms: 0,
    total_tokens: 0,
    latest: null,
    ...overrides[slug],
  }));
}

const RUNNING = {
  latest: { id: "run-1", status: "running" as const, error: null, pending_question: null, created_at: "2026-10-16T09:00:00Z" },
  runs: 2,
  total_active_ms: 83_000,
  total_tokens: 12_345,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function row(stage: number): HTMLElement {
  return screen.getByTestId(`agent-row-${stage}`);
}

describe("MyAgentsPage", () => {
  it("lists all 15 agents for the most recent venture with time, runs and tokens", async () => {
    stubApi({
      "/api/ventures/v1/agents": {
        body: agents({
          idea_discovery: RUNNING,
          existing_alternatives: { locked_by: ["problem_definition", "customer_definition"] },
          dfv_assessment: {
            runs: 1,
            total_active_ms: 3_700_000,
            latest: { id: "r9", status: "failed", error: "limit_reached", pending_question: null, created_at: "2026-10-15T09:00:00Z" },
          },
        }),
      },
      "/api/ventures": { body: [venture("v1", "Korean Recipes"), venture("v2", "Pet Sitter")] },
    });
    renderWithProviders(<MyAgentsPage />);

    const table = await screen.findByTestId("agents-table");
    expect(within(table).getAllByRole("row")).toHaveLength(16); // header + 15
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      A.columns.stage, A.columns.agent, A.columns.status, A.columns.duration, A.columns.runs, A.columns.tokens, A.columns.actions,
    ]);

    const first = row(1);
    expect(first).toHaveTextContent("Idea Scout");
    expect(first).toHaveTextContent(A.status.running);
    expect(first).toHaveTextContent("1m 23s");
    expect(first).toHaveTextContent("12,345");
    expect(within(first).getByRole("button", { name: "Stop Idea Scout" })).toBeEnabled();
    expect(within(first).getByRole("button", { name: "Pause Idea Scout" })).toBeEnabled();

    const locked = row(4);
    expect(locked).toHaveTextContent(A.status.locked);
    expect(within(locked).getByText(A.status.locked).closest("span")).toHaveAttribute(
      "title",
      "Complete stages 2, 3 to unlock this agent.",
    );
    expect(within(locked).getByRole("button", { name: "Re-run Competitor Researcher" })).toBeDisabled();

    expect(row(9)).toHaveTextContent("1h 1m");
    expect(row(9)).toHaveTextContent(A.reasons.limit_reached);
    expect(row(15)).toHaveTextContent(A.status.not_built);
    expect(within(row(15)).getByRole("button", { name: "Re-run Decision Agent" })).toBeDisabled();
    expect(within(row(2)).getByRole("button", { name: "Stop Problem Analyst" })).toBeDisabled();
  });

  it("links each open stage's number to that stage of the venture", async () => {
    stubApi({
      "/api/ventures/v1/agents": {
        body: agents({ existing_alternatives: { locked_by: ["problem_definition"] } }),
      },
      "/api/ventures": { body: [venture("v1", "Korean Recipes")] },
    });
    renderWithProviders(<MyAgentsPage />);
    await screen.findByTestId("agents-table");

    const stage2 = within(row(2)).getByRole("link", { name: "Open Stage 2: problem_definition" });
    expect(stage2).toHaveAttribute("href", "/ventures/v1?stage=problem_definition");
    expect(stage2).toHaveTextContent("2");
    expect(stage2).toHaveClass("rounded-full", "bg-blue-600", "text-white"); // blue oval
    const lockedOval = (row(4) as HTMLTableRowElement).cells[0].querySelector("span");
    expect(lockedOval).toHaveTextContent("4");
    expect(lockedOval).toHaveClass("rounded-full", "bg-slate-300"); // grey oval
    // Locked and not-built stages can't be opened, so they aren't links.
    expect(within(row(4)).queryByRole("link", { name: /Open Stage 4/ })).not.toBeInTheDocument();
    expect(within(row(15)).queryByRole("link", { name: /Open Stage 15/ })).not.toBeInTheDocument();
  });

  it("says agents consume tokens", async () => {
    stubApi({ "/api/ventures": { body: [] } });
    renderWithProviders(<MyAgentsPage />);
    expect(await screen.findByText(/the tokens they've consumed/)).toBeInTheDocument();
  });

  it("stops, pauses and resumes runs", async () => {
    let current = agents({ idea_discovery: RUNNING });
    const fetchMock = stubApi({
      "/api/ventures/v1/agent-runs/run-1/pause": () => {
        current = agents({ idea_discovery: { ...RUNNING, latest: { ...RUNNING.latest, status: "paused" } } });
        return { body: {} };
      },
      "/api/ventures/v1/agent-runs/run-1/resume": () => {
        current = agents({ idea_discovery: RUNNING });
        return { status: 202, body: {} };
      },
      "/api/ventures/v1/agent-runs/run-1/cancel": () => {
        current = agents({ idea_discovery: { ...RUNNING, latest: { ...RUNNING.latest, status: "cancelled" } } });
        return { body: {} };
      },
      "/api/ventures/v1/agents": () => ({ body: current }),
      "/api/ventures": { body: [venture("v1", "Korean Recipes")] },
    });
    renderWithProviders(<MyAgentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Pause Idea Scout" }));
    fireEvent.click(await screen.findByRole("button", { name: "Resume Idea Scout" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pause Idea Scout" }));
    await screen.findByRole("button", { name: "Resume Idea Scout" });
    fireEvent.click(screen.getByRole("button", { name: "Stop Idea Scout" }));

    await waitFor(() => expect(row(1)).toHaveTextContent(A.status.cancelled));
    const posted = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([url]) => url.split("/").pop());
    expect(posted).toEqual(["pause", "resume", "pause", "cancel"]);
  });

  it("re-runs an agent, asking first when it is still working", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = stubApi({
      "/api/ventures/v1/stages/idea_discovery/agent-runs": { status: 202, body: {} },
      "/api/ventures/v1/stages/mvp/agent-runs": { status: 202, body: {} },
      "/api/ventures/v1/agents": { body: agents({ idea_discovery: RUNNING }) },
      "/api/ventures": { body: [venture("v1", "Korean Recipes")] },
    });
    renderWithProviders(<MyAgentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Re-run Product Designer" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/stages/mvp/agent-runs"))).toBe(true),
    );
    expect(confirm).not.toHaveBeenCalled();
    const mvpBody = JSON.parse(fetchMock.mock.calls.find(([url]) => url.endsWith("/stages/mvp/agent-runs"))![1]!.body as string);
    expect(mvpBody).toEqual({ language: "en" });

    fireEvent.click(screen.getByRole("button", { name: "Re-run Idea Scout" }));
    expect(confirm).toHaveBeenCalledWith("Idea Scout is still working. Stop it and start a new run?");
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/stages/idea_discovery/agent-runs"))).toBe(true),
    );
    const ideaBody = JSON.parse(
      fetchMock.mock.calls.find(([url]) => url.endsWith("/stages/idea_discovery/agent-runs"))![1]!.body as string,
    );
    expect(ideaBody).toEqual({ language: "en", replace: true });
  });

  it("explains why a stage's agent can't start yet", async () => {
    stubApi({
      "/api/ventures/v1/stages/market_evidence/agent-runs": { status: 422, body: { detail: "location_required" } },
      "/api/ventures/v1/agents": { body: agents() },
      "/api/ventures": { body: [venture("v1", "Korean Recipes")] },
    });
    renderWithProviders(<MyAgentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Re-run Market Sizing Analyst" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(A.errors.location_required);
  });

  it("shows the token-limit message when a re-run is refused", async () => {
    stubApi({
      "/api/ventures/v1/stages/mvp/agent-runs": { status: 429, body: { detail: "venture_token_limit" } },
      "/api/ventures/v1/agents": { body: agents() },
      "/api/ventures": { body: [venture("v1", "Korean Recipes")] },
    });
    renderWithProviders(<MyAgentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Re-run Product Designer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(en.TokenLimit.venture);
  });

  it("switches venture with the picker", async () => {
    const fetchMock = stubApi({
      "/api/ventures/v1/agents": { body: agents() },
      "/api/ventures/v2/agents": { body: agents({ mvp: { runs: 7 } }) },
      "/api/ventures": { body: [venture("v1", "Korean Recipes"), venture("v2", "Pet Sitter")] },
    });
    renderWithProviders(<MyAgentsPage />);
    await screen.findByTestId("agents-table");

    fireEvent.change(screen.getByLabelText(A.venture), { target: { value: "v2" } });
    await waitFor(() => expect(row(10)).toHaveTextContent("7"));
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/api/ventures/v2/agents"))).toBe(true);
  });

  it("invites the user to start when there are no ventures", async () => {
    stubApi({ "/api/ventures": { body: [] } });
    renderWithProviders(<MyAgentsPage />);
    expect(await screen.findByText(A.noVentures)).toBeInTheDocument();
  });

  it("speaks Korean", async () => {
    stubApi({
      "/api/ventures/v1/agents": { body: agents({ idea_discovery: RUNNING }) },
      "/api/ventures": { body: [venture("v1", "Korean Recipes")] },
    });
    renderWithProviders(<MyAgentsPage />, "ko");

    expect(await screen.findByRole("heading", { name: ko.Agents.title })).toBeInTheDocument();
    expect(await screen.findByTestId("agent-row-1")).toHaveTextContent("아이디어 스카우트");
    expect(row(1)).toHaveTextContent("1분 23초");
    expect(row(1)).toHaveTextContent(ko.Agents.status.running);
  });
});
