"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getTokenUsage, updatePreferences } from "@/lib/api";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { authErrorMessage } from "@/lib/auth-errors";
import {
  browserLocale,
  localeFor,
  saveLanguageChoice,
  savedLanguageChoice,
  type AppLocale,
  type LanguageChoice,
} from "@/lib/language";
import { majorCities } from "@/lib/cities";
import { countryCode, countryOptions, languageForCountry } from "@/lib/countries";
import { browserLocation } from "@/lib/location";
import { useSession, useSetSession } from "@/lib/session";
import { translateAllContent } from "@/lib/translate-all";

const noSubscribe = () => () => {};

/** The preferred language: the browser's by default, or a fixed choice. */
function LanguageCard() {
  const t = useTranslations("Settings");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const pathname = usePathname();
  // Read on the client only; the server render assumes the defaults.
  const stored = useSyncExternalStore<LanguageChoice>(noSubscribe, savedLanguageChoice, () => "browser");
  const browser = useSyncExternalStore<AppLocale>(noSubscribe, () => browserLocale(), () => routing.defaultLocale);
  const [picked, setPicked] = useState<LanguageChoice | null>(null);
  const choice = picked ?? stored;

  function choose(next: LanguageChoice) {
    setPicked(next);
    saveLanguageChoice(next);
    const target = localeFor(next, browser);
    // Switching the locale route also makes next-intl remember it (NEXT_LOCALE).
    if (target !== locale) router.replace(pathname, { locale: target });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("languageTitle")}</CardTitle>
        <CardDescription>{t("languageDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <label htmlFor="preferred_language" className="text-sm font-medium">
          {t("languageLabel")}
        </label>
        <select
          id="preferred_language"
          className="border-input h-9 w-full max-w-xs rounded-md border bg-white px-2 text-sm"
          value={choice}
          onChange={(e) => choose(e.target.value as LanguageChoice)}
        >
          <option value="browser">{t("browserDefault", { language: t(`languageNames.${browser}`) })}</option>
          {routing.locales.map((code) => (
            <option key={code} value={code}>
              {t(`languageNames.${code}`)}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground text-xs">{t("languageNote")}</p>
      </CardContent>
    </Card>
  );
}

const OTHER = "__other__";

type LocationDraft = { country: string; city: string; otherCity: boolean };

/** After the country changes: offer to switch the app and all AI content to its language. */
function ConvertLanguageOffer({ target, onClose }: { target: AppLocale; onClose: () => void }) {
  const t = useTranslations("Settings");
  const router = useRouter();
  const pathname = usePathname();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const language = t(`languageNames.${target}`);

  const convertMutation = useMutation({
    mutationFn: () => translateAllContent(target, (done, total) => setProgress({ done, total })),
    onSuccess: () => {
      saveLanguageChoice(target);
      router.replace(pathname, { locale: target });
    },
  });

  return (
    <div
      role="alertdialog"
      aria-labelledby="convert-language-title"
      className="flex flex-col gap-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm"
      data-testid="convert-language"
    >
      <p id="convert-language-title" className="font-medium text-blue-950">
        {t("convertQuestion", { language })}
      </p>
      <p className="text-blue-950">{t("convertBody", { language })}</p>
      {convertMutation.isPending && progress && (
        <p role="status" className="text-blue-950">
          {t("converting", { done: progress.done, total: progress.total })}
        </p>
      )}
      {convertMutation.isSuccess && (
        <p role="status" className="text-green-800">
          {convertMutation.data.failed > 0
            ? t("convertedSome", { failed: convertMutation.data.failed, language })
            : t("converted", { language })}
        </p>
      )}
      {convertMutation.isError && (
        <p role="alert" className="text-destructive">
          {t("convertFailed")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => convertMutation.mutate()} disabled={convertMutation.isPending || convertMutation.isSuccess}>
          {convertMutation.isPending ? t("convertWorking") : t("convertYes", { language })}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={convertMutation.isPending}>
          {t("convertNo")}
        </Button>
      </div>
    </div>
  );
}

/** "Token Usage Setting": collapsed by default; opens to a summary and the details page. */
function TokenUsageCard() {
  const t = useTranslations("Tokens");
  const format = useFormatter();
  const usage = useQuery({ queryKey: ["token-usage"], queryFn: getTokenUsage }).data;

  return (
    <Card className="py-0">
      <details className="group" data-testid="token-usage-setting">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-6 py-4 font-semibold hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-90" />
          {t("settingTitle")}
        </summary>
        <CardContent className="flex flex-col gap-2 border-t pt-4 pb-5 text-sm">
          {usage ? (
            <>
              <p>
                {t("summaryOrganization", { used: format.number(usage.organization_total) })}{" "}
                <span className="text-muted-foreground">
                  {usage.limits.organization_limit
                    ? t("ofLimit", { limit: format.number(usage.limits.organization_limit) })
                    : t("noLimit")}
                </span>
              </p>
              <p className="text-muted-foreground">
                {usage.limits.per_venture_limit
                  ? t("perVentureLimitIs", { limit: format.number(usage.limits.per_venture_limit) })
                  : t("noPerVentureLimit")}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">{t("loading")}</p>
          )}
          <Link href="/settings/tokens" className="font-medium text-blue-700 hover:underline">
            {t("viewDetails")} →
          </Link>
        </CardContent>
      </details>
    </Card>
  );
}

/** Account settings: preferred language, and the default location used to pre-fill Stage 6. */
export default function SettingsPage() {
  const t = useTranslations("Settings");
  const tLogin = useTranslations("Login");
  const locale = useLocale() as AppLocale;
  const session = useSession().data;
  const setSession = useSetSession();
  // The first time, suggest the browser's country (and its time zone's city).
  const browserCountry = useSyncExternalStore(noSubscribe, () => browserLocation().country, () => "");
  const browserCity = useSyncExternalStore(noSubscribe, () => browserLocation().city, () => "");
  const savedCountry = session?.default_country ?? "";
  const suggested = !savedCountry && !!browserCountry;
  // null = untouched: show what the account has saved (or the suggestion).
  const [draft, setDraft] = useState<LocationDraft | null>(null);
  const [offer, setOffer] = useState<AppLocale | null>(null);

  const base = savedCountry
    ? { country: savedCountry, city: session?.default_metro_city ?? "" }
    : { country: browserCountry, city: browserCity };
  const cities = majorCities(countryCode((draft ?? base).country));
  const values: LocationDraft = draft ?? {
    ...base,
    otherCity: !!base.city && !cities.includes(base.city),
  };
  const options = countryOptions(locale);
  // A saved name that isn't in the list (e.g. typed before) stays selectable.
  const knownCountry = !values.country || options.some((o) => o.value === values.country);

  const saveMutation = useMutation({
    mutationFn: () =>
      updatePreferences({ default_country: values.country.trim(), default_metro_city: values.city.trim() }),
    onSuccess: (updated) => {
      const next = updated.default_country ?? "";
      // Changing an existing country to one with another language: offer to switch.
      if (savedCountry && next && savedCountry !== next && languageForCountry(next) !== locale) {
        setOffer(languageForCountry(next));
      }
      setSession(updated);
      setDraft(null);
    },
  });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <LanguageCard />
      <Card>
        <CardHeader>
          <CardTitle>{t("locationTitle")}</CardTitle>
          <CardDescription>{t("locationDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveMutation.mutate();
            }}
          >
            <label htmlFor="default_country" className="text-sm font-medium">
              {t("country")}
            </label>
            <select
              id="default_country"
              className="border-input h-9 w-full rounded-md border bg-white px-2 text-sm"
              value={values.country}
              onChange={(e) => setDraft({ country: e.target.value, city: "", otherCity: false })}
            >
              <option value="">{t("chooseCountry")}</option>
              {!knownCountry && <option value={values.country}>{values.country}</option>}
              {options.map((option) => (
                <option key={option.code} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {suggested && !draft && <p className="text-muted-foreground text-xs">{t("suggestedFromBrowser")}</p>}

            <label htmlFor="default_metro_city" className="text-sm font-medium">
              {t("city")}
            </label>
            <select
              id="default_metro_city"
              className="border-input h-9 w-full rounded-md border bg-white px-2 text-sm disabled:opacity-50"
              disabled={!values.country}
              value={values.otherCity ? OTHER : cities.includes(values.city) ? values.city : ""}
              onChange={(e) =>
                setDraft(
                  e.target.value === OTHER
                    ? { ...values, city: "", otherCity: true }
                    : { ...values, city: e.target.value, otherCity: false },
                )
              }
            >
              <option value="">{values.country ? t("chooseCity") : t("chooseCountryFirst")}</option>
              {cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
              <option value={OTHER}>{t("otherCity")}</option>
            </select>
            {values.otherCity && (
              <>
                <label htmlFor="default_metro_city_other" className="text-sm font-medium">
                  {t("otherCityLabel")}
                </label>
                <Input
                  id="default_metro_city_other"
                  maxLength={100}
                  value={values.city}
                  onChange={(e) => setDraft({ ...values, city: e.target.value, otherCity: true })}
                />
              </>
            )}

            {saveMutation.isError && (
              <p role="alert" className="text-destructive text-sm">
                {authErrorMessage(saveMutation.error, tLogin)}
              </p>
            )}
            {saveMutation.isSuccess && !draft && (
              <p role="status" className="text-sm text-green-700">
                {t("saved")}
              </p>
            )}
            <div>
              <Button type="submit" disabled={saveMutation.isPending || !session || !values.country}>
                {saveMutation.isPending ? t("saving") : t("save")}
              </Button>
            </div>
          </form>
          {offer && <ConvertLanguageOffer target={offer} onClose={() => setOffer(null)} />}
        </CardContent>
      </Card>
      <TokenUsageCard />
    </main>
  );
}
