import { describe, expect, it } from "vitest";

import { MAJOR_CITIES, majorCities } from "./cities";
import { COUNTRY_CODES, countryCode, countryName, countryOptions, languageForCountry } from "./countries";

describe("countries", () => {
  it("covers the whole globe and stores English names", () => {
    expect(COUNTRY_CODES.length).toBeGreaterThan(240);
    expect(countryName("KR")).toBe("South Korea");
    const en = countryOptions("en");
    expect(en.find((o) => o.code === "JP")).toEqual({ code: "JP", label: "Japan", value: "Japan" });
  });

  it("shows names in the page's language but keeps the English value", () => {
    const korea = countryOptions("ko").find((o) => o.code === "KR")!;
    expect(korea.label).toBe("대한민국");
    expect(korea.value).toBe("South Korea");
  });

  it("recognizes stored names and common aliases", () => {
    expect(countryCode("South Korea")).toBe("KR");
    expect(countryCode("korea")).toBe("KR");
    expect(countryCode("USA")).toBe("US");
    expect(countryCode("United Kingdom")).toBe("GB");
    expect(countryCode("Atlantis")).toBeNull();
    expect(countryCode("")).toBeNull();
  });

  it("uses Korean for South Korea and English everywhere else", () => {
    expect(languageForCountry("South Korea")).toBe("ko");
    expect(languageForCountry("Japan")).toBe("en");
    expect(languageForCountry(null)).toBe("en");
  });
});

describe("major cities", () => {
  it("are keyed by real country codes, largest first, without duplicates", () => {
    for (const [code, cities] of Object.entries(MAJOR_CITIES)) {
      expect(COUNTRY_CODES).toContain(code);
      expect(new Set(cities).size).toBe(cities.length);
    }
    expect(Object.keys(MAJOR_CITIES).length).toBeGreaterThan(190);
    expect(majorCities("KR").slice(0, 2)).toEqual(["Seoul", "Busan"]);
    expect(majorCities("KR")).toContain("Daejeon");
    expect(majorCities(null)).toEqual([]);
    expect(majorCities("AQ")).toEqual([]); // no list: "Other" lets the user type one
  });
});
