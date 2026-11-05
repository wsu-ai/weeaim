import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../messages/en.json";
import ko from "../../messages/ko.json";
import type {
  WebsiteMockup as WebsiteMockupContent, MvpAnalysis, OfferingType } from "@/lib/api";
import { renderWithProviders, stubApi } from "@/test/auth-helpers";
import { MvpPanel, readableTextOn } from "./mvp-panel";

vi.mock("@/i18n/navigation", async () => (await import("@/test/auth-helpers")).navigationMock);

const M = messages.Mvp;
const RESEARCH_PATH = "/api/ventures/v1/stages/mvp/research";

const BASE: Omit<MvpAnalysis, "offering_type" | "physical_product" | "website_mockup" | "offline_service"> = {
  kind: "mvp",
  offering_type_reason: "Customers hold and use it at home.",
  offering_type_source: "ai",
  name: "KimchiKit Starter",
  tagline: "Cook your first kimchi in an evening.",
  summary: "A starter kit with a jar and a guided recipe card.",
  target_user: "Busy families new to Korean cooking",
  problem_solved: "Korean recipes feel intimidating.",
  core_features: [{ feature: "Step-by-step guide", why: "Beginners need structure." }],
  left_out_for_now: ["Live coaching"],
  how_to_test: ["Sell 20 kits at a weekend market."],
  image: null,
  image_failed: false,
  confidence: 0.5,
  sources: [],
  researched_at: "2026-10-13T09:00:00Z",
  based_on: null,
  language: "en",
};

const PRODUCT: MvpAnalysis = {
  ...BASE,
  offering_type: "physical_product",
  physical_product: {
    image_prompt: "A ceramic jar.",
    materials: ["Ceramic", "Bamboo"],
    dimensions: "20 x 15 x 15 cm",
    components: ["Jar", "Lid"],
    prototype_route: "Buy off-the-shelf jars.",
  },
  website_mockup: null,
  offline_service: null,
  image: { asset_id: "asset-1", content_type: "image/webp" },
};

const ONLINE: MvpAnalysis = {
  ...BASE,
  offering_type: "online_service",
  physical_product: null,
  offline_service: null,
  website_mockup: {
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
  },
};

