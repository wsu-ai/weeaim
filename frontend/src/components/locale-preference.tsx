"use client";

import { useLocale } from "next-intl";
import { useEffect } from "react";

import { usePathname, useRouter } from "@/i18n/navigation";
import { savedLanguageChoice, type AppLocale } from "@/lib/language";

/**
 * Keeps every page in the language chosen in Settings: a page opened in
 * another language (an old link, a bookmark, a lost cookie) switches to the
 * chosen one. "Browser default" leaves the locale to the browser.
 */
export function LocalePreference() {
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const choice = savedLanguageChoice();
    if (choice !== "browser" && choice !== locale) {
      router.replace(`${pathname}${window.location.search}`, { locale: choice });
    }
  }, [locale, pathname, router]);

  return null;
}
