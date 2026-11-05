import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { vi } from "vitest";

import en from "../../messages/en.json";
import ko from "../../messages/ko.json";

// Use in a test file with:
//   vi.mock("@/i18n/navigation", async () => (await import("@/test/auth-helpers")).navigationMock);
export const replaceMock = vi.fn();
export const pushMock = vi.fn();

type Href = string | { pathname: string; query?: Record<string, string> };

export const navigationMock = {
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
  usePathname: () => "/settings",
  Link: ({ href, children, ...props }: { href: Href; children: React.ReactNode }) => (
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
};

type Reply = { status?: number; body?: unknown };
export type Routes = Record<string, Reply | ((init: RequestInit) => Reply)>;

/** Fakes the backend: each route is matched by the end of the request URL. */
export function stubApi(routes: Routes) {
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

export function requestBody(fetchMock: ReturnType<typeof stubApi>, path: string): unknown {
  const call = fetchMock.mock.calls.find(([url]) => url.endsWith(path));
  if (!call) throw new Error(`No request to ${path}`);
  return JSON.parse(call[1]!.body as string);
}

export function renderWithProviders(ui: React.ReactElement, locale: "en" | "ko" = "en") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale={locale} messages={locale === "ko" ? ko : en}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
