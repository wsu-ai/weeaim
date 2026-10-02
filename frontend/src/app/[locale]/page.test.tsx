import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../../messages/en.json";
import LoginPage from "./page";

const replaceMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string | { pathname: string; query?: Record<string, string> };
    children: React.ReactNode;
  }) => (
    <a
      href={
        typeof href === "string"
          ? href
          : `${href.pathname}?${new URLSearchParams(href.query ?? {}).toString()}`
      }
      {...props}
    >
      {children}
    </a>
  ),
}));

// Stands in for Google's button: "clicking" it yields an ID token, the same
// thing Google Identity Services hands the real component.
vi.mock("@/components/google-sign-in-button", () => ({
  GoogleSignInButton: ({ onCredential }: { onCredential: (c: string) => void }) => (
    <button onClick={() => onCredential("fake-google-id-token")}>Sign in with Google</button>
  ),
}));

type Reply = { status?: number; body?: unknown };
type Routes = Record<string, Reply | ((init: RequestInit) => Reply)>;

const SIGNED_OUT: Reply = { status: 401, body: { detail: "Not signed in" } };
const CONFIG: Reply = {
  body: { google_client_id: "client-id.apps.googleusercontent.com", dev_login_enabled: true },
};
const ONE_ORG_SESSION = {
  email: "alice@gmail.com",
  display_name: "Alice",
  organizations: [{ slug: "woosong", name: "Woosong University", role: "member" }],
  active_organization: "woosong",
};

function stubApi(routes: Routes) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = Object.keys(routes).find((p) => url.endsWith(p));
    const route = path && routes[path];
    if (!route) throw new Error(`Unexpected request: ${url}`);
    const { status = 200, body = null } = typeof route === "function" ? route(init) : route;
    return { ok: status < 400, status, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <LoginPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  replaceMock.mockClear();
});

