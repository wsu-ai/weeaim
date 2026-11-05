import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../messages/en.json";
import ko from "../../messages/ko.json";
import type { AlternativesResearchAnalysis } from "@/lib/api";
import { renderWithProviders, stubApi } from "@/test/auth-helpers";
import { AlternativesResearchPanel } from "./alternatives-research-panel";

const A = messages.AlternativesResearch;
const RESEARCH_PATH = "/api/ventures/v1/stages/existing_alternatives/research";

const RESEARCH: AlternativesResearchAnalysis = {
  kind: "alternatives_research",
  summary: "Customers mostly rely on recipe blogs and meal kits.",
  alternatives: [
    {
      name: "Maangchi",
      category: "direct_competitor",
      description: "Korean recipe site.",
      strengths: ["Trusted."],
      weaknesses: ["Not personalised."],
      pricing: null,
      url: "https://www.maangchi.com",
      search_url: "https://www.google.com/search?q=Maangchi",
    },
    {
      name: "HelloFresh",
      category: "indirect_competitor",
      description: "Meal kits.",
      strengths: [],
      weaknesses: ["Few Korean dishes."],
      pricing: "$9 per serving",
      url: null,
      search_url: "https://www.google.com/search?q=HelloFresh",
    },
    {
      name: "Asking family",
      category: "workaround",
      description: "Calling relatives for recipes.",
      strengths: ["Free."],
      weaknesses: [],
      pricing: null,
      url: null,
      search_url: "https://www.google.com/search?q=Asking+family",
    },
  ],
  switching_barriers: ["Habit."],
  unmet_needs: ["Guided Korean cooking for beginners."],
  positioning_recommendations: ["Lead with authenticity."],
  suggested_next_steps: ["Interview meal-kit users."],
  confidence: 0.6,
  sources: [],
  researched_at: "2026-10-02T10:00:00Z",
  based_on: "2026-10-02T09:30:00Z",
  language: "en",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel(analysis: AlternativesResearchAnalysis | null, locale: "en" | "ko" = "en") {
  const onResearched = vi.fn();
  renderWithProviders(
    <AlternativesResearchPanel ventureId="v1" analysis={analysis} language={locale} onResearched={onResearched} />,
    locale,
  );
  return onResearched;
}

describe("AlternativesResearchPanel", () => {
  it("groups alternatives by category with their details", () => {
    stubApi({});
    renderPanel(RESEARCH);

    for (const category of ["direct_competitor", "indirect_competitor", "workaround"] as const) {
      const section = screen.getByTestId(`category-${category}`);
      expect(section.querySelector("summary")).toHaveTextContent(A.categories[category]);
    }
    expect(screen.queryByTestId("category-substitute")).not.toBeInTheDocument();
    expect(screen.getByText("Pricing: $9 per serving")).toBeInTheDocument();
    expect(screen.getByText("Guided Korean cooking for beginners.")).toBeInTheDocument();
    expect(screen.getByText(A.barriersTitle)).toBeInTheDocument();
    expect(screen.getByText(/Based on your stages 1–3 as of/)).toBeInTheDocument();
  });

  it("collapses each category until opened, showing how many vendors it has", () => {
    stubApi({});
    renderPanel(RESEARCH);

    const direct = screen.getByTestId("category-direct_competitor") as HTMLDetailsElement;
    const count = RESEARCH.alternatives.filter((a) => a.category === "direct_competitor").length;
    expect(direct.querySelector("summary")).toHaveTextContent(`${A.categories.direct_competitor}${count}`);
    expect(direct.open).toBe(false);
    fireEvent.click(direct.querySelector("summary")!);
    expect(direct.open).toBe(true);
  });

  it("opens a popup with a competitor's strengths or weaknesses", () => {
    stubApi({});
    renderPanel(RESEARCH);
    const alt = RESEARCH.alternatives.find((a) => a.weaknesses.includes("Not personalised."))!;

    fireEvent.click(
      screen.getByRole("button", { name: `Weaknesses of ${alt.name} (${alt.weaknesses.length})` }),
    );
    const dialog = screen.getByRole("dialog", { name: `${alt.name}: weaknesses` });
    expect(dialog).toHaveTextContent("Not personalised.");
    expect(screen.getByRole("button", { name: A.close })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `Strengths of ${alt.name} (${alt.strengths.length})` }));
    const strengths = screen.getByRole("dialog", { name: `${alt.name}: strengths` });
    for (const item of alt.strengths) expect(strengths).toHaveTextContent(item);
    fireEvent.click(screen.getByRole("button", { name: A.close }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables the icon when there's nothing to show", () => {
    stubApi({});
    const empty = {
      ...RESEARCH,
      alternatives: RESEARCH.alternatives.map((a, i) => (i === 0 ? { ...a, strengths: [] } : a)),
    };
    renderPanel(empty);
    const name = empty.alternatives[0].name;
    expect(screen.getByRole("button", { name: `Strengths of ${name} (0)` })).toBeDisabled();
  });

  it("links to found websites, falls back to a web search, and leaves workarounds unlinked", () => {
    stubApi({});
    renderPanel(RESEARCH);

    expect(screen.getByRole("link", { name: "Visit the website of Maangchi" })).toHaveAttribute(
      "href",
      "https://www.maangchi.com",
    );
    expect(screen.getByRole("link", { name: "Search the web for HelloFresh" })).toHaveAttribute(
      "rel",
      "noopener noreferrer nofollow",
    );
    expect(screen.queryByRole("link", { name: /Asking family/ })).not.toBeInTheDocument();
  });

  it("researches automatically when there is none, then can re-run", async () => {
    const fetchMock = stubApi({ [RESEARCH_PATH]: { body: RESEARCH } });
    const onResearched = renderPanel(null);

    expect(await screen.findByText(RESEARCH.summary)).toBeInTheDocument();
    expect(onResearched).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: A.rerun }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("offers a retry when research fails", async () => {
    let calls = 0;
    stubApi({
      [RESEARCH_PATH]: () => {
        calls += 1;
        return calls === 1 ? { status: 503, body: null } : { body: RESEARCH };
      },
    });
    renderPanel(null);

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Login.errorUnavailable);
    fireEvent.click(screen.getByRole("button", { name: A.retry }));
    expect(await screen.findByText(RESEARCH.summary)).toBeInTheDocument();
  });

  it("shows an earlier run read-only", () => {
    const fetchMock = stubApi({});
    renderWithProviders(
      <AlternativesResearchPanel
        ventureId="v1"
        analysis={RESEARCH}
        language="en"
        onResearched={vi.fn()}
        historical
        onBackToLatest={vi.fn()}
      />,
    );

    expect(screen.getByText(/Viewing earlier research from/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: A.rerun })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders in Korean and asks for Korean research", async () => {
    const fetchMock = stubApi({ [RESEARCH_PATH]: { body: { ...RESEARCH, language: "ko" } } });
    renderPanel(null, "ko");

    expect(await screen.findByText(ko.AlternativesResearch.categories.direct_competitor, { selector: "summary span" })).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ language: "ko" });
  });
});
