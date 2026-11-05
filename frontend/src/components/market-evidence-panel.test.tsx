import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../messages/en.json";
import ko from "../../messages/ko.json";
import type { MarketResearchAnalysis, MarketScopeResult, SourcedFigure } from "@/lib/api";
import { renderWithProviders, stubApi } from "@/test/auth-helpers";
import { MarketEvidencePanel } from "./market-evidence-panel";

const M = messages.MarketEvidence;
const RESEARCH_PATH = "/api/ventures/v1/stages/market_evidence/research";

const confirmed = (title: string, url: string) => ({
  source_title: title,
  source_url: url,
  source_verified: true,
  search_url: null,
});

function figure(value: number, unit: string, extra: Partial<SourcedFigure> = {}): SourcedFigure {
  return {
    value,
    unit,
    explanation: `${unit} explanation`,
    year: 2024,
    is_estimate: false,
    ...confirmed("Statistics office", "https://stats.example.gov/table"),
    ...extra,
  };
}

function scope(
  name: MarketScopeResult["scope"],
  area: string,
  currency: string,
  sizes: [number, number, number],
  customers: number,
  price: number,
): MarketScopeResult {
  return {
    scope: name,
    area_name: area,
    market_sizes: { currency, tam: sizes[0], sam: sizes[1], som: sizes[2] },
    inputs: {
      total_customers: figure(customers, "households"),
      annual_revenue_per_customer: figure(price, `${currency} per year`, {
        is_estimate: true,
        source_title: null,
        source_url: null,
        source_verified: false,
      }),
      serviceable_share: figure(0.25, "share", {
        source_title: "App adoption survey",
        source_url: null,
        source_verified: false,
        search_url: "https://www.google.com/search?q=App+adoption+survey",
      }),
      obtainable_share: figure(0.02, "share", { is_estimate: true, source_title: null, source_url: null, source_verified: false }),
    },
    demographics: [
      {
        segment: `Households in ${area}`,
        geography: area,
        description: "Dual-income households.",
        count: customers,
        unit: "households",
        year: 2024,
        ...confirmed("Statistics office", "https://stats.example.gov/table"),
      },
    ],
    published_market_sizes: [
      {
        label: `${area} meal kit market`,
        value: sizes[0] * 2,
        currency,
        year: 2024,
        scope: area,
        publisher: "Example Research",
        ...confirmed("Meal kit market report", "https://research.example.com/meal-kits"),
      },
    ],
  };
}

