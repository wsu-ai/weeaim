import { describe, expect, it } from "vitest";

import { resolveDefaultLocation } from "./location";

const seoulKorean = { languages: ["ko-KR", "ko"], timeZone: "Asia/Seoul" };

describe("resolveDefaultLocation", () => {
  it("uses the account default first", () => {
    expect(
      resolveDefaultLocation({ account: { country: "Japan", city: "Osaka" }, browser: seoulKorean }),
    ).toEqual({ country: "Japan", city: "Osaka", countrySource: "account", citySource: "account" });
  });

  it("falls back to the browser language for the country and the time zone for the city", () => {
    expect(resolveDefaultLocation({ browser: seoulKorean })).toEqual({
      country: "South Korea",
      city: "Seoul",
      countrySource: "browserLanguage",
      citySource: "timeZone",
    });
  });

  it("doesn't pair a time-zone city with a different locale country", () => {
    expect(
      resolveDefaultLocation({ browser: { languages: ["en-US"], timeZone: "Asia/Seoul" } }),
    ).toEqual({ country: "United States", city: "", countrySource: "browserLanguage", citySource: null });
  });

  it("uses the time zone for the country when the language names no region", () => {
    expect(
      resolveDefaultLocation({ browser: { languages: ["ko"], timeZone: "Asia/Seoul" } }),
    ).toEqual({ country: "South Korea", city: "Seoul", countrySource: "timeZone", citySource: "timeZone" });
  });

  it("combines an account country with the browser's city when they match", () => {
    expect(
      resolveDefaultLocation({ account: { country: "South Korea" }, browser: seoulKorean }),
    ).toEqual({ country: "South Korea", city: "Seoul", countrySource: "account", citySource: "timeZone" });
  });

  it("never overrides values already saved for the venture", () => {
    expect(
      resolveDefaultLocation({
        saved: { country: "Vietnam", city: "Hanoi" },
        account: { country: "Japan", city: "Osaka" },
        browser: seoulKorean,
      }),
    ).toMatchObject({ country: "Vietnam", city: "Hanoi", countrySource: "saved", citySource: "saved" });
  });

  it("leaves both blank when nothing is known", () => {
    expect(resolveDefaultLocation({ browser: { languages: [], timeZone: "Etc/UTC" } })).toEqual({
      country: "",
      city: "",
      countrySource: null,
      citySource: null,
    });
  });
});
