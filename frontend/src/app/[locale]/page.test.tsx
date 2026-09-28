import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import messages from "../../../messages/en.json";
import IdeaIntakePage from "./page";

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <IdeaIntakePage />
    </NextIntlClientProvider>,
  );
}

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

  it("shows the mocked confirmation after a valid submission", async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText(messages.IdeaIntake.label), {
      target: {
        value:
          "An AI-powered cooking assistant for Korean recipes targeting U.S. households.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.IdeaIntake.submit }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        messages.IdeaIntake.confirmationTitle,
      ),
    );
  });
});
