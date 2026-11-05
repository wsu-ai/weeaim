import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../messages/en.json";
import ko from "../../../../messages/ko.json";
import { renderWithProviders, stubApi, type Routes } from "@/test/auth-helpers";
import MyVenturesPage from "./page";

vi.mock("@/i18n/navigation", async () => (await import("@/test/auth-helpers")).navigationMock);

const V = messages.Ventures;
const C = messages.ConfirmVenture;
const SESSION = {
  email: "founder@test.dev",
  display_name: "Founder",
  organizations: [{ slug: "woosong", name: "Woosong University", role: "member" }],
  active_organization: "woosong",
  has_password: true,
};

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

const ARCHIVED = {
  ...venture({ id: "v9", title: "Old Laundry Idea" }),
  archived_at: "2026-10-15T09:00:00Z",
  archived_by_name: "Founder",
  completed_stages: 4,
  total_stages: 15,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function card(title: string): HTMLElement {
  return screen.getByRole("link", { name: title }).closest("li")!;
}

describe("MyVenturesPage", () => {
  it("lists saved ventures with progress and feasibility, linking to each", async () => {
    stubApi({ "/api/ventures/archived": { body: [] }, "/api/ventures": { body: TWO } });
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

  it("shows a trash can right of each title the user may remove", async () => {
    stubApi({
      "/api/ventures/archived": { body: [] },
      "/api/ventures": { body: [venture({ can_delete: false }), TWO[1]] },
    });
    renderWithProviders(<MyVenturesPage />);
    await screen.findByRole("link", { name: "Korean Recipe Assistant" });

    const pet = within(card("Pet Sitter Marketplace"));
    const trash = pet.getByRole("button", { name: "Remove Pet Sitter Marketplace" });
    // Right of the title, in the same header row.
    const title = pet.getByRole("link", { name: "Pet Sitter Marketplace" });
    expect(title.compareDocumentPosition(trash) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      within(card("Korean Recipe Assistant")).queryByRole("button", { name: /^Remove / }),
    ).not.toBeInTheDocument();
  });

  it("asks 'are you sure?', then the password, then archives the venture", async () => {
    let remaining = [...TWO];
    let archivedBody: unknown = null;
    const routes: Routes = {
      "/api/auth/me": { body: SESSION },
      "/api/ventures/v2/archive": (init) => {
        archivedBody = JSON.parse(init.body as string);
        remaining = remaining.filter((v) => v.id !== "v2");
        return { status: 204 };
      },
      "/api/ventures/archived": { body: [] },
      "/api/ventures": () => ({ body: remaining }),
    };
    stubApi(routes);
    renderWithProviders(<MyVenturesPage />);

    await screen.findByRole("link", { name: "Pet Sitter Marketplace" });
    fireEvent.click(screen.getByRole("button", { name: "Remove Pet Sitter Marketplace" }));

    const confirm = screen.getByTestId("confirm-archive");
    expect(confirm).toHaveTextContent("Are you sure you want to remove “Pet Sitter Marketplace”?");
    fireEvent.click(within(confirm).getByRole("button", { name: C.archive.yes }));

    const submit = within(confirm).getByRole("button", { name: C.archive.confirm });
    expect(submit).toBeDisabled();
    fireEvent.change(within(confirm).getByLabelText(C.passwordLabel), { target: { value: "my-password" } });
    fireEvent.click(submit);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Moved “Pet Sitter Marketplace” to Archived ventures.",
    );
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Pet Sitter Marketplace" })).not.toBeInTheDocument(),
    );
    expect(archivedBody).toEqual({ password: "my-password" });
    expect(screen.getByRole("link", { name: "Korean Recipe Assistant" })).toBeInTheDocument();
  });

  it("can cancel, and explains a wrong password or a lockout", async () => {
    let reply = { status: 403, body: { detail: "wrong_password" } };
    stubApi({
      "/api/auth/me": { body: SESSION },
      "/api/ventures/v1/archive": () => reply,
      "/api/ventures/archived": { body: [] },
      "/api/ventures": { body: TWO },
    });
    renderWithProviders(<MyVenturesPage />);
    await screen.findByRole("link", { name: "Korean Recipe Assistant" });

    fireEvent.click(screen.getByRole("button", { name: "Remove Korean Recipe Assistant" }));
    fireEvent.click(screen.getByRole("button", { name: C.cancel }));
    expect(screen.queryByTestId("confirm-archive")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove Korean Recipe Assistant" }));
    fireEvent.click(screen.getByRole("button", { name: C.archive.yes }));
    fireEvent.change(screen.getByLabelText(C.passwordLabel), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: C.archive.confirm }));
    expect(await screen.findByRole("alert")).toHaveTextContent(C.errors.wrong_password);
    expect(screen.getByLabelText(C.passwordLabel)).toHaveValue(""); // cleared for another try

    reply = { status: 429, body: { detail: "too_many_attempts" } };
    fireEvent.change(screen.getByLabelText(C.passwordLabel), { target: { value: "again" } });
    fireEvent.click(screen.getByRole("button", { name: C.archive.confirm }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(C.errors.too_many_attempts));
    expect(screen.getByRole("link", { name: "Korean Recipe Assistant" })).toBeInTheDocument();
  });

  it("confirms with an emailed code when the account has no password", async () => {
    let archivedBody: unknown = null;
    const fetchMock = stubApi({
      "/api/auth/me": { body: { ...SESSION, has_password: false } },
      "/api/ventures/v1/reauth-code": { status: 202, body: { status: "sent" } },
      "/api/ventures/v1/archive": (init) => {
        archivedBody = JSON.parse(init.body as string);
        return { status: 204 };
      },
      "/api/ventures/archived": { body: [] },
      "/api/ventures": { body: TWO },
    });
    renderWithProviders(<MyVenturesPage />);
    await screen.findByRole("link", { name: "Korean Recipe Assistant" });

    fireEvent.click(screen.getByRole("button", { name: "Remove Korean Recipe Assistant" }));
    fireEvent.click(screen.getByRole("button", { name: C.archive.yes }));
    await waitFor(() => expect(screen.getByText(C.codeIntro)).toBeInTheDocument());
    expect(screen.queryByLabelText(C.passwordLabel)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: C.sendCode }));
    expect(await screen.findByText("We sent a code to founder@test.dev.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(C.codeLabel), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: C.archive.confirm }));

    await waitFor(() => expect(archivedBody).toEqual({ code: "123456" }));
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/api/ventures/v1/reauth-code"))).toBe(true);
  });

  it("lists archived ventures to restore, download or delete permanently", async () => {
    let archived = [ARCHIVED];
    let deleteBody: unknown = null;
    stubApi({
      "/api/auth/me": { body: SESSION },
      "/api/ventures/v9/restore": () => {
        archived = [];
        return { body: venture({ id: "v9" }) };
      },
      "/api/ventures/v9/delete-permanently": (init) => {
        deleteBody = JSON.parse(init.body as string);
        archived = [];
        return { status: 204 };
      },
      "/api/ventures/archived": () => ({ body: archived }),
      "/api/ventures": { body: TWO },
    });
    renderWithProviders(<MyVenturesPage />);

    const toggle = await screen.findByRole("button", { name: "Archived ventures (1)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const section = screen.getByTestId("archived-ventures");
    expect(section).toHaveTextContent("Old Laundry Idea");
    expect(section).toHaveTextContent("4 of 15 stages completed");
    expect(within(section).getByRole("button", { name: V.restore })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: V.downloadArchive })).toBeInTheDocument();

    fireEvent.click(within(section).getByRole("button", { name: V.deletePermanently }));
    const confirm = screen.getByTestId("confirm-delete");
    expect(confirm).toHaveTextContent("Permanently delete “Old Laundry Idea”?");
    fireEvent.click(within(confirm).getByRole("button", { name: C.delete.yes }));
    fireEvent.change(within(confirm).getByLabelText(C.passwordLabel), { target: { value: "pw" } });
    fireEvent.click(within(confirm).getByRole("button", { name: C.delete.confirm }));

    expect(await screen.findByRole("status")).toHaveTextContent("Permanently deleted “Old Laundry Idea”.");
    expect(deleteBody).toEqual({ password: "pw" });
    await waitFor(() => expect(screen.queryByTestId("archived-ventures")).not.toBeInTheDocument());
  });

  it("restores an archived venture", async () => {
    let archived = [ARCHIVED];
    let listed = [...TWO];
    stubApi({
      "/api/ventures/v9/restore": () => {
        archived = [];
        listed = [...listed, venture({ id: "v9", title: "Old Laundry Idea" })];
        return { body: venture({ id: "v9" }) };
      },
      "/api/ventures/archived": () => ({ body: archived }),
      "/api/ventures": () => ({ body: listed }),
    });
    renderWithProviders(<MyVenturesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Archived ventures (1)" }));
    fireEvent.click(screen.getByRole("button", { name: V.restore }));

    expect(await screen.findByRole("status")).toHaveTextContent("Restored “Old Laundry Idea”.");
    expect(await screen.findByRole("link", { name: "Old Laundry Idea" })).toHaveAttribute("href", "/ventures/v9");
  });

  it("invites the user to start when there are no ventures", async () => {
    stubApi({ "/api/ventures/archived": { body: [] }, "/api/ventures": { body: [] } });
    renderWithProviders(<MyVenturesPage />);

    expect(await screen.findByText(V.empty)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: V.startFirst })).toHaveAttribute("href", "/ventures/new");
  });

  it("asks for confirmation in Korean", async () => {
    stubApi({
      "/api/auth/me": { body: SESSION },
      "/api/ventures/archived": { body: [] },
      "/api/ventures": { body: TWO },
    });
    renderWithProviders(<MyVenturesPage />, "ko");
    await screen.findByRole("link", { name: "Pet Sitter Marketplace" });

    fireEvent.click(screen.getByRole("button", { name: "Pet Sitter Marketplace 삭제" }));
    expect(screen.getByText("“Pet Sitter Marketplace”을(를) 정말 삭제하시겠습니까?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ko.ConfirmVenture.archive.yes }));
    expect(screen.getByLabelText(ko.ConfirmVenture.passwordLabel)).toBeInTheDocument();
  });
});
