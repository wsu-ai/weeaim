import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../messages/en.json";
import ko from "../../messages/ko.json";
import type { IdeaResearchAnalysis } from "@/lib/api";
import { renderWithProviders, stubApi } from "@/test/auth-helpers";
import { IdeaResearchPanel } from "./idea-research-panel";

const R = messages.IdeaResearch;
const RESEARCH_PATH = "/api/ventures/v1/stages/idea_discovery/research";

const RESEARCH: IdeaResearchAnalysis = {
  kind: "idea_research",
  summary: "Recipe apps are common; guided Korean cooking for beginners is less served.",
  market_status: "crowded_market",
  existing_solutions: [
    {
      name: "Maangchi",
      description: "Popular Korean recipe site and channel.",
      similarity: "partial",
      url: "https://www.maangchi.com",
      search_url: "https://www.google.com/search?q=Maangchi",
    },
    {
      name: "Unlinked Co",
      description: "Website not found by the search.",
      similarity: "adjacent",
      url: null,
      search_url: "https://www.google.com/search?q=Unlinked+Co",
    },
  ],
  feasibility: ["Buildable with existing recipe data."],
  viability: ["Subscription willingness is unproven."],
  differentiation_opportunities: ["Target U.S. families new to Korean cooking."],
  key_risks: ["Big recipe apps could copy the feature."],
  suggested_next_steps: ["Interview ten households."],
  confidence: 0.6,
  sources: [{ title: "Maangchi home", url: "https://www.maangchi.com" }],
  researched_at: "2026-10-02T09:00:00Z",
  language: "en",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel(analysis: IdeaResearchAnalysis | null, locale: "en" | "ko" = "en") {
  const onResearched = vi.fn();
  renderWithProviders(
    <IdeaResearchPanel ventureId="v1" analysis={analysis} language={locale} onResearched={onResearched} />,
    locale,
  );
  return onResearched;
}

describe("IdeaResearchPanel", () => {
  it("shows every section of saved research", () => {
    stubApi({});
    renderPanel(RESEARCH);

    expect(screen.getByText(RESEARCH.summary)).toBeInTheDocument();
    expect(screen.getByText(R.marketStatus.crowded_market)).toBeInTheDocument();
    for (const title of [
      R.existingTitle,
      R.differentiationTitle,
      R.feasibilityTitle,
      R.viabilityTitle,
      R.risksTitle,
      R.nextStepsTitle,
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByText("Target U.S. families new to Korean cooking.")).toBeInTheDocument();
    expect(screen.getByText(R.similarity.partial)).toBeInTheDocument();
    expect(screen.getByText(/AI-generated research from/)).toBeInTheDocument();
  });

  it("opens web links safely and leaves uncited businesses unlinked", () => {
    stubApi({});
    renderPanel(RESEARCH);

    const competitor = screen.getByRole("link", { name: "Maangchi" });
    expect(competitor).toHaveAttribute("href", "https://www.maangchi.com");
    expect(competitor).toHaveAttribute("target", "_blank");
    expect(competitor).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(screen.queryByRole("link", { name: "Unlinked Co" })).not.toBeInTheDocument();
    expect(screen.getByText("Unlinked Co")).toBeInTheDocument();
  });

  it("links each business to its website, or to a web search when unconfirmed", () => {
    stubApi({});
    renderPanel(RESEARCH);

    const website = screen.getByRole("link", { name: "Visit the website of Maangchi" });
    expect(website).toHaveAttribute("href", "https://www.maangchi.com");
    expect(website).toHaveTextContent("maangchi.com");
    expect(website).toHaveAttribute("rel", "noopener noreferrer nofollow");

    const search = screen.getByRole("link", { name: "Search the web for Unlinked Co" });
    expect(search).toHaveAttribute("href", "https://www.google.com/search?q=Unlinked+Co");
    expect(search).toHaveAttribute("target", "_blank");
  });

  it("builds a web search link for research saved before search links existed", () => {
    stubApi({});
    renderPanel({
      ...RESEARCH,
      existing_solutions: [{ name: "Old & Co", description: "d", similarity: "direct", url: null }],
    });

    expect(screen.getByRole("link", { name: "Search the web for Old & Co" })).toHaveAttribute(
      "href",
      "https://www.google.com/search?q=Old%20%26%20Co",
    );
  });

  it("explains when no comparable businesses were found", () => {
    stubApi({});
    renderPanel({ ...RESEARCH, existing_solutions: [], market_status: "no_close_matches_found" });

    expect(screen.getByText(R.noneFound)).toBeInTheDocument();
    expect(screen.getByText(R.marketStatus.no_close_matches_found)).toBeInTheDocument();
  });

  it("runs research automatically when there is none, in the page language", async () => {
    const fetchMock = stubApi({ [RESEARCH_PATH]: { body: RESEARCH } });
    const onResearched = renderPanel(null);

    expect(await screen.findByText(RESEARCH.summary)).toBeInTheDocument();
    expect(onResearched).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ language: "en" });
  });

  it("shows progress while the research is running", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    renderPanel(null);

    expect(await screen.findByRole("status")).toHaveTextContent(R.researching);
  });

  it("re-runs research on request", async () => {
    const fetchMock = stubApi({ [RESEARCH_PATH]: { body: { ...RESEARCH, summary: "Updated view." } } });
    renderPanel(RESEARCH);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: R.rerun }));

    expect(await screen.findByText("Updated view.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows a retry button when research fails", async () => {
    let calls = 0;
    stubApi({
      [RESEARCH_PATH]: () => {
        calls += 1;
        return calls === 1
          ? { status: 503, body: { detail: "AI research failed. Please try again." } }
          : { body: RESEARCH };
      },
    });
    renderPanel(null);

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Login.errorUnavailable);
    fireEvent.click(screen.getByRole("button", { name: R.retry }));
    await waitFor(() => expect(screen.getByText(RESEARCH.summary)).toBeInTheDocument());
  });

  it("renders in Korean and asks for Korean research", async () => {
    const fetchMock = stubApi({ [RESEARCH_PATH]: { body: { ...RESEARCH, language: "ko" } } });
    renderPanel(null, "ko");

    expect(await screen.findByText(ko.IdeaResearch.marketStatus.crowded_market)).toBeInTheDocument();
    expect(screen.getByText(ko.IdeaResearch.differentiationTitle)).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ language: "ko" });
  });

  it("leaves sources to the right-hand column", () => {
    stubApi({});
    renderPanel(RESEARCH);

    expect(screen.queryByRole("link", { name: "Maangchi home" })).not.toBeInTheDocument();
  });

  it("shows an earlier run read-only, with a way back to the latest", () => {
    const fetchMock = stubApi({});
    const onBack = vi.fn();
    renderWithProviders(
      <IdeaResearchPanel
        ventureId="v1"
        analysis={{ ...RESEARCH, summary: "Earlier view." }}
        language="en"
        onResearched={vi.fn()}
        historical
        onBackToLatest={onBack}
      />,
    );

    expect(screen.getByText("Earlier view.")).toBeInTheDocument();
    expect(screen.getByText(/Viewing earlier research from/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: R.rerun })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: R.backToLatest }));
    expect(onBack).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
