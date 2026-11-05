/**
 * Where the founder is, for Stage 6 market sizing. Order of preference:
 *
 *   country: account default -> browser locale's region -> time zone's country
 *   city:    account default -> time zone's city (only if in that country)
 *
 * Everything here runs in the browser; nothing is looked up or sent anywhere.
 * The result only pre-fills fields the founder confirms.
 */

/** Region code and main city for common time zones. */
const TIME_ZONE_LOCATIONS: Record<string, { region: string; city: string }> = {
  "Asia/Seoul": { region: "KR", city: "Seoul" },
  "Asia/Tokyo": { region: "JP", city: "Tokyo" },
  "Asia/Shanghai": { region: "CN", city: "Shanghai" },
  "Asia/Hong_Kong": { region: "HK", city: "Hong Kong" },
  "Asia/Taipei": { region: "TW", city: "Taipei" },
  "Asia/Singapore": { region: "SG", city: "Singapore" },
  "Asia/Ho_Chi_Minh": { region: "VN", city: "Ho Chi Minh City" },
  "Asia/Bangkok": { region: "TH", city: "Bangkok" },
  "Asia/Jakarta": { region: "ID", city: "Jakarta" },
  "Asia/Manila": { region: "PH", city: "Manila" },
  "Asia/Kolkata": { region: "IN", city: "Mumbai" },
  "Asia/Tashkent": { region: "UZ", city: "Tashkent" },
  "Asia/Ulaanbaatar": { region: "MN", city: "Ulaanbaatar" },
  "Asia/Dubai": { region: "AE", city: "Dubai" },
  "Australia/Sydney": { region: "AU", city: "Sydney" },
  "Europe/London": { region: "GB", city: "London" },
  "Europe/Paris": { region: "FR", city: "Paris" },
  "Europe/Berlin": { region: "DE", city: "Berlin" },
  "Europe/Madrid": { region: "ES", city: "Madrid" },
  "America/New_York": { region: "US", city: "New York" },
  "America/Chicago": { region: "US", city: "Chicago" },
  "America/Denver": { region: "US", city: "Denver" },
  "America/Los_Angeles": { region: "US", city: "Los Angeles" },
  "America/Toronto": { region: "CA", city: "Toronto" },
  "America/Vancouver": { region: "CA", city: "Vancouver" },
  "America/Mexico_City": { region: "MX", city: "Mexico City" },
  "America/Sao_Paulo": { region: "BR", city: "São Paulo" },
};

export type LocationSource = "account" | "browserLanguage" | "timeZone" | "saved" | null;

export type BrowserSignals = { languages: readonly string[]; timeZone: string };

export function browserSignals(): BrowserSignals {
  return {
    languages: typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : [],
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** English country name for a region code, e.g. "KR" -> "South Korea". */
function countryName(region: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(region) ?? region;
  } catch {
    return region;
  }
}

/** The region of the first browser language that names one, e.g. "ko-KR" -> "KR". */
function localeRegion(languages: readonly string[]): string | null {
  for (const language of languages) {
    try {
      const region = new Intl.Locale(language).region;
      if (region) return region;
    } catch {
      // Ignore malformed language tags.
    }
  }
  return null;
}

/** Kept for callers that only need a quick time-zone guess. */
export function guessLocation(
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): { country: string; city: string } | null {
  const entry = TIME_ZONE_LOCATIONS[timeZone];
  return entry ? { country: countryName(entry.region), city: entry.city } : null;
}

/** Browser-only best guess (no account default). */
export function browserLocation(browser: BrowserSignals = browserSignals()) {
  return resolveDefaultLocation({ browser });
}

/**
 * The location to pre-fill, and where each part came from. Values already
 * saved for this venture always win; then the account default; then the
 * browser (locale for the country, time zone for the city).
 */
export function resolveDefaultLocation({
  saved,
  account,
  browser = browserSignals(),
}: {
  saved?: { country?: string | null; city?: string | null };
  account?: { country?: string | null; city?: string | null };
  browser?: BrowserSignals;
}): { country: string; city: string; countrySource: LocationSource; citySource: LocationSource } {
  const zone = TIME_ZONE_LOCATIONS[browser.timeZone] ?? null;
  const localeCountry = localeRegion(browser.languages);

  let country = "";
  let countrySource: LocationSource = null;
  let region: string | null = null;
  if (saved?.country?.trim()) {
    [country, countrySource] = [saved.country.trim(), "saved"];
  } else if (account?.country?.trim()) {
    [country, countrySource] = [account.country.trim(), "account"];
  } else if (localeCountry) {
    [region, countrySource] = [localeCountry, "browserLanguage"];
    country = countryName(localeCountry);
  } else if (zone) {
    [region, countrySource] = [zone.region, "timeZone"];
    country = countryName(zone.region);
  }

  let city = "";
  let citySource: LocationSource = null;
  if (saved?.city?.trim()) {
    [city, citySource] = [saved.city.trim(), "saved"];
  } else if (account?.city?.trim()) {
    [city, citySource] = [account.city.trim(), "account"];
  } else if (zone) {
    // Only use the time zone's city if it's in the country we settled on.
    const sameCountry = region ? zone.region === region : countryName(zone.region) === country;
    if (sameCountry) [city, citySource] = [zone.city, "timeZone"];
  }

  return { country, city, countrySource, citySource };
}
