import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../../messages/en.json";
import ko from "../../messages/ko.json";
import type { AgentRun } from "@/lib/api";
import { renderWithProviders, requestBody, stubApi } from "@/test/auth-helpers";
import { AgentRunPanel } from "./agent-run-panel";

vi.mock("@/i18n/navigation", async () => (await import("@/test/auth-helpers")).navigationMock);

const A = en.AgentRun;
const STAGE_URL = "/api/ventures/v1/stages/existing_alternatives/agent-runs";
const LABELS = { current_solutions: "What do customers use today?", why_switch: "Why would they switch?" };

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    stage_slug: "existing_alternatives",
    status: "running",
    language: "en",
    model_turns: 2,
    web_searches: 1,
    tokens_used: 500,
    active_ms: 4200,
    pending_question: null,
    proposed_answers: null,
    error: null,
    created_at: "2026-10-14T09:00:00Z",
    finished_at: null,
    steps: [
      { seq: 1, kind: "model", tool_name: null, arguments: null, created_at: "2026-10-14T09:00:01Z" },
      { seq: 2, kind: "tool", tool_name: "read_stage", arguments: { slug: "problem_definition" }, created_at: "2026-10-14T09:00:02Z" },
      { seq: 3, kind: "web_search", tool_name: null, arguments: null, created_at: "2026-10-14T09:00:03Z" },
    ],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel(props: Partial<React.ComponentProps<typeof AgentRunPanel>> = {}, locale: "en" | "ko" = "en") {
  const onFinished = vi.fn();
  const onUseAnswers = vi.fn();
  renderWithProviders(
    <AgentRunPanel
      ventureId="v1"
      stageSlug="existing_alternatives"
      language={locale}
      stageNumbers={{ idea_discovery: 1, problem_definition: 2, customer_definition: 3 }}
      fieldLabels={LABELS}
      onFinished={onFinished}
      onUseAnswers={onUseAnswers}
      {...props}
    />,
    locale,
  );
  return { onFinished, onUseAnswers };
}