describe("LoginPage", () => {
  it("shows the product heading and the Woosong logo", () => {
    stubApi({ "/api/auth/me": SIGNED_OUT, "/api/auth/config": CONFIG });
    renderPage();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Woosong Evidence-based Entrepreneurship AI Model",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: messages.Login.logoAlt })).toHaveAttribute(
      "src",
      expect.stringContaining("woosong-logo.png"),
    );
  });

  it("signs in with Google and redirects", async () => {
    const fetchMock = stubApi({
      "/api/auth/me": SIGNED_OUT,
      "/api/auth/config": CONFIG,
      "/api/auth/google": { body: ONE_ORG_SESSION },
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/ventures"));
    const googleCall = fetchMock.mock.calls.find(([url]) => url.endsWith("/api/auth/google"));
    expect(JSON.parse(googleCall![1]!.body as string)).toEqual({
      credential: "fake-google-id-token",
    });
    expect(googleCall![1]!.credentials).toBe("include");
  });

  it("explains when the Google account hasn't been invited", async () => {
    stubApi({
      "/api/auth/me": SIGNED_OUT,
      "/api/auth/config": CONFIG,
      "/api/auth/google": { status: 403, body: { detail: "This account has not been invited" } },
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Login.errorNotInvited);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("reports a Google token the backend couldn't verify", async () => {
    stubApi({
      "/api/auth/me": SIGNED_OUT,
      "/api/auth/config": CONFIG,
      "/api/auth/google": { status: 401, body: null },
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Login.errorGoogleFailed);
  });

  it("says the service is unavailable when the backend returns 503", async () => {
    stubApi({
      "/api/auth/me": SIGNED_OUT,
      "/api/auth/config": CONFIG,
      "/api/auth/google": { status: 503, body: { detail: "A required service is temporarily unavailable." } },
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Login.errorUnavailable);
  });

  it("says the service is unavailable when the backend can't be reached", async () => {
    stubApi({
      "/api/auth/me": SIGNED_OUT,
      "/api/auth/config": CONFIG,
      "/api/auth/google": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Login.errorUnavailable);
  });

  it("says the service is unavailable for development sign-in too", async () => {
    stubApi({
      "/api/auth/me": SIGNED_OUT,
      "/api/auth/config": CONFIG,
      "/api/auth/dev-login": { status: 503, body: null },
    });
    renderPage();

    fireEvent.change(await screen.findByLabelText(messages.Login.emailLabel), {
      target: { value: "dev@weeaim.local" },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.Login.devSubmit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Login.errorUnavailable);
  });

  it("still says sign-in failed for other server errors", async () => {
    stubApi({
      "/api/auth/me": SIGNED_OUT,
      "/api/auth/config": CONFIG,
      "/api/auth/google": { status: 500, body: null },
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Login.errorFailed);
  });

  it("asks which organization when the user belongs to several", async () => {
    const multiOrg = {
      ...ONE_ORG_SESSION,
      organizations: [
        { slug: "org-a", name: "Org A", role: "owner" },
        { slug: "org-b", name: "Org B", role: "member" },
      ],
      active_organization: null,
    };
    const fetchMock = stubApi({
      "/api/auth/me": SIGNED_OUT,
      "/api/auth/config": CONFIG,
      "/api/auth/google": { body: multiOrg },
      "/api/auth/select-organization": { body: { ...multiOrg, active_organization: "org-b" } },
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));
    fireEvent.click(await screen.findByRole("button", { name: "Org B" }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/ventures"));
    const selectCall = fetchMock.mock.calls.find(([url]) =>
      url.endsWith("/api/auth/select-organization"),
    );
    expect(JSON.parse(selectCall![1]!.body as string)).toEqual({ slug: "org-b" });
  });

  it("signs in with the development email form", async () => {
    stubApi({
      "/api/auth/me": SIGNED_OUT,
      "/api/auth/config": CONFIG,
      "/api/auth/dev-login": { body: ONE_ORG_SESSION },
    });
    renderPage();

    fireEvent.change(await screen.findByLabelText(messages.Login.emailLabel), {
      target: { value: "dev@weeaim.local" },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.Login.devSubmit }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/ventures"));
  });

  it("validates the development email before calling the API", async () => {
    const fetchMock = stubApi({ "/api/auth/me": SIGNED_OUT, "/api/auth/config": CONFIG });
    renderPage();

    fireEvent.change(await screen.findByLabelText(messages.Login.emailLabel), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.Login.devSubmit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Login.errorEmailInvalid);
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/dev-login"))).toBe(false);
  });

  it("hides development sign-in when the server disables it", async () => {
    stubApi({
      "/api/auth/me": SIGNED_OUT,
      "/api/auth/config": {
        body: { google_client_id: "client-id.apps.googleusercontent.com", dev_login_enabled: false },
      },
    });
    renderPage();

    expect(await screen.findByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(screen.queryByLabelText(messages.Login.emailLabel)).not.toBeInTheDocument();
  });

  it("says so when Google sign-in isn't configured", async () => {
    stubApi({
      "/api/auth/me": SIGNED_OUT,
      "/api/auth/config": { body: { google_client_id: null, dev_login_enabled: true } },
    });
    renderPage();

    expect(await screen.findByText(messages.Login.googleNotConfigured)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
  });

  it("links to the sign-up page", async () => {
    stubApi({ "/api/auth/me": SIGNED_OUT, "/api/auth/config": CONFIG });
    renderPage();

    expect(screen.getByRole("link", { name: messages.Login.signUpLink })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(screen.getByRole("link", { name: messages.Login.forgotPassword })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  function signInWithPassword(email: string, password: string) {
    fireEvent.change(screen.getByLabelText(messages.Login.passwordEmailLabel), {
      target: { value: email },
    });
    fireEvent.change(screen.getByLabelText(messages.Login.passwordLabel), {
      target: { value: password },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.Login.passwordSubmit }));
  }

  it("signs in with email and password", async () => {
    const fetchMock = stubApi({
      "/api/auth/me": SIGNED_OUT,
      "/api/auth/config": CONFIG,
      "/api/auth/login": { body: ONE_ORG_SESSION },
    });
    renderPage();

    signInWithPassword("alice@gmail.com", "correct horse battery");

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/ventures"));
    const loginCall = fetchMock.mock.calls.find(([url]) => url.endsWith("/api/auth/login"));
    expect(JSON.parse(loginCall![1]!.body as string)).toEqual({
      email: "alice@gmail.com",
      password: "correct horse battery",
    });
  });

  it.each([
    [401, "Invalid email or password", messages.Login.errorInvalidCredentials],
    [403, "pending_approval", messages.Login.errorPendingApproval],
    [403, "account_disabled", messages.Login.errorAccountDisabled],
    [429, "too_many_attempts", messages.Login.errorTooManyAttempts],
  ])("explains a %i %s password sign-in", async (status, detail, message) => {
    stubApi({
      "/api/auth/me": SIGNED_OUT,
      "/api/auth/config": CONFIG,
      "/api/auth/login": { status, body: { detail } },
    });
    renderPage();

    signInWithPassword("alice@gmail.com", "some password");

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("offers email verification when the address isn't verified yet", async () => {
    stubApi({
      "/api/auth/me": SIGNED_OUT,
      "/api/auth/config": CONFIG,
      "/api/auth/login": { status: 403, body: { detail: "email_not_verified" } },
    });
    renderPage();

    signInWithPassword("new@gmail.com", "correct horse battery");

    expect(await screen.findByRole("link", { name: messages.Login.verifyNow })).toHaveAttribute(
      "href",
      "/verify-email?email=new%40gmail.com",
    );
  });

  it("requires a password before calling the API", async () => {
    const fetchMock = stubApi({ "/api/auth/me": SIGNED_OUT, "/api/auth/config": CONFIG });
    renderPage();

    signInWithPassword("alice@gmail.com", "");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      messages.Login.errorPasswordRequired,
    );
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/api/auth/login"))).toBe(false);
  });

  it("explains a Google sign-in that's awaiting approval", async () => {
    stubApi({
      "/api/auth/me": SIGNED_OUT,
      "/api/auth/config": CONFIG,
      "/api/auth/google": { status: 403, body: { detail: "pending_approval" } },
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      messages.Login.errorPendingApproval,
    );
  });

  it("redirects straight away when already signed in", async () => {
    stubApi({ "/api/auth/me": { body: ONE_ORG_SESSION }, "/api/auth/config": CONFIG });
    renderPage();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/ventures"));
  });
});
