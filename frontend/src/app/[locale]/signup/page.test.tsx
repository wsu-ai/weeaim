import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../messages/en.json";
import ko from "../../../../messages/ko.json";
import { renderWithProviders, requestBody, stubApi } from "@/test/auth-helpers";
import SignupPage from "./page";

vi.mock("@/i18n/navigation", async () => (await import("@/test/auth-helpers")).navigationMock);

const S = messages.Signup;
const PASSWORD = "correct horse battery";

afterEach(() => {
  vi.unstubAllGlobals();
});

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillValidForm({ affiliation = "woosong_student" } = {}) {
  type(S.fullName, "Kim Minji");
  type(S.email, "minji@example.com");
  type(S.password, PASSWORD);
  type(S.confirmPassword, PASSWORD);
  fireEvent.change(screen.getByLabelText(S.affiliation), { target: { value: affiliation } });
  type(`${S.department} ${S.optional}`, "Technology Management");
  type(S.accessReason, "Validate my startup idea for the entrepreneurship course.");
  for (const consent of Object.values(S.consents)) {
    fireEvent.click(screen.getByLabelText(consent));
  }
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: S.submit }));
}

describe("SignupPage", () => {
  it("shows every registration field and a link back to sign in", () => {
    renderWithProviders(<SignupPage />);

    for (const label of [S.fullName, S.email, S.password, S.confirmPassword, S.affiliation]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText(S.preferredLanguage)).toHaveValue("en");
    expect(screen.getByLabelText(S.accessReason)).toBeInTheDocument();
    for (const consent of Object.values(S.consents)) {
      expect(screen.getByLabelText(consent)).not.toBeChecked();
    }
    expect(screen.getByRole("link", { name: S.signInLink })).toHaveAttribute("href", "/");
  });

  it("only asks for an organization name for external affiliations", () => {
    renderWithProviders(<SignupPage />);

    fireEvent.change(screen.getByLabelText(S.affiliation), { target: { value: "woosong_student" } });
    expect(screen.queryByLabelText(S.affiliationName)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(S.affiliation), { target: { value: "external_founder" } });
    expect(screen.getByLabelText(S.affiliationName)).toBeInTheDocument();
  });

  it("validates the form before calling the API", async () => {
    const fetchMock = stubApi({});
    renderWithProviders(<SignupPage />);

    type(S.email, "minji@example.com");
    type(S.password, "short");
    type(S.confirmPassword, "different");
    fireEvent.change(screen.getByLabelText(S.affiliation), { target: { value: "other" } });
    submit();

    const alerts = await screen.findAllByRole("alert");
    const text = alerts.map((a) => a.textContent).join(" | ");
    expect(text).toContain(S.errorFullName);
    expect(text).toContain(S.errorPasswordTooShort);
    expect(text).toContain(S.errorPasswordMismatch);
    expect(text).toContain(S.errorAffiliationName);
    expect(text).toContain(S.errorAccessReason);
    expect(text).toContain(S.errorConsentRequired);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a password that contains the email address", async () => {
    stubApi({});
    renderWithProviders(<SignupPage />);

    fillValidForm();
    type(S.password, "minji-loves-startups");
    type(S.confirmPassword, "minji-loves-startups");
    submit();

    expect(await screen.findByText(S.errorPasswordContainsEmail)).toBeInTheDocument();
  });

  it("registers, verifies the email and shows the approval notice", async () => {
    const fetchMock = stubApi({
      "/api/auth/signup": { status: 202, body: { status: "accepted" } },
      "/api/auth/verify-email": { body: { status: "pending_approval" } },
    });
    renderWithProviders(<SignupPage />);

    fillValidForm();
    submit();

    expect(
      await screen.findByText(S.verifyDescription.replace("{email}", "minji@example.com")),
    ).toBeInTheDocument();
    expect(requestBody(fetchMock, "/api/auth/signup")).toEqual({
      full_name: "Kim Minji",
      email: "minji@example.com",
      password: PASSWORD,
      affiliation: "woosong_student",
      affiliation_name: null,
      department: "Technology Management",
      preferred_language: "en",
      access_reason: "Validate my startup idea for the entrepreneurship course.",
      accept_terms: true,
      accept_privacy: true,
      accept_ai_processing: true,
    });

    // The password was just typed, so it isn't asked for again.
    expect(screen.queryByLabelText(messages.VerifyEmail.passwordLabel)).not.toBeInTheDocument();
    type(messages.VerifyEmail.codeLabel, "123456");
    fireEvent.click(screen.getByRole("button", { name: messages.VerifyEmail.submit }));

    expect(await screen.findByText(messages.VerifyEmail.awaitingTitle)).toBeInTheDocument();
    expect(requestBody(fetchMock, "/api/auth/verify-email")).toEqual({
      email: "minji@example.com",
      code: "123456",
      password: PASSWORD,
    });
  });

  it("sends the organization name for external founders", async () => {
    const fetchMock = stubApi({ "/api/auth/signup": { status: 202, body: { status: "accepted" } } });
    renderWithProviders(<SignupPage />);

    fillValidForm({ affiliation: "external_founder" });
    type(S.affiliationName, "Acme Labs");
    submit();

    await waitFor(() =>
      expect(requestBody(fetchMock, "/api/auth/signup")).toMatchObject({
        affiliation: "external_founder",
        affiliation_name: "Acme Labs",
      }),
    );
  });

  it("starts the resend button on a cooldown after sign-up", async () => {
    stubApi({ "/api/auth/signup": { status: 202, body: { status: "accepted" } } });
    renderWithProviders(<SignupPage />);

    fillValidForm();
    submit();

    const resend = await screen.findByRole("button", { name: /Send a new code in \d+s/ });
    expect(resend).toBeDisabled();
  });

  it("explains a wrong verification code", async () => {
    stubApi({
      "/api/auth/signup": { status: 202, body: { status: "accepted" } },
      "/api/auth/verify-email": { status: 400, body: { detail: "invalid_code" } },
    });
    renderWithProviders(<SignupPage />);

    fillValidForm();
    submit();
    await screen.findByLabelText(messages.VerifyEmail.codeLabel);
    type(messages.VerifyEmail.codeLabel, "000000");
    fireEvent.click(screen.getByRole("button", { name: messages.VerifyEmail.submit }));

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.VerifyEmail.errorInvalidCode);
  });

  it("says the service is unavailable when sign-up can't reach the backend", async () => {
    stubApi({
      "/api/auth/signup": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    renderWithProviders(<SignupPage />);

    fillValidForm();
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(messages.Login.errorUnavailable);
  });

  it("renders in Korean", () => {
    renderWithProviders(<SignupPage />, "ko");

    expect(screen.getByRole("button", { name: ko.Signup.submit })).toBeInTheDocument();
    expect(screen.getByLabelText(ko.Signup.fullName)).toBeInTheDocument();
    expect(screen.getByLabelText(ko.Signup.preferredLanguage)).toHaveValue("ko");
  });
});