const RESEARCH: MarketResearchAnalysis = {
  kind: "market_research",
  summary: "A growing market of busy households interested in Korean food.",
  location: { country: "South Korea", metro_city: "Seoul" },
  scopes: [
    scope("global", "World", "USD", [120_000_000, 30_000_000, 600_000], 1_000_000, 120),
    scope("country", "South Korea", "KRW", [12_000_000_000, 3_000_000_000, 60_000_000], 100_000, 120_000),
    scope("metro", "Seoul", "KRW", [4_800_000_000, 1_200_000_000, 24_000_000], 40_000, 120_000),
  ],
  consistency_warnings: [],
  vendors: [
    {
      name: "HelloFresh",
      description: "Meal kit delivery.",
      business_model: "Weekly subscription",
      traction: "Revenue of €7.6B in 2023.",
      url: "https://www.hellofresh.com",
      evidence_url: "https://ir.hellofresh.com/results",
      evidence_verified: true,
      search_url: "https://www.google.com/search?q=HelloFresh",
    },
  ],
  assumptions: ["Price holds at $10/month."],
  data_gaps: ["No city-level survey."],
  suggested_next_steps: ["Run a pricing survey."],
  confidence: 0.55,
  sources: [],
  researched_at: "2026-10-12T09:00:00Z",
  based_on: "2026-10-12T08:30:00Z",
  language: "en",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel(
  analysis: MarketResearchAnalysis | null,
  { locale = "en", locationReady = true }: { locale?: "en" | "ko"; locationReady?: boolean } = {},
) {
  renderWithProviders(
    <MarketEvidencePanel
      ventureId="v1"
      analysis={analysis}
      language={locale}
      locationReady={locationReady}
      onResearched={vi.fn()}
    />,
    locale,
  );
}

describe("MarketEvidencePanel", () => {
  it("compares TAM, SAM and SOM for global, country and city", () => {
    stubApi({});
    renderPanel(RESEARCH);

    expect(screen.getByText("Sized for: worldwide, South Korea, and Seoul.")).toBeInTheDocument();
    const global = screen.getByTestId("market-row-global");
    expect(global).toHaveTextContent("Global · World");
    expect(global).toHaveTextContent("$120M");
    expect(global).toHaveTextContent("$30M");
    expect(global).toHaveTextContent("$600K");
    expect(screen.getByTestId("market-row-country")).toHaveTextContent("Country · South Korea");
    expect(screen.getByTestId("market-row-country")).toHaveTextContent("₩12B");
    expect(screen.getByTestId("market-row-metro")).toHaveTextContent("Metro city · Seoul");
    expect(screen.getByTestId("market-row-metro")).toHaveTextContent("₩4.8B");
  });

  it("shows each geography's formulas, demographics and sources in its own tab", () => {
    stubApi({});
    renderPanel(RESEARCH);

    expect(screen.getByTestId("market-formulas-global")).toHaveTextContent(
      "TAM = 1,000,000 households × $120 per year = $120,000,000",
    );
    expect(screen.getByTestId("market-formulas-global")).toHaveTextContent("SAM = $120,000,000 × 25% = $30,000,000");

    fireEvent.click(screen.getByRole("tab", { name: "Metro city · Seoul" }));
    expect(screen.getByTestId("market-formulas-metro")).toHaveTextContent(
      "TAM = 40,000 households × ₩120,000 per year = ₩4,800,000,000",
    );
    const demographics = screen.getByTestId("demographics-metro");
    expect(within(demographics).getByText("Households in Seoul")).toBeInTheDocument();
    expect(within(demographics).getByText("40,000 households")).toBeInTheDocument();
    expect(within(demographics).getByRole("link", { name: "Statistics office" })).toHaveAttribute(
      "href",
      "https://stats.example.gov/table",
    );
    expect(screen.getByText(/Our bottom-up TAM is 0.5× this published figure/)).toBeInTheDocument();
  });

  it("charts each market's TAM as a pie of SOM, rest of SAM and rest of TAM in its tab", () => {
    stubApi({});
    renderPanel(RESEARCH);

    const global = screen.getByTestId("market-pie-global");
    expect(within(global).getByRole("img")).toHaveAccessibleName(/\$120M total addressable market in World/);
    const rows = within(global).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(`${M.pie.slices.som}$600K0.5%`);
    expect(rows[1]).toHaveTextContent(`${M.pie.slices.samRest}$29.4M24.5%`);
    expect(rows[2]).toHaveTextContent(`${M.pie.slices.tamRest}$90M75%`);
    expect(global.querySelectorAll("path[data-slice]")).toHaveLength(3);

    fireEvent.click(screen.getByRole("tab", { name: "Country · South Korea" }));
    const country = screen.getByTestId("market-pie-country");
    expect(within(country).getAllByRole("listitem")[2]).toHaveTextContent("₩9B");
    expect(screen.queryByTestId("market-pie-global")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Metro city · Seoul" }));
    expect(within(screen.getByTestId("market-pie-metro")).getAllByRole("listitem")[0]).toHaveTextContent("₩24M");
  });

  it("keeps a tiny SOM slice visible in the pie", () => {
    stubApi({});
    renderPanel({
      ...RESEARCH,
      scopes: [scope("global", "World", "USD", [1_000_000_000, 100_000_000, 10_000], 1_000_000, 1000)],
    });

    const som = screen.getByTestId("market-pie-global").querySelector('path[data-slice="som"]')!;
    // Start at 12 o'clock (90, 6); the arc must end visibly to the right.
    const end = som.getAttribute("d")!.match(/1 ([\d.]+) ([\d.]+) Z$/)!;
    expect(Number(end[1]) - 90).toBeGreaterThan(5);
  });

  it("marks sources as confirmed, unconfirmed or estimates", () => {
    stubApi({});
    renderPanel(RESEARCH);

    expect(screen.getAllByText(M.sourceConfirmed).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "App adoption survey" })).not.toBeInTheDocument();
    expect(screen.getByText(M.sourceUnconfirmed)).toBeInTheDocument();
    expect(screen.getAllByText(M.estimate)).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Visit the website of HelloFresh" })).toHaveAttribute(
      "href",
      "https://www.hellofresh.com",
    );
  });

  it("warns when a smaller market has more customers than a larger one", () => {
    stubApi({});
    renderPanel({ ...RESEARCH, consistency_warnings: ["metro_exceeds_country"] });

    expect(screen.getByRole("alert")).toHaveTextContent(M.warnings.metro_exceeds_country);
  });

  it("waits for the location before researching", () => {
    const fetchMock = stubApi({});
    renderPanel(null, { locationReady: false });

    expect(screen.getByRole("status")).toHaveTextContent(M.locationNeeded);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("researches automatically once the location is saved, and retries on failure", async () => {
    let calls = 0;
    stubApi({
      [RESEARCH_PATH]: () => {
        calls += 1;
        return calls === 1 ? { status: 503, body: null } : { body: RESEARCH };
      },
    });
    renderPanel(null);

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Login.errorUnavailable);
    fireEvent.click(screen.getByRole("button", { name: M.retry }));
    expect(await screen.findByText(RESEARCH.summary)).toBeInTheDocument();
    await waitFor(() => expect(calls).toBe(2));
  });

  it("still shows research saved in the earlier single-market format", () => {
    stubApi({});
    const legacy = scope("global", "", "USD", [120_000_000, 30_000_000, 600_000], 1_000_000, 120);
    renderPanel({
      ...RESEARCH,
      scopes: undefined,
      location: undefined,
      market_sizes: legacy.market_sizes,
      inputs: legacy.inputs,
      demographics: legacy.demographics,
      published_market_sizes: legacy.published_market_sizes,
    });

    expect(screen.getByTestId("market-row-legacy")).toHaveTextContent("$120M");
    expect(screen.getByTestId("market-row-legacy")).toHaveTextContent(M.scopes.legacy);
  });

  it("renders in Korean", () => {
    stubApi({});
    renderPanel({ ...RESEARCH, language: "ko" }, { locale: "ko" });

    expect(screen.getByText(ko.MarketEvidence.marketSizeTitle)).toBeInTheDocument();
    expect(screen.getByTestId("market-row-metro")).toHaveTextContent(ko.MarketEvidence.scopes.metro);
  });

  it("re-analyzes all three markets from the Refresh button at the top", async () => {
    const refreshed = {
      ...RESEARCH,
      summary: "Refreshed market view.",
      scopes: RESEARCH.scopes!.map((scope) => ({
        ...scope,
        market_sizes: { ...scope.market_sizes, tam: scope.market_sizes.tam * 2 },
      })),
    };
    const fetchMock = stubApi({ [RESEARCH_PATH]: { body: refreshed } });
    renderPanel(RESEARCH);

    const refresh = screen.getByRole("button", { name: M.refresh });
    // It sits in the panel's header, before the market figures.
    expect(
      refresh.compareDocumentPosition(screen.getByTestId("market-size-table")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(refresh);

    expect(await screen.findByText("Refreshed market view.")).toBeInTheDocument();
    expect(screen.getByTestId("market-row-global")).toHaveTextContent("$240M");
    expect(screen.getByTestId("market-row-metro")).toHaveTextContent("₩9.6B");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("disables Refresh until the location is saved", () => {
    stubApi({});
    renderPanel(RESEARCH, { locationReady: false });

    expect(screen.getByRole("button", { name: M.refresh })).toBeDisabled();
  });
});
