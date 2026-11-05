import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../../../../../messages/en.json";
import { renderWithProviders, stubApi } from "@/test/auth-helpers";
import PersonaChatPage from "./page";

const PERSONA_ID = "11111111-1111-1111-1111-111111111111";
vi.mock("next/navigation", () => ({
  useParams: () => ({ ventureId: "v1", personaId: PERSONA_ID }),
}));

const P = messages.PersonaValidation;
const persona = {
  id: PERSONA_ID,
  name: "Small landlord",
  age_min: 45,
  age_max: 60,
  demographic: "Owns rental units in Daejeon",
  income_level: "upper_middle",
  gender: "any",
  marital_status: "married",
  notes: "",
};

function stages(personas: unknown[]) {
  return [
    {
      slug: "persona_validation", number: 7, title_en: "Personas Validation", title_ko: "페르소나 검증",
      implemented: true, status: "in_progress", answers: { personas }, ai_analysis: null, question_schema: null,
      locked: false, locked_by: [],
    },
  ];
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PersonaChatPage", () => {
  it("opens the chat for the persona, with its criteria", async () => {
    stubApi({
      "/api/ventures/v1/stages": { body: stages([persona]) },
      [`/api/ventures/v1/personas/${PERSONA_ID}/market-profile`]: { status: 404, body: { detail: "not_researched" } },
      [`/api/ventures/v1/personas/${PERSONA_ID}/messages`]: { body: [] },
    });
    renderWithProviders(<PersonaChatPage />);

    expect(await screen.findByRole("heading", { name: "Chat with Small landlord" })).toBeInTheDocument();
    expect(screen.getByTestId("persona-criteria")).toHaveTextContent(
      "45–60 · Upper-middle · Any · Married · Owns rental units in Daejeon",
    );
    expect(screen.getByTestId("simulated-label")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: P.closeWindow })).toBeInTheDocument();
  });

  it("explains when the persona no longer exists", async () => {
    stubApi({ "/api/ventures/v1/stages": { body: stages([]) } });
    renderWithProviders(<PersonaChatPage />);
    expect(await screen.findByText(P.personaMissing)).toBeInTheDocument();
  });
});
