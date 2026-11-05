import { afterEach, describe, expect, it } from "vitest";

import { browserLocale, localeFor, saveLanguageChoice, savedLanguageChoice } from "./language";

afterEach(() => {
  localStorage.clear();
  document.cookie = "NEXT_LOCALE=; Max-Age=0; path=/";
});

describe("language preference", () => {
  it("takes the first supported browser language", () => {
    expect(browserLocale(["ko-KR", "en-US"])).toBe("ko");
    expect(browserLocale(["fr-FR", "en-GB"])).toBe("en");
    expect(browserLocale(["fr-FR", "ja"])).toBe("en"); // nothing supported: the default
    expect(browserLocale([])).toBe("en");
  });

  it("follows the browser until a language is chosen", () => {
    expect(savedLanguageChoice()).toBe("browser");
    saveLanguageChoice("ko");
    expect(savedLanguageChoice()).toBe("ko");
    localStorage.setItem("weeaim.language", "klingon");
    expect(savedLanguageChoice()).toBe("browser");
  });

  it("forgets the remembered locale when going back to the browser default", () => {
    document.cookie = "NEXT_LOCALE=ko; path=/";
    saveLanguageChoice("browser");
    expect(document.cookie).not.toContain("NEXT_LOCALE=ko");
  });

  it("resolves a choice to a locale", () => {
    expect(localeFor("browser", "ko")).toBe("ko");
    expect(localeFor("en", "ko")).toBe("en");
  });
});
