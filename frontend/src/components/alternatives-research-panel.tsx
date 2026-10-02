"use client";

import { useMutation } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  isAlternativesResearch,
  researchStage,
  type AlternativesResearchAnalysis,
} from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";

type Category = AlternativesResearchAnalysis["alternatives"][number]["category"];

const CATEGORY_ORDER: Category[] = ["direct_competitor", "indirect_competitor", "substitute", "workaround"];

const CATEGORY_CLASSES: Record<Category, string> = {
  direct_competitor: "bg-red-50 text-red-700",
  indirect_competitor: "bg-amber-50 text-amber-700",
  substitute: "bg-violet-50 text-violet-700",
  workaround: "bg-slate-100 text-slate-700",
};

// Links come from the web and are untrusted: open separately, share no
// referrer, and give them no ranking credit.
const EXTERNAL_LINK = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;

function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Stage 4: the alternatives customers use today, researched on the web from
 * the founder's stages 1-3. Runs automatically the first time the stage is
 * opened, and on request after that.
 */
export function AlternativesResearchPanel({
  ventureId,
  analysis,
  language,
  onResearched,
  historical = false,
  onBackToLatest,
}: {
  ventureId: string;
  analysis: AlternativesResearchAnalysis | null;
  language: "en" | "ko";
  onResearched: () => void;
  /** Showing an earlier saved run instead of the latest research. */
  historical?: boolean;
  onBackToLatest?: () => void;
}) {
  const t = useTranslations("AlternativesResearch");
  const tLogin = useTranslations("Login");
  const format = useFormatter();
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  const researchMutation = useMutation({
    mutationFn: () => researchStage(ventureId, "existing_alternatives", language),
    onSuccess: onResearched,
  });

  // Research the alternatives once, automatically, when there's nothing yet.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!analysis && !historical && !autoStarted.current) {
      autoStarted.current = true;
      researchMutation.mutate();
    }
  }, [analysis, historical, researchMutation]);

  const fresh = isAlternativesResearch(researchMutation.data ?? null) ? researchMutation.data : null;
  const shown = historical ? analysis : (fresh ?? analysis);

  return (
    <section aria-labelledby="alternatives-research-title" className="flex flex-col gap-4 rounded-lg border bg-slate-50/60 p-4">
      <h3 id="alternatives-research-title" className="font-semibold">
        {t("title")}
      </h3>

      {historical && shown && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>{t("viewingEarlier", { date: when(shown.researched_at) })}</span>
          <Button size="sm" variant="outline" onClick={onBackToLatest}>
            {t("backToLatest")}
          </Button>
        </div>
      )}

      {researchMutation.isPending && (
        <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
          <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          {t("researching")}
        </p>
      )}

      {researchMutation.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-800">
          <span>{authErrorMessage(researchMutation.error, tLogin, { byStatus: { 503: t("failed") } })}</span>
          <Button size="sm" variant="outline" onClick={() => researchMutation.mutate()}>
            {t("retry")}
          </Button>
        </div>
      )}

      {shown && (
        <>
          <p className="text-sm leading-relaxed">{shown.summary}</p>

          {shown.alternatives.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noneFound")}</p>
          ) : (
            CATEGORY_ORDER.map((category) => {
              const items = shown.alternatives.filter((alt) => alt.category === category);
              if (items.length === 0) return null;
              return (
                <div key={category}>
                  <h4 className="mb-2 text-sm font-semibold">{t(`categories.${category}`)}</h4>
                  <ul className="flex flex-col gap-2">
                    {items.map((alt) => (
                      <li key={alt.name} className="rounded-md border bg-white p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          {alt.url ? (
                            <a href={alt.url} {...EXTERNAL_LINK} className="font-medium text-blue-700 hover:underline">
                              {alt.name}
                            </a>
                          ) : (
                            <span className="font-medium">{alt.name}</span>
                          )}
                          <span className={`rounded px-1.5 py-0.5 text-xs ${CATEGORY_CLASSES[category]}`}>
                            {t(`categories.${category}`)}
                          </span>
                        </div>
                        <p className="text-muted-foreground mt-1">{alt.description}</p>
                        {(alt.strengths.length > 0 || alt.weaknesses.length > 0) && (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            {alt.strengths.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-green-800">{t("strengths")}</p>
                                <ul className="list-disc pl-4 text-xs">
                                  {alt.strengths.map((item, i) => (
                                    <li key={i}>{item}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {alt.weaknesses.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-red-800">{t("weaknesses")}</p>
                                <ul className="list-disc pl-4 text-xs">
                                  {alt.weaknesses.map((item, i) => (
                                    <li key={i}>{item}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                        {alt.pricing && <p className="mt-2 text-xs">{t("pricing", { pricing: alt.pricing })}</p>}
                        <p className="mt-1">
                          {alt.url ? (
                            <a
                              href={alt.url}
                              {...EXTERNAL_LINK}
                              aria-label={t("visitWebsiteOf", { name: alt.name })}
                              className="break-all text-blue-700 hover:underline"
                            >
                              {t("visitWebsite")} ↗ <span className="text-muted-foreground">{displayHost(alt.url)}</span>
                            </a>
                          ) : (
                            category !== "workaround" && (
                              <a
                                href={alt.search_url}
                                {...EXTERNAL_LINK}
                                aria-label={t("searchWebFor", { name: alt.name })}
                                className="text-blue-700 hover:underline"
                              >
                                {t("searchWeb")} ↗
                              </a>
                            )
                          )}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <ListSection title={t("barriersTitle")} items={shown.switching_barriers} />
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
              <ListSection title={t("needsTitle")} items={shown.unmet_needs} highlight />
            </div>
            <ListSection title={t("positioningTitle")} items={shown.positioning_recommendations} />
            <ListSection title={t("nextStepsTitle")} items={shown.suggested_next_steps} />
          </div>

          <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
            <span className="flex flex-col gap-0.5">
              {shown.based_on && <span>{t("basedOn", { date: when(shown.based_on) })}</span>}
              <span>{t("disclaimer", { date: when(shown.researched_at) })}</span>
            </span>
            {!historical && (
              <Button
                size="sm"
                variant="outline"
                disabled={researchMutation.isPending}
                onClick={() => researchMutation.mutate()}
              >
                {t("rerun")}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ListSection({ title, items, highlight = false }: { title: string; items: string[]; highlight?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className={`mb-1 text-sm font-semibold ${highlight ? "text-blue-900" : ""}`}>{title}</h4>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
