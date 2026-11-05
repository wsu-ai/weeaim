import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../../../../../messages/en.json";
import ko from "../../../../../messages/ko.json";
import type { TokenUsage } from "@/lib/api";
import { renderWithProviders, requestBody, stubApi } from "@/test/auth-helpers";
import TokenUsagePage from "./page";

vi.mock("@/i18n/navigation", async () => (await import("@/test/auth-helpers")).navigationMock);

const T = en.Tokens;

function usage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    ventures: [
      { venture_id: "v1", title: "Korean Recipes", archived: false, tokens: 12_000 },
      { venture_id: "v2", title: "Pet Sitter", archived: true, tokens: 3_000 },
      { venture_id: null, title: null, archived: false, tokens: 500 },
    ],
    organization_total: 15_500,
    limits: { per_venture_limit: 10_000, organization_limit: 50_000 },
    updated_at: "2026-10-20T09:00:00Z",
    can_edit: true,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TokenUsagePage", () => {
  it("shows each venture idea's tokens and the organization total against the limits", async () => {
    stubApi({ "/api/token-usage": { body: usage() } });
    renderWithProviders(<TokenUsagePage />);

    expect(await screen.findByTestId("organization-total")).toHaveTextContent("15,500of 50,000 allowed");
    expect(screen.getByRole("progressbar", { name: T.organizationBar })).toHaveAttribute("aria-valuenow", "31");

    const rows = within(screen.getByTestId("venture-tokens")).getAllByRole("row").slice(1) as HTMLTableRowElement[];
    expect(rows.map((r) => r.cells[0].textContent)).toEqual([
      `Korean Recipes${T.overLimit}`,
      `Pet Sitter${T.archived}`,
      T.deletedVentures,
    ]);
    expect(rows[0]).toHaveTextContent("12,000");
    expect(rows[0]).toHaveTextContent("120%");
    expect(screen.getByRole("progressbar", { name: "Pet Sitter token usage" })).toHaveAttribute("aria-valuenow", "30");
  });

  it("lets an admin change the limits, with empty meaning no limit", async () => {
    const fetchMock = stubApi({
      "/api/token-usage/limits": (init) => ({
        body: usage({ limits: JSON.parse(init.body as string), updated_at: "2026-10-20T10:00:00Z" }),
      }),
      "/api/token-usage": { body: usage() },
    });
    renderWithProviders(<TokenUsagePage />);

    const perVenture = await screen.findByLabelText(T.perVentureLabel);
    expect(perVenture).toHaveValue("10000");
    fireEvent.change(perVenture, { target: { value: "25,000" } });
    fireEvent.change(screen.getByLabelText(T.organizationLabel), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: T.save }));

    await waitFor(() =>
      expect(requestBody(fetchMock, "/api/token-usage/limits")).toEqual({
        per_venture_limit: 25_000,
        organization_limit: null,
      }),
    );
    expect(await screen.findByText(T.saved)).toBeInTheDocument();
  });

  it("rejects limits that aren't whole positive numbers", async () => {
    stubApi({ "/api/token-usage": { body: usage() } });
    renderWithProviders(<TokenUsagePage />);

    fireEvent.change(await screen.findByLabelText(T.perVentureLabel), { target: { value: "12.5" } });
    expect(screen.getByRole("alert")).toHaveTextContent(T.invalidLimit);
    expect(screen.getByRole("button", { name: T.save })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(T.perVentureLabel), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: T.save })).toBeDisabled();
  });

  it("shows the limits read-only to members", async () => {
    stubApi({ "/api/token-usage": { body: usage({ can_edit: false }) } });
    renderWithProviders(<TokenUsagePage />);

    expect(await screen.findByLabelText(T.perVentureLabel)).toHaveAttribute("readonly");
    expect(screen.getByLabelText(T.organizationLabel)).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: T.save })).not.toBeInTheDocument();
    expect(screen.getByText(T.limitsReadOnly)).toBeInTheDocument();
  });

  it("speaks Korean", async () => {
    stubApi({ "/api/token-usage": { body: usage() } });
    renderWithProviders(<TokenUsagePage />, "ko");
    expect(await screen.findByRole("heading", { name: ko.Tokens.title })).toBeInTheDocument();
    expect(await screen.findByLabelText(ko.Tokens.perVentureLabel)).toBeInTheDocument();
  });
});