const OFFLINE: MvpAnalysis = {
  ...BASE,
  offering_type: "offline_service",
  physical_product: null,
  website_mockup: null,
  offline_service: {
    overview: "Weekend cooking classes in community kitchens.",
    customer_journey: [
      { step: "Book", what_happens: "Choose a class online." },
      { step: "Cook", what_happens: "Cook with a chef." },
    ],
    delivery: { where: "Community kitchens", who_delivers: "Local chefs", when: "Weekends" },
    what_customer_gets: ["A 2-hour class"],
    resources_needed: ["Kitchen rental"],
    pricing_note: "$40 per class.",
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel(
  analysis: MvpAnalysis | null,
  {
    locale = "en" as "en" | "ko",
    historical = false,
    design = null as WebsiteMockupContent | null,
    onSetOfferingType = vi.fn(async (type: OfferingType) => {
      void type;
    }),
  } = {},
) {
  renderWithProviders(
    <MvpPanel
      ventureId="v1"
      analysis={analysis}
      design={design}
      language={locale}
      onSetOfferingType={onSetOfferingType}
      onResearched={vi.fn()}
      historical={historical}
    />,
    locale,
  );
  return onSetOfferingType;
}

describe("MvpPanel", () => {
  it("offers the Design Studio right below the website mock-up", () => {
    stubApi({});
    renderPanel(ONLINE);
    const button = screen.getByRole("link", { name: M.designStudio });
    expect(button).toHaveAttribute("href", "/ventures/v1/design-studio");
    const mockup = screen.getByTestId("website-mockup");
    expect(mockup.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mockup.parentElement).toContainElement(button);
  });

  it("shows the founder's saved design, with the AI's original a click away", () => {
    stubApi({});
    renderPanel(ONLINE, { design: { ...ONLINE.website_mockup!, hero_headline: "My own headline" } });

    expect(screen.getByTestId("mockup-headline")).toHaveTextContent("My own headline");
    expect(screen.getByTestId("design-note")).toHaveTextContent(M.showingDesign);
    fireEvent.click(screen.getByRole("button", { name: M.showOriginal }));
    expect(screen.getByTestId("mockup-headline")).toHaveTextContent("Cook Korean food with confidence");
    fireEvent.click(screen.getByRole("button", { name: M.showMyDesign }));
    expect(screen.getByTestId("mockup-headline")).toHaveTextContent("My own headline");
  });

  it("has no Design Studio for an earlier run or a non-website MVP", () => {
    stubApi({});
    renderPanel(ONLINE, { historical: true });
    expect(screen.queryByRole("link", { name: M.designStudio })).not.toBeInTheDocument();
  });

  it("has no Design Studio for a physical product", () => {
    stubApi({});
    renderPanel(PRODUCT);
    expect(screen.queryByRole("link", { name: M.designStudio })).not.toBeInTheDocument();
  });

  it("shows a physical product's generated image and specs", () => {
    stubApi({});
    renderPanel(PRODUCT);

    expect(screen.getByTestId("mvp-concept")).toHaveTextContent("KimchiKit Starter");
    const image = screen.getByRole("img", { name: /Concept image of KimchiKit Starter/ });
    expect(image).toHaveAttribute("src", "/api/ventures/v1/assets/asset-1");
    const product = screen.getByTestId("mvp-product");
    expect(product).toHaveTextContent("Ceramic, Bamboo");
    expect(product).toHaveTextContent("20 x 15 x 15 cm");
    expect(product).toHaveTextContent(M.imageCaption);
    expect(screen.queryByTestId("website-mockup")).not.toBeInTheDocument();
  });

  it("explains when the product image couldn't be generated", () => {
    stubApi({});
    renderPanel({ ...PRODUCT, image: null, image_failed: true });

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(M.imageFailed)).toBeInTheDocument();
  });

  it("draws a sample website page for an online service", () => {
    stubApi({});
    renderPanel(ONLINE);

    const mockup = screen.getByTestId("website-mockup");
    expect(screen.getByTestId("website-mockup")).toHaveClass("border-4", "border-blue-900"); // thick dark-blue frame
    expect(mockup).toHaveAccessibleName("Sample website page for Kimchi Kit");
    expect(within(mockup).getByText(M.mockupLabel)).toBeInTheDocument();
    expect(within(mockup).getByText("kimchikit.example")).toBeInTheDocument();
    expect(screen.getByTestId("mockup-headline")).toHaveTextContent("Cook Korean food with confidence");
    const cta = screen.getByTestId("mockup-cta");
    expect(cta).toHaveTextContent("Start free");
    expect(cta.tagName).toBe("SPAN"); // inert: a picture of a button, not a link
    expect(cta).toHaveStyle({ backgroundColor: "#fde047", color: "#111827" }); // dark text on yellow
    expect(screen.getAllByTestId("mockup-feature")).toHaveLength(2);
    expect(within(mockup).getByText("From $10 a month.")).toBeInTheDocument();
    expect(within(mockup).queryByRole("link")).not.toBeInTheDocument();
  });

  it("never lets a bad colour reach the page's styles", () => {
    stubApi({});
    renderPanel({
      ...ONLINE,
      website_mockup: { ...ONLINE.website_mockup!, primary_color: "red;background:url(https://x)" },
    });

    expect(screen.getByTestId("mockup-headline").parentElement).toHaveStyle({ backgroundColor: "#1d4ed8" });
  });

  it("picks readable text for any brand colour", () => {
    expect(readableTextOn("#b91c1c")).toBe("#ffffff");
    expect(readableTextOn("#fde047")).toBe("#111827");
    expect(readableTextOn("not-a-colour")).toBe("#ffffff");
  });

  it("describes an offline service", () => {
    stubApi({});
    renderPanel(OFFLINE);

    const service = screen.getByTestId("mvp-service");
    expect(service).toHaveTextContent("Weekend cooking classes in community kitchens.");
    expect(within(service).getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
    expect(service).toHaveTextContent("Community kitchens");
    expect(service).toHaveTextContent("$40 per class.");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("lets the founder change the offering type, then re-designs", async () => {
    let calls = 0;
    stubApi({
      [RESEARCH_PATH]: () => {
        calls += 1;
        return { body: { ...ONLINE, offering_type_source: "founder" } };
      },
    });
    const onSetOfferingType = renderPanel(PRODUCT);

    expect(screen.getByRole("radio", { name: M.offeringTypes.physical_product })).toBeChecked();
    expect(screen.getByText(`Chosen by AI: ${BASE.offering_type_reason}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: M.offeringTypes.online_service }));

    await waitFor(() => expect(onSetOfferingType).toHaveBeenCalledWith("online_service"));
    expect(await screen.findByTestId("website-mockup")).toBeInTheDocument();
    expect(screen.getByText(M.typeChosenByYou)).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it("designs automatically, retries, and refreshes", async () => {
    let calls = 0;
    stubApi({
      [RESEARCH_PATH]: () => {
        calls += 1;
        return calls === 1 ? { status: 503, body: null } : { body: calls === 2 ? OFFLINE : PRODUCT };
      },
    });
    renderPanel(null);

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Login.errorUnavailable);
    fireEvent.click(screen.getByRole("button", { name: M.retry }));
    expect(await screen.findByTestId("mvp-service")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: M.refresh }));
    expect(await screen.findByTestId("mvp-product")).toBeInTheDocument();
    expect(calls).toBe(3);
  });

  it("is read-only for an earlier MVP", () => {
    stubApi({});
    renderPanel(PRODUCT, { historical: true });

    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: M.refresh })).not.toBeInTheDocument();
  });

  it("renders in Korean", () => {
    stubApi({});
    renderPanel({ ...ONLINE, language: "ko" }, { locale: "ko" });

    expect(screen.getByText(ko.Mvp.title)).toBeInTheDocument();
    expect(screen.getByText(ko.Mvp.mockupLabel)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: ko.Mvp.offeringTypes.online_service })).toBeChecked();
  });
});
