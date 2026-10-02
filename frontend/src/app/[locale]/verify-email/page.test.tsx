import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../messages/en.json";
import { renderWithProviders, requestBody, stubApi } from "@/test/auth-helpers";
import VerifyEmailPage from "./page";

vi.mock("@/i18n/navigation", async () => (await import("@/test/auth-helpers")).navigationMock);
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("email=minji@example.com"),
}));

const V = messages.VerifyEmail;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VerifyEmailPage", () => {
  it("prefills the email and asks for the password with the code", async () => {
    const fetchMock = stubApi({ "/api/auth/verify-email": { body: { status: "pending_approval" } } });
    renderWithProviders(<VerifyEmailPage />);

    expect(await screen.findByLabelText(V.emailLabel)).toHaveValue("minji@example.com");
    fireEvent.change(screen.getByLabelText(V.passwordLabel), {
      target: { value: "correct horse battery" },
    });
    fireEvent.change(screen.getByLabelText(V.codeLabel), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: V.submit }));

    expect(await screen.findByText(V.awaitingTitle)).toBeInTheDocument();
    expect(requestBody(fetchMock, "/api/auth/verify-email")).toEqual({
      email: "minji@example.com",
      code: "654321",
      password: "correct horse battery",
    });
  });

  it("rejects a code that isn't six digits", async () => {
    const fetchMock = stubApi({});
    renderWithProviders(<VerifyEmailPage />);

    fireEvent.change(await screen.findByLabelText(V.passwordLabel), { target: { value: "pw" } });
    fireEvent.change(screen.getByLabelText(V.codeLabel), { target: { value: "12ab" } });
    fireEvent.click(screen.getByRole("button", { name: V.submit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(V.errorCodeFormat);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resends a code and then waits before allowing another", async () => {
    const fetchMock = stubApi({
      "/api/auth/resend-verification": { status: 202, body: { status: "accepted" } },
    });
    renderWithProviders(<VerifyEmailPage />);

    fireEvent.click(await screen.findByRole("button", { name: V.resend }));

    expect(await screen.findByText(V.resent)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send a new code in \d+s/ })).toBeDisabled();
    expect(requestBody(fetchMock, "/api/auth/resend-verification")).toEqual({
      email: "minji@example.com",
    });
  });
});
