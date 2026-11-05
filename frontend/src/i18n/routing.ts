import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "ko"],
  defaultLocale: "en",
  // Remember the chosen language for a year (next-intl's default cookie ends
  // with the browser session, which sent returning users back to the
  // browser's language).
  localeCookie: { maxAge: 60 * 60 * 24 * 365 },
});
