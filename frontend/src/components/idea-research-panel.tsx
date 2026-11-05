"use client";

import { useMutation } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { isIdeaResearch, researchIdea, type IdeaResearchAnalysis } from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";

const MARKET_STATUS_CLASSES: Record<IdeaResearchAnalysis["market_status"], string> = {
  no_close_matches_found: "bg-green-100 text-green-800",
  some_similar_offerings: "bg-amber-100 text-amber-800",
  crowded_market: "bg-red-100 text-red-800",
};

const SIMILARITY_CLASSES: Record<IdeaResearchAnalysis["existing_solutions"][number]["similarity"], string> = {
  direct: "bg-red-50 text-red-700",
  partial: "bg-amber-50 text-amber-700",
  adjacent: "bg-slate-100 text-slate-700",
};

function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Fallback for research saved before the backend provided search links.
function webSearchUrl(name: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(name)}`;
}

// Links come from the web and are untrusted: open separately, share no
// referrer, and give them no ranking credit.
const EXTERNAL_LINK = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;

/**
 * Stage 1: the AI's web-researched expert view of the idea. Runs the research
 * automatically the first time the stage is opened, and on request after that.
 */
export function IdeaResearchPanel({
  ventureId,
  analysis,
  language,
  onResearched,
  historical = false,
  onBackToLatest,
}: {
  ventureId: string;
  analysis: IdeaResearchAnalysis | null;
  language: "en" | "ko";
  onResearched: () => void;
  /** Showing an earlier saved run instead of the latest research. */
  historical?: boolean;
  onBackToLatest?: () => void;
}) {
  const t = useTranslations("IdeaResearch");
  const tLogin = useTranslations("Login");
  const format = useFormatter();

  const researchMutation = useMutation({
    mutationFn: () => researchIdea(ventureId, language),
    onSuccess: onResearched,
  });

  // Research the idea once, automatically, when there's nothing yet.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!analysis && !historical && !autoStarted.current) {
      autoStarted.current = true;
      researchMutation.mutate();
    }
  }, [analysis, historical, researchMutation]);

  // Only render a response that really is research (guards against a
  // malformed or unexpected API response breaking the page).
  const fresh = isIdeaResearch(researchMutation.data ?? null) ? researchMutation.data : null;
  const shown = historical ? analysis : (fresh ?? analysis);

  return (
    <section aria-labelledby="idea-research-title" className="flex flex-col gap-4 rounded-lg border bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="idea-research-title" className="font-semibold">
          {t("title")}
        </h3>
        {shown && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${MARKET_STATUS_CLASSES[shown.market_status]}`}>
            {t(`marketStatus.${shown.market_status}`)}
          </span>
        )}
      </div>

      {historical && shown && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            {t("viewingEarlier", {
              date: format.dateTime(new Date(shown.researched_at), { dateStyle: "medium", timeStyle: "short" }),
            })}
          </span>
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

          <div>
            <h4 className="mb-2 text-sm font-semibold">{t("existingTitle")}</h4>
            {shown.existing_solutions.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noneFound")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {shown.existing_solutions.map((solution) => (
                  <li key={solution.name} className="rounded-md border bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      {solution.url ? (
                        <a href={solution.url} {...EXTERNAL_LINK} className="font-medium text-blue-700 hover:underline">
                          {solution.name}
                        </a>
                      ) : (
                        <span className="font-medium">{solution.name}</span>
                      )}
                      <span className={`rounded px-1.5 py-0.5 text-xs ${SIMILARITY_CLASSES[solution.similarity]}`}>
                        {t(`similarity.${solution.similarity}`)}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-1">{solution.description}</p>
                    <p className="mt-1">
                      {solution.url ? (
                        <a
                          href={solution.url}
                          {...EXTERNAL_LINK}
                          aria-label={t("visitWebsiteOf", { name: solution.name })}
                          className="break-all text-blue-700 hover:underline"
                        >
                          {t("visitWebsite")} ↗ <span className="text-muted-foreground">{displayHost(solution.url)}</span>
                        </a>
                      ) : (
                        <a
                          href={solution.search_url ?? webSearchUrl(solution.name)}
                          {...EXTERNAL_LINK}
                          aria-label={t("searchWebFor", { name: solution.name })}
                          className="text-blue-700 hover:underline"
                        >
                          {t("searchWeb")} ↗
                        </a>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
            <h4 className="mb-1 text-sm font-semibold text-blue-900">{t("differentiationTitle")}</h4>
            <BulletList items={shown.differentiation_opportunities} />
          </div>

          <div className="flex flex-col gap-2">
            <ListSection title={t("feasibilityTitle")} items={shown.feasibility} />
            <ListSection title={t("viabilityTitle")} items={shown.viability} />
            <ListSection title={t("risksTitle")} items={shown.key_risks} />
            <ListSection title={t("nextStepsTitle")} items={shown.suggested_next_steps} />
          </div>

          <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
            <span>
              {t("disclaimer", {
                date: format.dateTime(new Date(shown.researched_at), { dateStyle: "medium", timeStyle: "short" }),
              })}
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

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/** A collapsible section: click the title to show or hide its items. */
function ListSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <details className="group rounded-md border bg-white" data-testid="research-section">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-90" />
        <span className="flex-1">{title}</span>
        <span className="text-muted-foreground rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums">
          {items.length}
        </span>
      </summary>
      <div className="border-t px-3 py-2">
        <BulletList items={items} />
      </div>
    </details>
  );
}
