import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";
import IdeaIntakePage from "./page";

const pushMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <IdeaIntakePage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const VALID_IDEA =
  "An AI-powered cooking assistant for Korean recipes targeting U.S. households.";

const FAKE_INTERPRETATION = {
  title: "Korean Recipe Cooking Assistant",
  summary: VALID_IDEA,
  industry: "Food tech",
  geography: "United States",
  target_customer: "U.S. households",
  problem_hypothesis: "Hard to find authentic Korean recipes",
  confidence: 0.7,
};

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
  pushMock.mockClear();
});

describe("IdeaIntakePage", () => {
  it("shows a validation error when the idea is too short", async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText(messages.IdeaIntake.label), {
      target: { value: "too short" },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.IdeaIntake.submit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      messages.IdeaIntake.errorTooShort,
    );
  });

  it("shows an error message when creating the venture fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(null, false)));
    renderPage();

    fireEvent.change(screen.getByLabelText(messages.IdeaIntake.label), {
      target: { value: VALID_IDEA },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.IdeaIntake.submit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      messages.IdeaIntake.errorSubmitFailed,
    );
  });

  it("says the AI account is out of credits instead of the generic error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/interpret")) {
          return { ok: false, status: 503, json: async () => ({ detail: "ai_quota_exhausted" }) };
        }
        return jsonResponse({ id: "v-1", original_idea: VALID_IDEA });
      }),
    );
    renderPage();

    fireEvent.change(screen.getByLabelText(messages.IdeaIntake.label), {
      target: { value: VALID_IDEA },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.IdeaIntake.submit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.TokenLimit.ai_quota_exhausted);
  });

  it("shows the server's reason when the AI service is unavailable", async () => {
    const reason = "The AI service is temporarily unavailable. Please try again shortly.";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/interpret")) {
          return { ok: false, status: 503, json: async () => ({ detail: reason }) };
        }
        return jsonResponse({ id: "v-1", original_idea: VALID_IDEA });
      }),
    );
    renderPage();

    fireEvent.change(screen.getByLabelText(messages.IdeaIntake.label), {
      target: { value: VALID_IDEA },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.IdeaIntake.submit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(reason);
  });

  it("reuses the saved venture when trying again after the AI step failed", async () => {
    let interpretCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/interpret")) {
        interpretCalls += 1;
        return interpretCalls === 1 ? jsonResponse(null, false) : jsonResponse(FAKE_INTERPRETATION);
      }
      return jsonResponse({ id: "v-1", original_idea: VALID_IDEA });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    fireEvent.change(screen.getByLabelText(messages.IdeaIntake.label), {
      target: { value: VALID_IDEA },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.IdeaIntake.submit }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: messages.IdeaIntake.submit }));

    await waitFor(() => expect(interpretCalls).toBe(2));
    const creates = fetchMock.mock.calls.filter(([url]) => !String(url).endsWith("/interpret"));
    expect(creates).toHaveLength(1);
  });

  it("walks through create -> interpret -> review -> confirm", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/interpret")) return jsonResponse(FAKE_INTERPRETATION);
        if (url.endsWith("/confirm-idea")) {
          return jsonResponse({ id: "venture-1", title: FAKE_INTERPRETATION.title });
        }
        return jsonResponse({ id: "venture-1" });
      }),
    );
    renderPage();

    fireEvent.change(screen.getByLabelText(messages.IdeaIntake.label), {
      target: { value: VALID_IDEA },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.IdeaIntake.submit }));

    const titleField = await screen.findByLabelText(messages.IdeaConfirmation.fieldTitle);
    expect(titleField).toHaveValue(FAKE_INTERPRETATION.title);

    fireEvent.click(
      screen.getByRole("button", { name: messages.IdeaConfirmation.confirm }),
    );

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/ventures/venture-1"));
  });

  it("sends the session cookie and no identity headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null, false));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    fireEvent.change(screen.getByLabelText(messages.IdeaIntake.label), {
      target: { value: VALID_IDEA },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.IdeaIntake.submit }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const init = fetchMock.mock.calls[0][1];
    expect(init.credentials).toBe("include");
    expect(init.headers).not.toHaveProperty("X-Dev-User-Email");
    expect(init.headers).not.toHaveProperty("X-Dev-Organization-Slug");
  });
});
