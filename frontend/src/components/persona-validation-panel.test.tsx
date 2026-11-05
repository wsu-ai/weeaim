import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../messages/en.json";
import ko from "../../messages/ko.json";
import type { PersonaInsightsAnalysis, TargetPersona } from "@/lib/api";
import { renderWithProviders, stubApi } from "@/test/auth-helpers";
import { PersonaValidationPanel, personaProblems } from "./persona-validation-panel";

const P = messages.PersonaValidation;
const LANDLORD: TargetPersona = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Small landlord",
  age_min: 45,
  age_max: 60,
  demographic: "Owns 3-8 rental units in Daejeon",
  income_level: "upper_middle",
  gender: "any",
  marital_status: "married",
  notes: "",
};
const TENANT: TargetPersona = { ...LANDLORD, id: "22222222-2222-2222-2222-222222222222", name: "Young tenant" };

const INSIGHTS: PersonaInsightsAnalysis = {
  kind: "persona_insights",
  summary: "Landlords like the idea but resist a new monthly fee.",
  per_persona: [
    {
      persona_id: LANDLORD.id,
      name: "Small landlord",
      reactions: ["Curious."],
      objections: ["Another subscription."],
      willingness_to_pay: "some",
      feasibility_signals: ["Would try a free pilot."],
      viability_signals: ["Would pay if it saves an hour a week."],
      quotes: ["I already use KakaoTalk for everything."],
    },
  ],
  assumptions_to_test_with_real_customers: ["Landlords will pay for time saved."],
  confidence: 0.4,
  simulated: true,
  sources: [],
  researched_at: "2026-10-14T09:00:00Z",
  based_on: null,
  language: "en",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel(
  {
    analysis = null as PersonaInsightsAnalysis | null,
    personas = [LANDLORD, TENANT],
    locale = "en" as "en" | "ko",
    historical = false,
    onSavePersonas = vi.fn(async (list: TargetPersona[]) => {
      void list;
    }),
  } = {},
) {
  renderWithProviders(
    <PersonaValidationPanel
      ventureId="v1"
      analysis={analysis}
      language={locale}
      personas={personas}
      onSavePersonas={onSavePersonas}
      onResearched={vi.fn()}
      historical={historical}
    />,
    locale,
  );
  return onSavePersonas;
}

describe("PersonaValidationPanel", () => {
  it("always says the personas are simulated", () => {
    stubApi({});
    renderPanel();
    expect(screen.getByTestId("simulated-label")).toHaveTextContent(P.simulatedLabel);
  });

  it("captures age, demographic, income, gender and marital status, and saves them", async () => {
    stubApi({});
    const onSavePersonas = renderPanel({ personas: [] });

    const card = screen.getByTestId("persona-card-0");
    fireEvent.change(within(card).getByLabelText(P.fields.name), { target: { value: " Busy parent " } });
    fireEvent.change(within(card).getByLabelText(P.fields.ageMin), { target: { value: "30" } });
    fireEvent.change(within(card).getByLabelText(P.fields.ageMax), { target: { value: "44" } });
    fireEvent.change(within(card).getByLabelText(P.fields.demographic), { target: { value: "Dual-income family in Seoul" } });
    fireEvent.change(within(card).getByLabelText(P.fields.income), { target: { value: "upper_middle" } });
    fireEvent.change(within(card).getByLabelText(P.fields.gender), { target: { value: "female" } });
    fireEvent.change(within(card).getByLabelText(P.fields.marital), { target: { value: "married" } });
    fireEvent.click(screen.getByRole("button", { name: P.savePersonas }));

    await waitFor(() => expect(onSavePersonas).toHaveBeenCalledTimes(1));
    expect(onSavePersonas.mock.calls[0][0]).toEqual([
      {
        id: "", name: "Busy parent", age_min: 30, age_max: 44, demographic: "Dual-income family in Seoul",
        income_level: "upper_middle", gender: "female", marital_status: "married", notes: "",
      },
    ]);
    expect(screen.getByText(P.chatNeedsSave)).toBeInTheDocument();
  });

  it("can update or remove saved personas at any time, up to five", async () => {
    stubApi({});
    const onSavePersonas = renderPanel();

    // Each profile opens from its head.
    fireEvent.click(screen.getByTestId("persona-avatar-1"));
    fireEvent.click(screen.getByRole("button", { name: "Remove Young tenant" }));
    fireEvent.click(screen.getByTestId("persona-avatar-0"));
    fireEvent.change(within(screen.getByTestId("persona-card-0")).getByLabelText(P.fields.ageMax), { target: { value: "65" } });
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: P.addPersona }));
    expect(screen.getAllByTestId(/^persona-avatar-/)).toHaveLength(5);
    expect(screen.getByRole("button", { name: P.addPersona })).toBeDisabled();
    // New personas still need names, so saving is blocked until they have them.
    expect(screen.getByText(P.invalid)).toBeInTheDocument();
    for (let i = 4; i >= 1; i--) {
      const head = screen.getByTestId(`persona-avatar-${i}`);
      if (head.getAttribute("aria-expanded") !== "true") fireEvent.click(head); // the newest is already open
      fireEvent.click(screen.getByRole("button", { name: `Remove Persona ${i + 1}` }));
    }
    fireEvent.click(screen.getByRole("button", { name: P.savePersonas }));

    await waitFor(() => expect(onSavePersonas).toHaveBeenCalled());
    expect(onSavePersonas.mock.calls[0][0]).toEqual([{ ...LANDLORD, age_max: 65 }]);
  });

  it("shows each saved persona as a head drawn from its age and gender, profile hidden until clicked", () => {
    stubApi({});
    renderPanel();

    const heading = screen.getByRole("heading", { name: "Target Personas (Click the persona image to view profile details.)" });
    expect(within(heading).getByText(P.personasHint)).toHaveClass("font-normal"); // the hint isn't bold
    const gallery = screen.getByTestId("persona-gallery");
    const landlord = screen.getByTestId("persona-avatar-0");
    expect(within(gallery).getAllByRole("img").length).toBe(2);
    const head = within(landlord).getByRole("img", { name: /Small landlord: age 45–60/ });
    expect(head).toHaveAttribute("data-age-band", "adult"); // 45-60 -> middle 52.5
    expect(head).toHaveAttribute("data-gender", LANDLORD.gender);
    expect(landlord).toHaveTextContent("45–60");

    // No profile is shown until a head is clicked.
    expect(screen.queryByTestId(/^persona-card-/)).not.toBeInTheDocument();
    fireEvent.click(landlord);
    expect(landlord).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByTestId("persona-card-0")).getByLabelText(P.fields.name)).toHaveValue(LANDLORD.name);
    // Another head switches the profile; clicking the open one closes it.
    fireEvent.click(screen.getByTestId("persona-avatar-1"));
    expect(screen.queryByTestId("persona-card-0")).not.toBeInTheDocument();
    expect(screen.getByTestId("persona-card-1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("persona-avatar-1"));
    expect(screen.queryByTestId(/^persona-card-/)).not.toBeInTheDocument();
  });

  it("opens a new persona's profile straight away, and redraws the head as age and gender change", () => {
    stubApi({});
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: P.addPersona }));
    const card = screen.getByTestId("persona-card-2");
    fireEvent.change(within(card).getByLabelText(P.fields.ageMin), { target: { value: "70" } });
    fireEvent.change(within(card).getByLabelText(P.fields.ageMax), { target: { value: "80" } });
    fireEvent.change(within(card).getByLabelText(P.fields.gender), { target: { value: "female" } });

    const head = within(screen.getByTestId("persona-avatar-2")).getByRole("img");
    expect(head).toHaveAttribute("data-age-band", "senior");
    expect(head).toHaveAttribute("data-gender", "female");
    // Not named yet: flagged on the head.
    expect(screen.getByTestId("persona-avatar-2")).toHaveTextContent(P.needsDetails);
  });

  it("validates ages", () => {
    expect(personaProblems([LANDLORD])).toBe(false);
    expect(personaProblems([{ ...LANDLORD, age_min: 70, age_max: 30 }])).toBe(true);
    expect(personaProblems([{ ...LANDLORD, age_max: 130 }])).toBe(true);
    expect(personaProblems([{ ...LANDLORD, name: " " }])).toBe(true);
  });

  it("launches each persona's chat in its own window", () => {
    stubApi({});
    const open = vi.fn(() => ({ focus: vi.fn() }) as unknown as Window);
    vi.stubGlobal("open", open);
    renderPanel();

    expect(screen.queryByTestId("conversation")).not.toBeInTheDocument(); // no inline chat any more
    const launchers = screen.getByTestId("chat-launchers");
    fireEvent.click(within(launchers).getByRole("button", { name: `${P.launchChat}: Young tenant` }));
    expect(open).toHaveBeenCalledWith(
      `/en/ventures/v1/personas/${TENANT.id}/chat`,
      `weeaim-persona-${TENANT.id}`,
      "popup,width=560,height=820",
    );
  });

  it("falls back to a new tab when pop-ups are blocked", () => {
    stubApi({});
    const open = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce({} as Window);
    vi.stubGlobal("open", open);
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: `${P.launchChat}: Small landlord` }));
    expect(open).toHaveBeenLastCalledWith(`/en/ventures/v1/personas/${LANDLORD.id}/chat`, "_blank");
    expect(screen.getByText(P.popupBlocked)).toBeInTheDocument();
  });

  it("asks to save personas before chatting", () => {
    stubApi({});
    renderPanel({ personas: [] });
    expect(screen.getByText(P.chatNeedsSave)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: new RegExp(P.launchChat) })).not.toBeInTheDocument();
  });

  it("says what the summary was based on", () => {
    stubApi({});
    renderPanel({ analysis: { ...INSIGHTS, conversations_used: 1, market_profiles_used: 2 } });
    expect(screen.getByTestId("insights-basis")).toHaveTextContent(
      "Based on 1 conversation and the market research for 2 personas.",
    );
  });

  it("summarizes insights, keeping quotes and real-customer tests", async () => {
    stubApi({ "/api/ventures/v1/stages/persona_validation/research": { body: INSIGHTS } });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: P.summarize }));
    const card = await screen.findByTestId(`insight-${LANDLORD.id}`);
    expect(card).toHaveTextContent("Willingness to pay: some");
    expect(card).toHaveTextContent("Another subscription.");
    expect(card).toHaveTextContent("“I already use KakaoTalk for everything.”");
    expect(screen.getByTestId("persona-insights")).toHaveTextContent("Landlords will pay for time saved.");
  });

  it("asks for a conversation before summarizing", async () => {
    stubApi({ "/api/ventures/v1/stages/persona_validation/research": { status: 422, body: { detail: "no_conversations" } } });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: P.summarize }));
    expect(await screen.findByText(P.noConversations)).toBeInTheDocument();
  });

  it("says when the AI account has run out of credits, instead of 'try again'", async () => {
    stubApi({
      "/api/ventures/v1/stages/persona_validation/research": { status: 503, body: { detail: "ai_quota_exhausted" } },
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: P.summarize }));
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.TokenLimit.ai_quota_exhausted);
    expect(screen.queryByText(P.summaryFailed)).not.toBeInTheDocument();
  });

  it("shows an earlier summary read-only", () => {
    stubApi({});
    renderPanel({ analysis: INSIGHTS, historical: true });
    expect(screen.queryByRole("button", { name: P.savePersonas })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: P.summarize })).not.toBeInTheDocument();
    expect(screen.getByText(INSIGHTS.summary)).toBeInTheDocument();
  });

  it("renders in Korean", async () => {
    stubApi({});
    renderPanel({ locale: "ko" });
    expect(screen.getByText(ko.PersonaValidation.title)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("persona-avatar-0"));
    expect(within(screen.getByTestId("persona-card-0")).getByLabelText(ko.PersonaValidation.fields.income)).toHaveDisplayValue(
      ko.PersonaValidation.income.upper_middle,
    );
  });
});
