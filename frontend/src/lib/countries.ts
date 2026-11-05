/**
 * Every country (ISO 3166-1 alpha-2), named by the browser's Intl data in
 * the page's language. The account stores the English name (e.g. "South
 * Korea"), as Stage 6 market sizing expects.
 */

export const COUNTRY_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN",
  "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE",
  "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM",
  "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC",
  "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK",
  "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG",
  "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO",
  "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "XK", "YE", "YT", "ZA", "ZM", "ZW",
] as const;

export type CountryCode = (typeof COUNTRY_CODES)[number];

function displayNames(locale: string): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([locale], { type: "region" });
  } catch {
    return null;
  }
}

/** English name for a code, e.g. "KR" -> "South Korea" (what the account stores). */
export function countryName(code: string): string {
  return displayNames("en")?.of(code) ?? code;
}

/** Countries sorted by their name in the page's language. */
export function countryOptions(locale: string): { code: string; label: string; value: string }[] {
  const local = displayNames(locale);
  const options = COUNTRY_CODES.map((code) => ({
    code,
    label: local?.of(code) ?? code,
    value: countryName(code),
  }));
  return options.sort((a, b) => a.label.localeCompare(b.label, locale));
}

// Names people commonly type that Intl doesn't use.
const ALIASES: Record<string, string> = {
  korea: "KR",
  "republic of korea": "KR",
  "korea, republic of": "KR",
  "대한민국": "KR",
  "한국": "KR",
  usa: "US",
  "united states of america": "US",
  america: "US",
  uk: "GB",
  "great britain": "GB",
  england: "GB",
};

/** The code for a stored country name (English or a common alias); null if unknown. */
export function countryCode(name: string | null | undefined): string | null {
  const wanted = (name ?? "").trim().toLowerCase();
  if (!wanted) return null;
  if (ALIASES[wanted]) return ALIASES[wanted];
  const english = displayNames("en");
  const match = COUNTRY_CODES.find((code) => (english?.of(code) ?? "").toLowerCase() === wanted);
  return match ?? null;
}

/** The app language for a country: Korean for South Korea, English elsewhere. */
export function languageForCountry(name: string | null | undefined): "en" | "ko" {
  return countryCode(name) === "KR" ? "ko" : "en";
}
