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

  it("shows the confirmation after a successful submission", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "venture-1" }),
      }),
    );
    renderPage();

    fireEvent.change(screen.getByLabelText(messages.IdeaIntake.label), {
      target: { value: VALID_IDEA },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.IdeaIntake.submit }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        messages.IdeaIntake.confirmationTitle,
      ),
    );
  });

  it("shows an error message when the API call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    renderPage();

    fireEvent.change(screen.getByLabelText(messages.IdeaIntake.label), {
      target: { value: VALID_IDEA },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.IdeaIntake.submit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      messages.IdeaIntake.errorSubmitFailed,
    );
  });
});
