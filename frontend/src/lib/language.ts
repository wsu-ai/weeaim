import { routing } from "@/i18n/routing";

export type AppLocale = (typeof routing.locales)[number];
/** "browser" follows the browser's language; otherwise a fixed choice. */
export type LanguageChoice = "browser" | AppLocale;

const CHOICE_KEY = "weeaim.language";
// next-intl's cookie: the locale the middleware sends returning visitors to.
const LOCALE_COOKIE = "NEXT_LOCALE";

function isLocale(value: string): value is AppLocale {
  return (routing.locales as readonly string[]).includes(value);
}

/** The first supported language in the browser's preferences (en if none). */
export function browserLocale(
  languages: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language],
): AppLocale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return routing.defaultLocale;
}

/** The saved choice; "browser" when there is none (the default). */
export function savedLanguageChoice(): LanguageChoice {
  try {
    const value = localStorage.getItem(CHOICE_KEY);
    return value && (value === "browser" || isLocale(value)) ? value : "browser";
  } catch {
    return "browser"; // storage unavailable (private window): follow the browser
  }
}

/** Remembers the choice; "browser" also forgets next-intl's remembered locale. */
export function saveLanguageChoice(choice: LanguageChoice): void {
  try {
    localStorage.setItem(CHOICE_KEY, choice);
  } catch {
    // Not fatal: the locale in the URL still applies for this visit.
  }
  if (choice === "browser") {
    document.cookie = `${LOCALE_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;
  }
}

/** The locale a choice resolves to. */
export function localeFor(choice: LanguageChoice, browser: AppLocale = browserLocale()): AppLocale {
  return choice === "browser" ? browser : choice;
}
