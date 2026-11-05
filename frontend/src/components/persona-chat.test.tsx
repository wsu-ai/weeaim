import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../messages/en.json";
import type { PersonaMarketProfile, TargetPersona } from "@/lib/api";
import { renderWithProviders, stubApi } from "@/test/auth-helpers";
import { PersonaChat } from "./persona-chat";

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
const BASE = `/api/ventures/v1/personas/${LANDLORD.id}`;
const PROFILE: PersonaMarketProfile = {
  kind: "persona_market_profile",
  persona_id: LANDLORD.id,
  summary: "Older small landlords in Daejeon manage by phone and avoid new fees.",
  facts: [
    { fact: "Most own 2-5 units.", applies_to: "demographic", source_title: "Housing survey",
      source_url: "https://stats.example.kr/housing", source_verified: true },
    { fact: "Income is mostly rental.", applies_to: "income", source_title: "A blog", source_url: null, source_verified: false },
  ],
  daily_life_and_habits: ["Handles requests by phone."],
  current_alternatives: ["KakaoTalk group chats"],
  spending_and_price_sensitivity: ["Avoids new monthly fees."],
  adoption_signals: ["Uses banking apps."],
  likely_objections: ["Another app to learn."],
  data_gaps: ["No city-level software spending data."],
  confidence: 0.5,
  sources: [],
  researched_at: "2026-10-14T09:00:00Z",
  language: "en",
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderChat() {
  renderWithProviders(<PersonaChat ventureId="v1" persona={LANDLORD} language="en" />);
}

describe("PersonaChat", () => {
  it("researches the market first, then grounds the chat in it", async () => {
    let researched: unknown = null;
    stubApi({
      [`${BASE}/market-profile`]: (init) => {
        if (init.method === "POST") {
          researched = JSON.parse(init.body as string);
          return { body: PROFILE };
        }
        return { status: 404, body: { detail: "not_researched" } };
      },
      [`${BASE}/messages`]: { body: [] },
    });
    renderChat();

    expect(await screen.findByText(PROFILE.summary)).toBeInTheDocument();
    expect(researched).toEqual({ language: "en", refresh: false });
    const facts = screen.getByTestId("market-facts");
    expect(within(facts).getByRole("link", { name: "(Housing survey)" })).toHaveAttribute("href", "https://stats.example.kr/housing");
    expect(facts).toHaveTextContent(`(A blog — ${P.sourceUnverified})`);
    expect(screen.getByTestId("market-profile")).toHaveTextContent("Another app to learn.");
    expect(screen.getByText(P.marketGrounded)).toBeInTheDocument();
    expect(screen.getByLabelText("Message to Small landlord")).toBeEnabled();
  });

  it("can't chat until the market research is done", async () => {
    stubApi({
      [`${BASE}/market-profile`]: (init) =>
        init.method === "POST" ? { body: PROFILE } : { status: 404, body: { detail: "not_researched" } },
      [`${BASE}/messages`]: { body: [] },
    });
    renderChat();

    expect(screen.getByLabelText("Message to Small landlord")).toBeDisabled();
    expect(await screen.findByText(PROFILE.summary)).toBeInTheDocument();
  });

  it("uses cached market research, and refreshes it on request", async () => {
    let posts = 0;
    stubApi({
      [`${BASE}/market-profile`]: (init) => {
        if (init.method === "POST") {
          posts += 1;
          return { body: { ...PROFILE, summary: "Refreshed profile." } };
        }
        return { body: PROFILE };
      },
      [`${BASE}/messages`]: { body: [] },
    });
    renderChat();

    expect(await screen.findByText(PROFILE.summary)).toBeInTheDocument();
    expect(posts).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: P.refreshMarket }));
    expect(await screen.findByText("Refreshed profile.")).toBeInTheDocument();
    expect(posts).toBe(1);
  });

  it("still allows a chat when market research fails, and says replies aren't grounded", async () => {
    stubApi({
      [`${BASE}/market-profile`]: (init) =>
        init.method === "POST" ? { status: 503, body: null } : { status: 404, body: { detail: "not_researched" } },
      [`${BASE}/messages`]: { body: [] },
    });
    renderChat();

    expect(await screen.findByText(P.marketFailed)).toBeInTheDocument();
    expect(screen.getByLabelText("Message to Small landlord")).toBeEnabled();
  });

  it("chats with the persona and shows both sides", async () => {
    let sent: unknown = null;
    stubApi({
      [`${BASE}/market-profile`]: { body: PROFILE },
      [`${BASE}/messages`]: (init) => {
        if (init.method === "POST") {
          sent = JSON.parse(init.body as string);
          return {
            body: {
              founder: { id: "m2", role: "founder", content: "Would you pay?", created_at: "2026-10-14T09:01:00Z" },
              persona: { id: "m3", role: "persona", content: "Not for another app.", created_at: "2026-10-14T09:01:01Z" },
            },
          };
        }
        return { body: [{ id: "m1", role: "persona", content: "Hello, I'm busy.", created_at: "2026-10-14T09:00:00Z" }] };
      },
    });
    renderChat();

    expect(await screen.findByText("Hello, I'm busy.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Message to Small landlord")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Message to Small landlord"), { target: { value: "Would you pay?" } });
    fireEvent.click(screen.getByRole("button", { name: P.send }));

    expect(await screen.findByText("Not for another app.")).toBeInTheDocument();
    expect(screen.getByText("Would you pay?")).toBeInTheDocument();
    expect(sent).toEqual({ content: "Would you pay?", language: "en" });
  });

  it("explains a failed reply and a full conversation, and starts over", async () => {
    let status = 503;
    let deleted = false;
    stubApi({
      [`${BASE}/market-profile`]: { body: PROFILE },
      [`${BASE}/messages`]: (init) => {
        if (init.method === "POST") return { status, body: { detail: "x" } };
        if (init.method === "DELETE") {
          deleted = true;
          return { status: 204, body: null };
        }
        return { body: deleted ? [] : [{ id: "m1", role: "persona", content: "Hello.", created_at: "2026-10-14T09:00:00Z" }] };
      },
    });
    renderChat();

    await screen.findByText("Hello.");
    await waitFor(() => expect(screen.getByLabelText("Message to Small landlord")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Message to Small landlord"), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: P.send }));
    expect(await screen.findByText("Small landlord couldn't reply. Your message is saved — send it again to retry.")).toBeInTheDocument();

    status = 409;
    fireEvent.change(screen.getByLabelText("Message to Small landlord"), { target: { value: "Again" } });
    fireEvent.click(screen.getByRole("button", { name: P.send }));
    expect(await screen.findByText(P.conversationFull)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: P.startOver }));
    await waitFor(() => expect(screen.queryByText("Hello.")).not.toBeInTheDocument());
    expect(deleted).toBe(true);
  });
});
