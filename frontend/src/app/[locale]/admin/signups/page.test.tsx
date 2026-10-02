import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";
import ko from "../../../../../messages/ko.json";
import { renderWithProviders, requestBody, stubApi, type Routes } from "@/test/auth-helpers";
import AdminSignupsPage from "./page";

vi.mock("@/i18n/navigation", async () => (await import("@/test/auth-helpers")).navigationMock);

const A = messages.Admin;

const OWNER_SESSION = {
  email: "owner@woosong.ac.kr",
  display_name: "Owner",
  organizations: [{ slug: "woosong", name: "Woosong University", role: "owner" }],
  active_organization: "woosong",
};

const PENDING = {
  id: "11111111-1111-1111-1111-111111111111",
  full_name: "John H. Yun",
  email: "john.yun@wsu.ac.kr",
  affiliation: "external_founder",
  affiliation_name: "Endicott College",
  department: "Business",
  preferred_language: "en",
  access_reason: "Validate my new venture idea.",
  registered_at: "2026-10-02T05:30:00Z",
  verified_at: "2026-10-02T05:35:00Z",
  status: "pending",
  reviewed_at: null,
  reviewed_by: null,
  review_note: null,
  organizations: [],
};

const ORGS = [
  { slug: "woosong", name: "Woosong University", grantable_roles: ["member", "admin", "owner"] },
  { slug: "lab", name: "Startup Lab", grantable_roles: ["member", "admin"] },
];

function adminRoutes(extra: Routes = {}): Routes {
  return {
    "/api/auth/me": { body: OWNER_SESSION },
    "/api/admin/signups?status=pending": { body: [PENDING] },
    "/api/admin/organizations": { body: ORGS },
    ...extra,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminSignupsPage", () => {
  it("lists pending sign-ups with their details", async () => {
    stubApi(adminRoutes());
    renderWithProviders(<AdminSignupsPage />);

    expect(await screen.findByText("John H. Yun")).toBeInTheDocument();
    expect(screen.getByText("john.yun@wsu.ac.kr")).toBeInTheDocument();
    expect(
      screen.getByText(`${messages.Signup.affiliationOptions.external_founder} · Endicott College`),
    ).toBeInTheDocument();
    expect(screen.getByText("Validate my new venture idea.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: `${A.tabs.pending} (1)` })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("approves into the chosen organization and role", async () => {
    const fetchMock = stubApi(
      adminRoutes({
        [`/api/admin/signups/${PENDING.id}/approve`]: { body: { status: "approved", email_sent: true } },
      }),
    );
    renderWithProviders(<AdminSignupsPage />);
    await screen.findByText("John H. Yun");
    await waitFor(() => expect(screen.getByLabelText(A.organization)).toHaveValue("woosong"));

    fireEvent.change(screen.getByLabelText(A.organization), { target: { value: "lab" } });
    // Admins of "lab" can't grant owner, so it isn't offered.
    expect(
      within(screen.getByLabelText(A.role)).queryByRole("option", { name: A.roles.owner }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(A.role), { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: A.approve }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Approved John H. Yun into Startup Lab.",
    );
    expect(requestBody(fetchMock, "/approve")).toEqual({ organization_slug: "lab", role: "admin" });
  });

  it("rejects with a note", async () => {
    const fetchMock = stubApi(
      adminRoutes({
        [`/api/admin/signups/${PENDING.id}/reject`]: { body: { status: "rejected", email_sent: true } },
      }),
    );
    renderWithProviders(<AdminSignupsPage />);

    fireEvent.click(await screen.findByRole("button", { name: A.reject }));
    fireEvent.change(screen.getByLabelText(A.rejectNoteLabel), {
      target: { value: "Pilot is limited to Woosong students." },
    });
    fireEvent.click(screen.getByRole("button", { name: A.confirmReject }));

    expect(await screen.findByRole("status")).toHaveTextContent("Rejected John H. Yun.");
    expect(requestBody(fetchMock, "/reject")).toEqual({
      note: "Pilot is limited to Woosong students.",
    });
  });

  it("warns when the notification email couldn't be sent", async () => {
    stubApi(
      adminRoutes({
        [`/api/admin/signups/${PENDING.id}/approve`]: { body: { status: "approved", email_sent: false } },
      }),
    );
    renderWithProviders(<AdminSignupsPage />);
    await screen.findByText("John H. Yun");
    await waitFor(() => expect(screen.getByLabelText(A.organization)).toHaveValue("woosong"));

    fireEvent.click(screen.getByRole("button", { name: A.approve }));

    expect(await screen.findByRole("status")).toHaveTextContent(A.emailNotSent);
  });

  it("explains when another administrator already reviewed it", async () => {
    stubApi(
      adminRoutes({
        [`/api/admin/signups/${PENDING.id}/approve`]: {
          status: 409,
          body: { detail: "already_reviewed" },
        },
      }),
    );
    renderWithProviders(<AdminSignupsPage />);
    await screen.findByText("John H. Yun");
    await waitFor(() => expect(screen.getByLabelText(A.organization)).toHaveValue("woosong"));

    fireEvent.click(screen.getByRole("button", { name: A.approve }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "John H. Yun was already reviewed by another administrator.",
    );
  });

  it("shows review history on the Approved tab", async () => {
    stubApi(
      adminRoutes({
        "/api/admin/signups?status=approved": {
          body: [
            {
              ...PENDING,
              status: "approved",
              reviewed_at: "2026-10-02T07:00:00Z",
              reviewed_by: "owner@woosong.ac.kr",
              organizations: ["Woosong University"],
            },
          ],
        },
      }),
    );
    renderWithProviders(<AdminSignupsPage />);

    fireEvent.click(await screen.findByRole("tab", { name: A.tabs.approved }));

    expect(await screen.findByText(/by owner@woosong\.ac\.kr/)).toHaveTextContent(
      "Woosong University",
    );
  });

  it("shows an empty state when nothing is pending", async () => {
    stubApi(adminRoutes({ "/api/admin/signups?status=pending": { body: [] } }));
    renderWithProviders(<AdminSignupsPage />);

    expect(await screen.findByText(A.empty.pending)).toBeInTheDocument();
  });

  it("tells non-admins they don't have access", async () => {
    const fetchMock = stubApi({
      "/api/auth/me": {
        body: {
          ...OWNER_SESSION,
          organizations: [{ slug: "woosong", name: "Woosong University", role: "member" }],
        },
      },
    });
    renderWithProviders(<AdminSignupsPage />);

    expect(await screen.findByText(A.noAccessTitle)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url.includes("/api/admin/"))).toBe(false);
  });

  it("renders in Korean", async () => {
    stubApi(adminRoutes());
    renderWithProviders(<AdminSignupsPage />, "ko");

    expect(await screen.findByText(ko.Admin.title)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: ko.Admin.approve })).toBeInTheDocument();
  });
});