describe("AgentRunPanel", () => {
  it("starts a run in the page's language and shows its steps", async () => {
    const fetchMock = stubApi({
      [`${STAGE_URL}/latest`]: { body: null },
      [STAGE_URL]: { status: 202, body: makeRun() },
    });
    renderPanel();

    const run = await screen.findByRole("button", { name: A.run });
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);

    expect(await screen.findByText(A.status.running)).toBeInTheDocument();
    expect(screen.getByText("Read your Stage 2 answers")).toBeInTheDocument();
    expect(screen.getByText(A.steps.searched)).toBeInTheDocument();
    expect(screen.getByText("2 steps · 1 web search")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: A.cancel })).toBeInTheDocument();
    expect(requestBody(fetchMock, STAGE_URL)).toEqual({ language: "en" });
  });

  it("asks the founder's answer and sends it", async () => {
    const waiting = makeRun({ status: "waiting_for_founder", pending_question: "Which city first?" });
    const fetchMock = stubApi({
      [`${STAGE_URL}/latest`]: { body: waiting },
      "/api/ventures/v1/agent-runs/run-1/answer": { status: 202, body: makeRun() },
    });
    renderPanel();

    expect(await screen.findByText(/Which city first\?/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/The agent asks:/), { target: { value: "Seoul" } });
    fireEvent.click(screen.getByRole("button", { name: A.sendAnswer }));

    expect(await screen.findByText(A.status.running)).toBeInTheDocument();
    expect(requestBody(fetchMock, "/agent-runs/run-1/answer")).toEqual({ answer: "Seoul" });
  });

  it("cancels a running agent", async () => {
    stubApi({
      [`${STAGE_URL}/latest`]: { body: makeRun() },
      "/api/ventures/v1/agent-runs/run-1/cancel": { body: makeRun({ status: "cancelled" }) },
    });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: A.cancel }));
    expect(await screen.findByText(A.status.cancelled)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: A.runAgain })).toBeInTheDocument();
  });

  it("reloads the stage when a watched run finishes, and offers the drafted answers", async () => {
    const proposed = { current_solutions: "Meal kits.", why_switch: "Authentic recipes.", biggest_threat: "" };
    let latest = makeRun();
    stubApi({ [`${STAGE_URL}/latest`]: () => ({ body: latest }) });
    const { onFinished, onUseAnswers } = renderPanel();
    expect(await screen.findByText(A.status.running)).toBeInTheDocument();

    latest = makeRun({ status: "succeeded", proposed_answers: proposed });
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1), { timeout: 4000 });

    expect(screen.getByText(LABELS.current_solutions)).toHaveClass("font-semibold", "text-blue-700"); // questions stand out
    expect(screen.getByText("Meal kits.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: A.useAnswers }));
    // Empty drafts aren't offered.
    expect(onUseAnswers).toHaveBeenCalledWith({ current_solutions: "Meal kits.", why_switch: "Authentic recipes." });
    expect(screen.getByText(A.usedAnswers)).toBeInTheDocument();
  });

  it("explains why a run stopped, and a run already in progress", async () => {
    stubApi({
      [`${STAGE_URL}/latest`]: { body: makeRun({ status: "failed", error: "limit_reached" }) },
      [STAGE_URL]: { status: 409, body: { detail: "agent_running" } },
    });
    renderPanel();

    expect(await screen.findByText(A.errors.limit_reached)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: A.runAgain }));
    expect(await screen.findByRole("alert")).toHaveTextContent(A.alreadyRunning);
  });

  it("speaks Korean", async () => {
    stubApi({ [`${STAGE_URL}/latest`]: { body: makeRun() } });
    renderPanel({}, "ko");

    expect(await screen.findByText(ko.AgentRun.status.running)).toBeInTheDocument();
    expect(screen.getByText("2단계 답변을 읽음")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: ko.AgentRun.title })).toBeInTheDocument();
  });

  it("explains when the venture idea has used all its tokens", async () => {
    stubApi({
      [`${STAGE_URL}/latest`]: { body: makeRun({ status: "succeeded" }) },
      [STAGE_URL]: { status: 429, body: { detail: "venture_token_limit" } },
    });
    renderPanel();

    const again = await screen.findByRole("button", { name: A.runAgain });
    await waitFor(() => expect(again).toBeEnabled());
    fireEvent.click(again);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You have reached the maximum number of tokens allowed for your business idea session. Please request the Administrator for additional tokens.",
    );
  });

  describe("Tell me why the agent stopped", () => {
    const W = A.why;
    const failed = (error: AgentRun["error"], steps: AgentRun["steps"] = []) =>
      makeRun({ status: "failed", error, finished_at: "2026-10-20T09:05:00Z", model_turns: 3, tokens_used: 4200, steps });

    it("explains a failure with its cause and numbered steps to fix it, then re-runs", async () => {
      const fetchMock = stubApi({
        [`${STAGE_URL}/latest`]: {
          body: failed("agent_error", [
            { seq: 1, kind: "error", tool_name: "read_stage", arguments: null, result: { error: "Unknown tool" }, created_at: "t" },
            { seq: 2, kind: "error", tool_name: null, arguments: null, result: { error: "RateLimitError" }, created_at: "t" },
          ]),
        },
        [STAGE_URL]: { status: 202, body: makeRun() },
      });
      renderPanel({ explainStops: true });

      const why = await screen.findByRole("button", { name: W.button });
      expect(screen.queryByTestId("agent-why")).not.toBeInTheDocument();
      fireEvent.click(why);

      const panel = screen.getByTestId("agent-why");
      expect(panel).toHaveTextContent(W.reasons.agent_error.what);
      expect(panel).toHaveTextContent(W.aiErrors.RateLimitError); // the actual cause
      expect(panel).toHaveTextContent("4,200"); // tokens used
      const fixes = within(panel).getAllByRole("listitem").map((li) => li.textContent);
      expect(fixes).toEqual(W.reasons.agent_error.fix);
      expect(within(panel).getByText(W.corrected).nextSibling).toHaveTextContent("1");

      fireEvent.click(within(panel).getByRole("button", { name: W.runAgain }));
      await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    });

    it("explains the missing persona conversations on Stage 7", async () => {
      stubApi({ [`${STAGE_URL}/latest`]: { body: failed("no_conversations") } });
      renderPanel({ explainStops: true });
      fireEvent.click(await screen.findByRole("button", { name: W.button }));
      const panel = screen.getByTestId("agent-why");
      expect(panel).toHaveTextContent(W.reasons.no_conversations.what);
      expect(panel).toHaveTextContent('Click "Launch a chat with the Persona"');
    });

    it("points a token-limit stop to the token usage page instead of re-running", async () => {
      stubApi({
        [`${STAGE_URL}/latest`]: {
          body: failed("token_limit_reached", [
            {
              seq: 1, kind: "limit", tool_name: null, arguments: null, created_at: "t",
              result: { cap: "organization_token_limit", used: 50_100, limit: 50_000 },
            },
          ]),
        },
        "/api/token-usage": {
          body: {
            ventures: [{ venture_id: "v1", title: "Recipes", archived: false, tokens: 9_000 }],
            organization_total: 52_345,
            limits: { per_venture_limit: 10_000, organization_limit: 50_000 },
            updated_at: null,
            can_edit: false,
          },
        },
      });
      renderPanel({ explainStops: true });
      fireEvent.click(await screen.findByRole("button", { name: W.button }));
      const panel = screen.getByTestId("agent-why");
      expect(panel).toHaveTextContent(W.capOrganization);
      // Current Tokens Used (live, for the organization) and the Token Usage Limit.
      const figures = within(panel).getByTestId("token-figures");
      await waitFor(() => expect(within(figures).getByText(W.currentTokensUsed).nextSibling).toHaveTextContent("52,345"));
      expect(within(figures).getByText(W.tokenUsageLimit).nextSibling).toHaveTextContent("50,000");
      expect(figures).toHaveTextContent(W.scopeOrganization);
      expect(within(panel).getByRole("link", { name: /Open token usage/ })).toHaveAttribute("href", "/settings/tokens");
      expect(within(panel).queryByRole("button", { name: W.runAgain })).not.toBeInTheDocument();
    });

    it("shows the venture's figures as recorded when the live totals can't be loaded", async () => {
      stubApi({
        [`${STAGE_URL}/latest`]: {
          body: failed("token_limit_reached", [
            {
              seq: 1, kind: "limit", tool_name: null, arguments: null, created_at: "t",
              result: { cap: "venture_token_limit", used: 10_250, limit: 10_000 },
            },
          ]),
        },
        "/api/token-usage": { status: 503, body: {} },
      });
      renderPanel({ explainStops: true });
      fireEvent.click(await screen.findByRole("button", { name: W.button }));
      const figures = screen.getByTestId("token-figures");
      expect(within(figures).getByText(W.currentTokensUsed).nextSibling).toHaveTextContent("10,250");
      expect(within(figures).getByText(W.tokenUsageLimit).nextSibling).toHaveTextContent("10,000");
      expect(figures).toHaveTextContent(W.scopeVenture);
    });

    it("shows the run's token budget when one run used too many tokens", async () => {
      stubApi({
        [`${STAGE_URL}/latest`]: {
          body: failed("limit_reached", [
            {
              seq: 1, kind: "limit", tool_name: null, arguments: null, created_at: "t",
              result: { reason: "tokens", tokens_used: 151_200, token_limit: 150_000, max_seconds: 300 },
            },
          ]),
        },
      });
      renderPanel({ explainStops: true });
      fireEvent.click(await screen.findByRole("button", { name: W.button }));
      const figures = screen.getByTestId("token-figures");
      expect(within(figures).getByText(W.currentTokensUsed).nextSibling).toHaveTextContent("151,200");
      expect(within(figures).getByText(W.tokenUsageLimit).nextSibling).toHaveTextContent("150,000");
      expect(figures).toHaveTextContent(W.scopeRun);
    });

    it("has no token figures when the stop wasn't about tokens", async () => {
      stubApi({ [`${STAGE_URL}/latest`]: { body: failed("interrupted") } });
      renderPanel({ explainStops: true });
      fireEvent.click(await screen.findByRole("button", { name: W.button }));
      expect(screen.queryByTestId("token-figures")).not.toBeInTheDocument();
    });

    it("explains a run stopped with Cancel", async () => {
      stubApi({ [`${STAGE_URL}/latest`]: { body: makeRun({ status: "cancelled" }) } });
      renderPanel({ explainStops: true });
      fireEvent.click(await screen.findByRole("button", { name: W.button }));
      expect(screen.getByTestId("agent-why")).toHaveTextContent(W.reasons.stopped_by_user.what);
    });

    it("is offered only where enabled, and only for stopped runs", async () => {
      stubApi({ [`${STAGE_URL}/latest`]: { body: failed("agent_error") } });
      renderPanel(); // explainStops is off by default
      await screen.findByText(A.status.failed);
      expect(screen.queryByRole("button", { name: W.button })).not.toBeInTheDocument();
    });

    it("hides the button while the run is going", async () => {
      stubApi({ [`${STAGE_URL}/latest`]: { body: makeRun() } });
      renderPanel({ explainStops: true });
      await screen.findByText(A.status.running);
      expect(screen.queryByRole("button", { name: W.button })).not.toBeInTheDocument();
    });

    it("speaks Korean", async () => {
      stubApi({ [`${STAGE_URL}/latest`]: { body: failed("interrupted") } });
      renderPanel({ explainStops: true }, "ko");
      fireEvent.click(await screen.findByRole("button", { name: ko.AgentRun.why.button }));
      expect(screen.getByTestId("agent-why")).toHaveTextContent(ko.AgentRun.why.reasons.interrupted.what);
    });
  });
});
