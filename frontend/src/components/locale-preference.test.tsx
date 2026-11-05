import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, replaceMock } from "@/test/auth-helpers";
import { LocalePreference } from "./locale-preference";

vi.mock("@/i18n/navigation", async () => (await import("@/test/auth-helpers")).navigationMock);

afterEach(() => {
  localStorage.clear();
  replaceMock.mockClear();
});

describe("LocalePreference", () => {
  it("switches a page opened in English to the chosen Korean", () => {
    localStorage.setItem("weeaim.language", "ko");
    renderWithProviders(<LocalePreference />, "en");
    expect(replaceMock).toHaveBeenCalledWith("/settings", { locale: "ko" });
  });

  it("switches a page opened in Korean to the chosen English", () => {
    localStorage.setItem("weeaim.language", "en");
    renderWithProviders(<LocalePreference />, "ko");
    expect(replaceMock).toHaveBeenCalledWith("/settings", { locale: "en" });
  });

  it("leaves the page alone when it's already in the chosen language", () => {
    localStorage.setItem("weeaim.language", "ko");
    renderWithProviders(<LocalePreference />, "ko");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("follows the browser when no language is chosen", () => {
    renderWithProviders(<LocalePreference />, "en");
    localStorage.setItem("weeaim.language", "browser");
    renderWithProviders(<LocalePreference />, "ko");
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
