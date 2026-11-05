import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../messages/en.json";
import { replaceMock } from "@/test/auth-helpers";
import { RequireSession } from "./require-session";

vi.mock("@/i18n/navigation", async () => (await import("@/test/auth-helpers")).navigationMock);

const SESSION = {
  email: "alice@gmail.com",
  display_name: "Alice",
  organizations: [{ slug: "woosong", name: "Woosong University", role: "member" }],
  active_organization: "woosong",
};

function stubMe(status: number, body: unknown = null) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/api/auth/logout")) return { ok: true, status: 204, json: async () => null };
    return { ok: status < 400, status, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderGuarded() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <RequireSession>
          <p>protected content</p>
        </RequireSession>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  replaceMock.mockClear();
});

describe("RequireSession", () => {
  it("redirects to the login page when signed out", async () => {
    stubMe(401);
    renderGuarded();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/"));
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("redirects when no organization has been chosen yet", async () => {
    stubMe(200, { ...SESSION, active_organization: null });
    renderGuarded();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/"));
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("renders the page and who is signed in", async () => {
    stubMe(200, SESSION);
    renderGuarded();

    expect(await screen.findByText("protected content")).toBeInTheDocument();
    expect(screen.getByText(/Signed in as alice@gmail.com/)).toHaveTextContent(
      "Woosong University",
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("signs out through the API and returns to the login page", async () => {
    const fetchMock = stubMe(200, SESSION);
    renderGuarded();

    fireEvent.click(await screen.findByRole("button", { name: messages.Session.signOut }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/"));
    const logoutCall = fetchMock.mock.calls.find(([url]) => url.endsWith("/api/auth/logout"));
    expect(logoutCall).toBeDefined();
  });

  it("shows the Woosong logo first in the top bar", async () => {
    stubMe(200, SESSION);
    renderGuarded();

    const logo = await screen.findByRole("img", { name: messages.Login.logoAlt });
    expect(logo).toHaveAttribute("src", expect.stringContaining("woosong-logo.png"));
    const header = logo.closest("header")!;
    expect(header.querySelector("img")).toBe(logo);
  });

  it("shows the Admin link only to organization owners and admins", async () => {
    stubMe(200, SESSION); // role: member
    const { unmount } = renderGuarded();
    expect(await screen.findByRole("link", { name: messages.Session.newIdea })).toHaveAttribute(
      "href",
      "/ventures/new",
    );
    expect(screen.queryByRole("link", { name: messages.Session.admin })).not.toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();

    stubMe(200, {
      ...SESSION,
      organizations: [{ slug: "woosong", name: "Woosong University", role: "owner" }],
    });
    renderGuarded();
    expect(await screen.findByRole("link", { name: messages.Session.admin })).toHaveAttribute(
      "href",
      "/admin/signups",
    );
  });
});

describe("RequireSession navigation", () => {
  it("puts My AI Agents between New idea and Settings", async () => {
    stubMe(200, SESSION);
    renderGuarded();
    await screen.findByText("protected content");

    const links = screen.getAllByRole("link").map((link) => link.textContent);
    const at = (label: string) => links.indexOf(label);
    expect(at(messages.Session.myAgents)).toBe(at(messages.Session.newIdea) + 1);
    expect(at(messages.Session.settings)).toBe(at(messages.Session.myAgents) + 1);
    expect(screen.getByRole("link", { name: messages.Session.myAgents })).toHaveAttribute("href", "/agents");
  });
});
