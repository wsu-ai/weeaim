import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../messages/en.json";
import ko from "../../../../messages/ko.json";
import { renderWithProviders, replaceMock, requestBody, stubApi } from "@/test/auth-helpers";
import SettingsPage from "./page";

vi.mock("@/i18n/navigation", async () => (await import("@/test/auth-helpers")).navigationMock);
vi.mock("@/lib/location", () => ({
  browserLocation: () => ({ country: "South Korea", city: "Seoul", countrySource: "browserLanguage", citySource: "timeZone" }),
}));

const S = messages.Settings;
const SESSION = {
  email: "founder@test.dev",
  display_name: "Founder",
  organizations: [{ slug: "woosong", name: "Woosong University", role: "member" }],
  active_organization: "woosong",
  default_country: "Japan",
  default_metro_city: "Osaka",
};

const TOKENS = {
  ventures: [],
  organization_total: 1234,
  limits: { per_venture_limit: 5000, organization_limit: null },
  updated_at: null,
  can_edit: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  replaceMock.mockClear();
});

function browserLanguages(languages: string[]) {
  vi.stubGlobal("navigator", { ...navigator, languages, language: languages[0] });
}

describe("SettingsPage", () => {
  it("shows the saved country and city in dropdowns and saves changes", async () => {
    const fetchMock = stubApi({
      "/api/auth/me/preferences": (init) => ({ body: { ...SESSION, ...JSON.parse(init.body as string) } }),
      "/api/auth/me": { body: SESSION },
    });
    renderWithProviders(<SettingsPage />);

    await waitFor(() => expect(screen.getByLabelText(S.country)).toHaveValue("Japan"));
    expect(screen.getByLabelText(S.country).tagName).toBe("SELECT");
    // Every country of the globe is offered.
    expect(within(screen.getByLabelText(S.country)).getAllByRole("option").length).toBeGreaterThan(240);
    const city = screen.getByLabelText(S.city);
    expect(city).toHaveValue("Osaka");
    expect(within(city).getByRole("option", { name: "Tokyo" })).toBeInTheDocument();

    fireEvent.change(city, { target: { value: "Tokyo" } });
    fireEvent.click(screen.getByRole("button", { name: S.save }));

    expect(await screen.findByText(S.saved)).toBeInTheDocument();
    expect(requestBody(fetchMock, "/api/auth/me/preferences")).toEqual({
      default_country: "Japan",
      default_metro_city: "Tokyo",
    });
    expect(screen.queryByTestId("convert-language")).not.toBeInTheDocument();
  });

  it("suggests the browser's country the first time, without offering a language change", async () => {
    const fetchMock = stubApi({
      "/api/auth/me/preferences": (init) => ({ body: { ...SESSION, ...JSON.parse(init.body as string) } }),
      "/api/auth/me": { body: { ...SESSION, default_country: null, default_metro_city: null } },
    });
    renderWithProviders(<SettingsPage />);

    await waitFor(() => expect(screen.getByLabelText(S.country)).toHaveValue("South Korea"));
    expect(screen.getByLabelText(S.city)).toHaveValue("Seoul");
    expect(screen.getByText(S.suggestedFromBrowser)).toBeInTheDocument();

    const save = screen.getByRole("button", { name: S.save });
    await waitFor(() => expect(save).toBeEnabled()); // once the account has loaded
    fireEvent.click(save);
    expect(await screen.findByText(S.saved)).toBeInTheDocument();
    expect(requestBody(fetchMock, "/api/auth/me/preferences")).toEqual({
      default_country: "South Korea",
      default_metro_city: "Seoul",
    });
    expect(screen.queryByTestId("convert-language")).not.toBeInTheDocument();
  });

  it("lists the chosen country's major cities, with Other for any city", async () => {
    stubApi({ "/api/auth/me": { body: SESSION } });
    renderWithProviders(<SettingsPage />);
    await waitFor(() => expect(screen.getByLabelText(S.country)).toHaveValue("Japan"));

    fireEvent.change(screen.getByLabelText(S.country), { target: { value: "United States" } });
    const city = screen.getByLabelText(S.city);
    expect(city).toHaveValue(""); // the old city doesn't carry over
    expect(within(city).getByRole("option", { name: "New York" })).toBeInTheDocument();
    expect(within(city).queryByRole("option", { name: "Osaka" })).not.toBeInTheDocument();

    fireEvent.change(city, { target: { value: "__other__" } });
    fireEvent.change(screen.getByLabelText(S.otherCityLabel), { target: { value: "Boise" } });
    expect(screen.getByLabelText(S.otherCityLabel)).toHaveValue("Boise");
  });

  it("offers to switch everything to Korean when the country changes to South Korea", async () => {
    browserLanguages(["en-US"]);
    const translated: string[] = [];
    stubApi({
      "/api/auth/me/preferences": (init) => ({ body: { ...SESSION, ...JSON.parse(init.body as string) } }),
      "/api/auth/me": { body: SESSION },
      "/translate": () => ({ body: {} }),
      "/api/ventures/v1/stages": {
        body: [
          { slug: "idea_discovery", ai_analysis: { kind: "idea_research", summary: "x", language: "en", researched_at: "t" } },
          { slug: "existing_alternatives", ai_analysis: { kind: "alternatives_research", summary: "y", language: "ko" } },
          { slug: "problem_definition", ai_analysis: null },
        ],
      },
      "/api/ventures": { body: [{ id: "v1", title: "Recipes" }] },
    });
    const fetchMock = vi.mocked(fetch);
    renderWithProviders(<SettingsPage />);
    await waitFor(() => expect(screen.getByLabelText(S.country)).toHaveValue("Japan"));

    fireEvent.change(screen.getByLabelText(S.country), { target: { value: "South Korea" } });
    fireEvent.change(screen.getByLabelText(S.city), { target: { value: "Daejeon" } });
    fireEvent.click(screen.getByRole("button", { name: S.save }));

    const offer = await screen.findByTestId("convert-language");
    const korean = S.languageNames.ko;
    expect(offer).toHaveTextContent(`Change everything to ${korean}?`);
    fireEvent.click(within(offer).getByRole("button", { name: `Yes, change to ${korean}` }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/settings", { locale: "ko" }));
    expect(localStorage.getItem("weeaim.language")).toBe("ko");
    for (const [url, init] of fetchMock.mock.calls) {
      if (String(url).endsWith("/translate")) translated.push(`${url} ${init?.body}`);
    }
    // Only the English analysis is translated; Korean and empty stages are skipped.
    expect(translated).toEqual(['/api/ventures/v1/stages/idea_discovery/translate {"language":"ko"}']);
  });

  it("keeps the language when the user declines, or when it wouldn't change", async () => {
    browserLanguages(["en-US"]);
    stubApi({
      "/api/auth/me/preferences": (init) => ({ body: { ...SESSION, ...JSON.parse(init.body as string) } }),
      "/api/auth/me": { body: SESSION },
    });
    renderWithProviders(<SettingsPage />);
    await waitFor(() => expect(screen.getByLabelText(S.country)).toHaveValue("Japan"));

    fireEvent.change(screen.getByLabelText(S.country), { target: { value: "South Korea" } });
    fireEvent.click(screen.getByRole("button", { name: S.save }));
    fireEvent.click(await screen.findByRole("button", { name: S.convertNo }));
    expect(screen.queryByTestId("convert-language")).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();

    // English-speaking country while the app is in English: nothing to offer.
    fireEvent.change(screen.getByLabelText(S.country), { target: { value: "United States" } });
    fireEvent.click(screen.getByRole("button", { name: S.save }));
    await screen.findByText(S.saved);
    expect(screen.queryByTestId("convert-language")).not.toBeInTheDocument();
  });

  it("defaults the language to the browser's setting", async () => {
    browserLanguages(["ko-KR", "en-US"]);
    stubApi({ "/api/auth/me": { body: SESSION } });
    renderWithProviders(<SettingsPage />);

    const select = await screen.findByLabelText(S.languageLabel);
    expect(select).toHaveValue("browser");
    expect(screen.getByRole("option", { name: "Browser default (한국어 (Korean))" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: S.languageNames.en })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: S.languageNames.ko })).toBeInTheDocument();
  });

  it("switches to the chosen language and remembers it", async () => {
    browserLanguages(["en-US"]);
    stubApi({ "/api/auth/me": { body: SESSION } });
    renderWithProviders(<SettingsPage />);

    fireEvent.change(await screen.findByLabelText(S.languageLabel), { target: { value: "ko" } });

    expect(replaceMock).toHaveBeenCalledWith("/settings", { locale: "ko" });
    expect(localStorage.getItem("weeaim.language")).toBe("ko");
    expect(screen.getByLabelText(S.languageLabel)).toHaveValue("ko");
  });

  it("goes back to the browser's language", async () => {
    browserLanguages(["en-US"]);
    localStorage.setItem("weeaim.language", "ko");
    stubApi({ "/api/auth/me": { body: SESSION } });
    renderWithProviders(<SettingsPage />, "ko");

    const select = await screen.findByLabelText(ko.Settings.languageLabel);
    expect(select).toHaveValue("ko");
    fireEvent.change(select, { target: { value: "browser" } });

    expect(replaceMock).toHaveBeenCalledWith("/settings", { locale: "en" });
    expect(localStorage.getItem("weeaim.language")).toBe("browser");
  });

  it("doesn't navigate when the language is already in use", async () => {
    browserLanguages(["en-US"]);
    stubApi({ "/api/auth/me": { body: SESSION } });
    renderWithProviders(<SettingsPage />);

    fireEvent.change(await screen.findByLabelText(S.languageLabel), { target: { value: "en" } });
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("names the location card Default Market Location", async () => {
    stubApi({ "/api/auth/me": { body: SESSION }, "/api/token-usage": { body: TOKENS } });
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByText("Default Market Location")).toBeInTheDocument();
  });

  it("has a collapsible Token Usage Setting leading to the details page", async () => {
    stubApi({ "/api/auth/me": { body: SESSION }, "/api/token-usage": { body: TOKENS } });
    renderWithProviders(<SettingsPage />);

    const setting = (await screen.findByTestId("token-usage-setting")) as HTMLDetailsElement;
    expect(setting.querySelector("summary")).toHaveTextContent("Token Usage Setting");
    expect(setting.open).toBe(false);
    fireEvent.click(setting.querySelector("summary")!);
    expect(setting.open).toBe(true);
    await waitFor(() => expect(setting).toHaveTextContent("Your organization has used 1,234 tokens"));
    expect(setting).toHaveTextContent("Each venture idea may use up to 5,000 tokens.");
    expect(within(setting).getByRole("link", { name: /View token usage details/ })).toHaveAttribute(
      "href",
      "/settings/tokens",
    );
  });
});
