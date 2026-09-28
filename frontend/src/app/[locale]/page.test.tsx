import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../../messages/en.json";
import IdeaIntakePage from "./page";

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

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        messages.IdeaIntake.confirmationTitle,
      ),
    );
  });
});
