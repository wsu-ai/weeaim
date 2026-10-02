import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../messages/en.json";
import { renderWithProviders, requestBody, stubApi } from "@/test/auth-helpers";
import ForgotPasswordPage from "./page";

vi.mock("@/i18n/navigation", async () => (await import("@/test/auth-helpers")).navigationMock);

const F = messages.ForgotPassword;

afterEach(() => {
  vi.unstubAllGlobals();
});

async function requestCode(email: string) {
  fireEvent.change(screen.getByLabelText(F.emailLabel), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: F.sendCode }));
  await screen.findByText(F.resetTitle);
}

function enterNewPassword(code: string, password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText(F.codeLabel), { target: { value: code } });
  fireEvent.change(screen.getByLabelText(F.newPassword), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(F.confirmPassword), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: F.submit }));
}

describe("ForgotPasswordPage", () => {
  it("requests a code, then sets a new password", async () => {
    const fetchMock = stubApi({
      "/api/auth/forgot-password": { status: 202, body: { status: "accepted" } },
      "/api/auth/reset-password": { body: { status: "password_reset" } },
    });
    renderWithProviders(<ForgotPasswordPage />);

    await requestCode("minji@example.com");
    expect(requestBody(fetchMock, "/api/auth/forgot-password")).toEqual({
      email: "minji@example.com",
    });

    enterNewPassword("123456", "a brand new passphrase");

    expect(await screen.findByText(F.doneTitle)).toBeInTheDocument();
    expect(requestBody(fetchMock, "/api/auth/reset-password")).toEqual({
      email: "minji@example.com",
      code: "123456",
      new_password: "a brand new passphrase",
    });
    expect(screen.getByRole("link", { name: F.backToSignIn })).toHaveAttribute("href", "/");
  });

  it("checks the new password before calling the API", async () => {
    const fetchMock = stubApi({
      "/api/auth/forgot-password": { status: 202, body: { status: "accepted" } },
    });
    renderWithProviders(<ForgotPasswordPage />);
    await requestCode("minji@example.com");

    enterNewPassword("123456", "short", "different");

    const text = (await screen.findAllByRole("alert")).map((a) => a.textContent).join(" | ");
    expect(text).toContain(messages.Signup.errorPasswordTooShort);
    expect(text).toContain(messages.Signup.errorPasswordMismatch);
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/reset-password"))).toBe(false);
  });

  it("explains a wrong or expired code", async () => {
    stubApi({
      "/api/auth/forgot-password": { status: 202, body: { status: "accepted" } },
      "/api/auth/reset-password": { status: 400, body: { detail: "invalid_code" } },
    });
    renderWithProviders(<ForgotPasswordPage />);
    await requestCode("minji@example.com");

    enterNewPassword("000000", "a brand new passphrase");

    expect(await screen.findByRole("alert")).toHaveTextContent(F.errorInvalidCode);
  });
});
