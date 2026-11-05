import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../../../../../../messages/en.json";
import ko from "../../../../../../messages/ko.json";
import type { WebsiteMockup } from "@/lib/api";
import { renderWithProviders, requestBody, stubApi } from "@/test/auth-helpers";
import DesignStudioPage from "./page";

vi.mock("@/i18n/navigation", async () => (await import("@/test/auth-helpers")).navigationMock);
vi.mock("next/navigation", () => ({ useParams: () => ({ ventureId: "v1" }) }));

const S = en.DesignStudio;

const ORIGINAL: WebsiteMockup = {
  brand_name: "Kimchi Kit",
  primary_color: "#b91c1c",
  accent_color: "#fde047",
  nav_items: ["How it works", "Pricing"],
  hero_headline: "Cook Korean food with confidence",
  hero_subheadline: "Short guided lessons for busy families.",
  cta_label: "Start free",
  features: [
    { title: "Guided lessons", description: "Step by step.", icon: "book" },
    { title: "15-minute meals", description: "Weeknight friendly.", icon: "clock" },
  ],
  how_it_works: ["Pick a recipe", "Follow the steps"],
  pricing_teaser: "From $10 a month.",
  footer_note: "Sample page.",
};

function mvpStage(answers: Record<string, unknown> = { build_plan: "No-code" }, mockup: WebsiteMockup | null = ORIGINAL) {
  return {
    slug: "mvp",
    number: 10,
    title_en: "MVP",
    title_ko: "MVP",
    status: "completed",
    implemented: true,
    locked: false,
    locked_by: [],
    answers,
    ai_analysis: mockup
      ? { kind: "mvp", offering_type: "online_service", website_mockup: mockup, physical_product: null, offline_service: null }
      : { kind: "mvp", offering_type: "physical_product", website_mockup: null, physical_product: {}, offline_service: null },
  };
}

function stub(stage = mvpStage()) {
  return stubApi({
    "/api/ventures/v1/stages/mvp": (init) => ({ status: init.method === "PUT" ? 200 : 404, body: {} }),
    "/api/ventures/v1/stages": { body: [stage] },
    "/api/ventures/v1": { body: { id: "v1", title: "Korean Recipes" } },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function ready() {
  return screen.findByTestId("studio-preview");
}

describe("DesignStudioPage", () => {
  it("edits the mock-up with a live preview", async () => {
    stub();
    renderWithProviders(<DesignStudioPage />);
    const preview = await ready();
    expect(within(preview).getByTestId("mockup-headline")).toHaveTextContent(ORIGINAL.hero_headline);

    fireEvent.change(screen.getByLabelText(S.headline), { target: { value: "Dinner, solved" } });
    expect(within(preview).getByTestId("mockup-headline")).toHaveTextContent("Dinner, solved");
    fireEvent.change(screen.getByLabelText(S.ctaLabel), { target: { value: "Try it" } });
    expect(within(preview).getByTestId("mockup-cta")).toHaveTextContent("Try it");
    fireEvent.change(screen.getByLabelText(S.brandName), { target: { value: "Bap Box" } });
    expect(preview).toHaveTextContent("Bap Box");
    expect(screen.getByRole("status")).toHaveTextContent(S.unsaved);
  });

  it("saves the design into Stage 10's answers, keeping the other answers", async () => {
    const fetchMock = stub();
    renderWithProviders(<DesignStudioPage />);
    await ready();

    fireEvent.change(screen.getByLabelText(S.primaryColor, { selector: "input:not([type=color])" }), { target: { value: "#0f766e" } });
    fireEvent.click(screen.getByRole("button", { name: S.addMenuItem }));
    fireEvent.click(screen.getByRole("button", { name: S.save }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const body = requestBody(fetchMock, "/api/ventures/v1/stages/mvp") as {
      answers: { build_plan: string; mockup_design: WebsiteMockup };
      complete: boolean;
    };
    expect(body.complete).toBe(false);
    expect(body.answers.build_plan).toBe("No-code");
    expect(body.answers.mockup_design.primary_color).toBe("#0f766e");
    expect(body.answers.mockup_design.nav_items).toEqual(ORIGINAL.nav_items); // the empty new item is dropped
  });

  it("adds, reorders and removes features within 2 to 6", async () => {
    stub();
    renderWithProviders(<DesignStudioPage />);
    const preview = await ready();

    expect(screen.getByRole("button", { name: "Remove feature 1" })).toBeDisabled(); // at least two
    fireEvent.click(screen.getByRole("button", { name: S.addFeature }));
    fireEvent.change(within(screen.getByTestId("feature-2")).getByLabelText(S.featureTitle), { target: { value: "Shopping list" } });
    fireEvent.change(within(screen.getByTestId("feature-2")).getByLabelText(S.featureIcon), { target: { value: "cart" } });
    expect(preview).toHaveTextContent("Shopping list");
    fireEvent.click(screen.getByRole("button", { name: "Move feature 3 up" }));
    expect(within(screen.getByTestId("feature-1")).getByLabelText(S.featureTitle)).toHaveValue("Shopping list");
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: S.addFeature }));
    expect(screen.getByRole("button", { name: S.addFeature })).toBeDisabled(); // six at most
  });

  it("blocks saving until the design is valid", async () => {
    stub();
    renderWithProviders(<DesignStudioPage />);
    await ready();

    fireEvent.change(screen.getByLabelText(S.headline), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(S.accentColor, { selector: "input:not([type=color])" }), { target: { value: "yellow" } });
    expect(screen.getByRole("alert")).toHaveTextContent(S.problems.headlineRequired);
    expect(screen.getByRole("alert")).toHaveTextContent(S.problems.badColor);
    expect(screen.getByRole("button", { name: S.save })).toBeDisabled();
  });

  it("discards changes, and can start over from the AI's original", async () => {
    stub(mvpStage({ mockup_design: { ...ORIGINAL, hero_headline: "My saved headline" } }));
    renderWithProviders(<DesignStudioPage />);
    const preview = await ready();
    expect(within(preview).getByTestId("mockup-headline")).toHaveTextContent("My saved headline");
    expect(screen.getByRole("status")).toHaveTextContent(S.yourDesign);

    fireEvent.change(screen.getByLabelText(S.headline), { target: { value: "Scratch" } });
    fireEvent.click(screen.getByRole("button", { name: S.discard }));
    expect(within(preview).getByTestId("mockup-headline")).toHaveTextContent("My saved headline");

    fireEvent.click(screen.getByRole("button", { name: S.resetToOriginal }));
    expect(within(preview).getByTestId("mockup-headline")).toHaveTextContent(ORIGINAL.hero_headline);
    expect(screen.getByRole("button", { name: S.save })).toBeEnabled(); // saving makes it stick
  });

  it("explains when there's no website mock-up to edit", async () => {
    stub(mvpStage({}, null));
    renderWithProviders(<DesignStudioPage />);
    expect(await screen.findByText(S.noMockup)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: new RegExp(S.back) })[0]).toHaveAttribute("href", "/ventures/v1?stage=mvp");
  });

  it("speaks Korean", async () => {
    stub();
    renderWithProviders(<DesignStudioPage />, "ko");
    await ready();
    expect(screen.getByRole("heading", { name: ko.DesignStudio.title })).toBeInTheDocument();
    expect(screen.getByLabelText(ko.DesignStudio.headline)).toBeInTheDocument();
  });
});
