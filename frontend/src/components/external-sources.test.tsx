import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../../messages/en.json";
import ko from "../../messages/ko.json";
import type { ExternalSourceList } from "@/lib/api";
import { renderWithProviders, stubApi } from "@/test/auth-helpers";
import { ResearchSidebar } from "./research-sidebar";

vi.mock("@/i18n/navigation", async () => (await import("@/test/auth-helpers")).navigationMock);

const E = en.ExternalSources;

const SOURCE = {
  id: "s1",
  name: "Market API",
  url_template: "https://api.market.example/search?q={query}",
  header_name: "X-Api-Key",
  has_key: true,
  enabled: true,
  last_status: "ok" as const,
  last_error: null,
  last_used_at: "2026-10-29T09:00:00Z",
};

function list(overrides: Partial<ExternalSourceList> = {}): ExternalSourceList {
  return { sources: [SOURCE], can_edit: true, keys_supported: true, ...overrides };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderSidebar({ externalSources = true, locale = "en" as "en" | "ko", sources = [] as { title: string; url: string; via?: string }[] } = {}) {
  renderWithProviders(
    <ResearchSidebar
      research={{ sources }}
      runs={[]}
      viewingRunId={null}
      onSelectRun={vi.fn()}
      externalSources={externalSources}
    />,
    locale,
  );
}

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: E.button }));
  return screen.findByRole("dialog", { name: E.title });
}

describe("External sources", () => {
  it("puts the External Source button under Sources, only where enabled", () => {
    stubApi({});
    renderSidebar();
    const sources = screen.getByRole("heading", { name: en.ResearchSidebar.sourcesTitle }).closest("section")!;
    expect(within(sources).getByRole("button", { name: E.button })).toBeInTheDocument();
  });

  it("is not offered on other stages", () => {
    stubApi({});
    renderSidebar({ externalSources: false });
    expect(screen.queryByRole("button", { name: E.button })).not.toBeInTheDocument();
  });

  it("tags sources that came from an external source", () => {
    stubApi({});
    renderSidebar({ sources: [{ title: "KimchiCo", url: "https://kimchico.example/", via: "Market API" }] });
    expect(screen.getByText("via Market API")).toBeInTheDocument();
  });

  it("lists the organization's sources without ever showing a key", async () => {
    stubApi({ "/api/external-sources": { body: list() } });
    renderSidebar();
    const dialog = await openDialog();
    const row = await within(dialog).findByTestId("external-source-s1");
    expect(row).toHaveTextContent("Market API");
    expect(row).toHaveTextContent(SOURCE.url_template);
    expect(row).toHaveTextContent("Key saved (X-Api-Key)");
  });

  it("lets an admin add a source with an API key in a password field", async () => {
    const fetchMock = stubApi({ "/api/external-sources": (init) => (init.method === "POST" ? { status: 201, body: SOURCE } : { body: list({ sources: [] }) }) });
    renderSidebar();
    const dialog = await openDialog();
    await within(dialog).findByText(E.none);
    expect(within(dialog).getByText("Must start with https:// and contain {query} where the search words go.")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(E.name), { target: { value: "Market API" } });
    fireEvent.change(within(dialog).getByLabelText(E.url), { target: { value: "https://api.market.example/search?q={query}" } });
    const key = within(dialog).getByLabelText(E.key);
    expect(key).toHaveAttribute("type", "password");
    fireEvent.change(key, { target: { value: "sk-123" } });
    fireEvent.click(within(dialog).getByRole("button", { name: E.add }));

    const posted = () => fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    await waitFor(() => expect(posted()).toBeDefined());
    await waitFor(() =>
      expect(JSON.parse(posted()![1]!.body as string)).toEqual({
        name: "Market API",
        url_template: "https://api.market.example/search?q={query}",
        header_name: "Authorization",
        api_key: "sk-123",
      }),
    );
    await waitFor(() => expect(within(dialog).getByLabelText(E.key)).toHaveValue("")); // cleared after saving
  });

  it("needs {query} before adding, and explains the server's refusals", async () => {
    stubApi({
      "/api/external-sources": (init) =>
        init.method === "POST" ? { status: 422, body: { detail: "private_address" } } : { body: list({ sources: [] }) },
    });
    renderSidebar();
    const dialog = await openDialog();
    await within(dialog).findByText(E.none);
    fireEvent.change(within(dialog).getByLabelText(E.name), { target: { value: "Intranet" } });
    fireEvent.change(within(dialog).getByLabelText(E.url), { target: { value: "https://intranet.example/search" } });
    expect(within(dialog).getByRole("button", { name: E.add })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(E.url), { target: { value: "https://intranet.example/search?q={query}" } });
    fireEvent.click(within(dialog).getByRole("button", { name: E.add }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(E.errors.private_address);
  });

  it("tests and deletes a source", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = stubApi({
      "/api/external-sources/s1/test": { body: { status: "ok", error: null, items: 3, sample_titles: ["KimchiCo", "Seoul Bites"] } },
      "/api/external-sources/s1": { status: 204 },
      "/api/external-sources": { body: list() },
    });
    renderSidebar();
    const dialog = await openDialog();
    const row = await within(dialog).findByTestId("external-source-s1");
    fireEvent.click(within(row).getByRole("button", { name: E.test }));
    expect(await within(row).findByTestId("test-result")).toHaveTextContent("Worked: 3 items returned. KimchiCo, Seoul Bites");
    fireEvent.click(within(row).getByRole("button", { name: "Delete Market API" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/external-sources/s1") && init?.method === "DELETE")).toBe(true),
    );
  });

  it("shows members a read-only list", async () => {
    stubApi({ "/api/external-sources": { body: list({ can_edit: false }) } });
    renderSidebar();
    const dialog = await openDialog();
    expect(await within(dialog).findByText(E.readOnly)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: E.add })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: E.test })).not.toBeInTheDocument();
  });

  it("says when the server can't store keys", async () => {
    stubApi({ "/api/external-sources": { body: list({ sources: [], keys_supported: false }) } });
    renderSidebar();
    const dialog = await openDialog();
    expect(await within(dialog).findByText(E.keysNotSupported)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(E.key)).not.toBeInTheDocument();
  });

  it("speaks Korean", async () => {
    stubApi({ "/api/external-sources": { body: list() } });
    renderSidebar({ locale: "ko" });
    fireEvent.click(screen.getByRole("button", { name: ko.ExternalSources.button }));
    expect(await screen.findByRole("dialog", { name: ko.ExternalSources.title })).toBeInTheDocument();
  });
});
