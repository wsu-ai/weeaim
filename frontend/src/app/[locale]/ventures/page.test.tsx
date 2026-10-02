import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../messages/en.json";
import ko from "../../../../messages/ko.json";
import { renderWithProviders, stubApi, type Routes } from "@/test/auth-helpers";
import MyVenturesPage from "./page";

vi.mock("@/i18n/navigation", async () => (await import("@/test/auth-helpers")).navigationMock);

const V = messages.Ventures;

function venture(overrides: Record<string, unknown>) {
  return {
    id: "v1",
    organization_id: "o1",
    title: "Korean Recipe Assistant",
    original_idea: "An AI-powered cooking assistant for Korean recipes.",
    current_idea_statement: null,
    status: "active",
    current_wizard_stage: "idea_discovery",
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-02T09:00:00Z",
    completed_stages: 2,
    total_stages: 11,
    feasibility_score: 68,
    researched_at: "2026-10-02T08:00:00Z",
    can_delete: true,
    ...overrides,
  };
}

const TWO = [
  venture({}),
  venture({
    id: "v2",
    title: "Pet Sitter Marketplace",
    completed_stages: 0,
    feasibility_score: null,
    researched_at: null,
  }),
];

afterEach(() => {
  vi.unstubAllGlobals();
});

function card(title: string): HTMLElement {
  return screen.getByRole("link", { name: title }).closest("li")!;
}

describe("MyVenturesPage", () => {
  it("lists saved ventures with progress and feasibility, linking to each", async () => {
    stubApi({ "/api/ventures": { body: TWO } });
    renderWithProviders(<MyVenturesPage />);

    const title = await screen.findByRole("link", { name: "Korean Recipe Assistant" });
    expect(title).toHaveAttribute("href", "/ventures/v1");
    const first = card("Korean Recipe Assistant");
    expect(first).toHaveTextContent("2 of 11 stages completed");
    expect(first).toHaveTextContent("Degree of Feasibility: 68%");
    expect(within(first).getByRole("link", { name: V.continue })).toHaveAttribute("href", "/ventures/v1");
    expect(screen.getByRole("progressbar", { name: "Korean Recipe Assistant progress" })).toHaveAttribute(
      "aria-valuenow",
      "18",
    );
    expect(card("Pet Sitter Marketplace")).toHaveTextContent(V.notResearched);
  });

  it("shows a delete button right of each title when several ventures exist", async () => {
    stubApi({ "/api/ventures": { body: TWO } });
    renderWithProviders(<MyVenturesPage />);

    await screen.findByRole("link", { name: "Korean Recipe Assistant" });
    for (const title of ["Korean Recipe Assistant", "Pet Sitter Marketplace"]) {
      expect(within(card(title)).getByRole("button", { name: `Delete ${title}` })).toBeInTheDocument();
    }
  });

  it("hides the delete button with only one venture, or without permission", async () => {
    stubApi({ "/api/ventures": { body: [venture({})] } });
    const { unmount } = renderWithProviders(<MyVenturesPage />);
    await screen.findByRole("link", { name: "Korean Recipe Assistant" });
    expect(screen.queryByRole("button", { name: /^Delete / })).not.toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();

    stubApi({ "/api/ventures": { body: [venture({ can_delete: false }), TWO[1]] } });
    renderWithProviders(<MyVenturesPage />);
    await screen.findByRole("link", { name: "Korean Recipe Assistant" });
    expect(
      within(card("Korean Recipe Assistant")).queryByRole("button", { name: /^Delete / }),
    ).not.toBeInTheDocument();
    expect(
      within(card("Pet Sitter Marketplace")).getByRole("button", { name: "Delete Pet Sitter Marketplace" }),
    ).toBeInTheDocument();
  });

  it("deletes only after the title is typed, then removes the venture", async () => {
    let remaining = [...TWO];
    const routes: Routes = {
      "/api/ventures/v2": (init) => {
        expect(init.method).toBe("DELETE");
        remaining = remaining.filter((v) => v.id !== "v2");
        return { status: 204 };
      },
      "/api/ventures": () => ({ body: remaining }),
    };
    const fetchMock = stubApi(routes);
    renderWithProviders(<MyVenturesPage />);

    await screen.findByRole("link", { name: "Pet Sitter Marketplace" });
    fireEvent.click(screen.getByRole("button", { name: "Delete Pet Sitter Marketplace" }));

    const confirm = screen.getByRole("button", { name: V.confirmDelete });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(V.typeTitle), { target: { value: "Pet Sitter" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(V.typeTitle), { target: { value: "Pet Sitter Marketplace" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(await screen.findByRole("status")).toHaveTextContent("Deleted “Pet Sitter Marketplace”.");
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Pet Sitter Marketplace" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "Korean Recipe Assistant" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, init]) => url.endsWith("/api/ventures/v2") && init?.method === "DELETE")).toBe(true);
  });

  it("can cancel, and explains a refused deletion", async () => {
    stubApi({
      "/api/ventures/v1": { status: 403, body: { detail: "Only the venture's creator or an organization admin can delete it" } },
      "/api/ventures": { body: TWO },
    });
    renderWithProviders(<MyVenturesPage />);
    await screen.findByRole("link", { name: "Korean Recipe Assistant" });

    fireEvent.click(screen.getByRole("button", { name: "Delete Korean Recipe Assistant" }));
    fireEvent.click(screen.getByRole("button", { name: V.cancel }));
    expect(screen.queryByRole("button", { name: V.confirmDelete })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete Korean Recipe Assistant" }));
    fireEvent.change(screen.getByLabelText(V.typeTitle), { target: { value: "Korean Recipe Assistant" } });
    fireEvent.click(screen.getByRole("button", { name: V.confirmDelete }));

    expect(await screen.findByRole("alert")).toHaveTextContent(V.notAllowed);
    expect(screen.getByRole("link", { name: "Korean Recipe Assistant" })).toBeInTheDocument();
  });

  it("invites the user to start when there are no ventures", async () => {
    stubApi({ "/api/ventures": { body: [] } });
    renderWithProviders(<MyVenturesPage />);

    expect(await screen.findByText(V.empty)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: V.startFirst })).toHaveAttribute("href", "/ventures/new");
  });

  it("renders the delete confirmation in Korean", async () => {
    stubApi({ "/api/ventures": { body: TWO } });
    renderWithProviders(<MyVenturesPage />, "ko");
    await screen.findByRole("link", { name: "Pet Sitter Marketplace" });

    fireEvent.click(screen.getByRole("button", { name: "Pet Sitter Marketplace 삭제" }));
    expect(screen.getByRole("button", { name: ko.Ventures.confirmDelete })).toBeDisabled();
  });
});
