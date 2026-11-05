"use client";

import { useMutation } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { ChevronRight, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

  // The strengths or weaknesses popup that's open, if any.
  const [popup, setPopup] = useState<{ name: string; kind: "strengths" | "weaknesses"; items: string[] } | null>(null);

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
            <div className="flex flex-col gap-2">
              {CATEGORY_ORDER.map((category) => {
                const items = shown.alternatives.filter((alt) => alt.category === category);
                if (items.length === 0) return null;
                return (
                  <details key={category} className="group rounded-md border bg-white" data-testid={`category-${category}`}>
                    <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-90" />
                      <span className="flex-1">{t(`categories.${category}`)}</span>
                      <span className="text-muted-foreground rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums">
                        {items.length}
                      </span>
                    </summary>
                    <ul className="flex flex-col gap-2 border-t p-3">
                      {items.map((alt) => (
                        <li key={alt.name} className="rounded-md border bg-slate-50/50 p-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
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
                            <div className="flex gap-1">
                              <PointsButton
                                kind="strengths"
                                count={alt.strengths.length}
                                label={t("strengthsOf", { name: alt.name, count: alt.strengths.length })}
                                onClick={() => setPopup({ name: alt.name, kind: "strengths", items: alt.strengths })}
                              />
                              <PointsButton
                                kind="weaknesses"
                                count={alt.weaknesses.length}
                                label={t("weaknessesOf", { name: alt.name, count: alt.weaknesses.length })}
                                onClick={() => setPopup({ name: alt.name, kind: "weaknesses", items: alt.weaknesses })}
                              />
                            </div>
                          </div>
                          <p className="text-muted-foreground mt-1">{alt.description}</p>
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
                  </details>
                );
              })}
            </div>
          )}

          {popup && (
            <PointsDialog
              title={t(popup.kind === "strengths" ? "strengthsTitle" : "weaknessesTitle", { name: popup.name })}
              kind={popup.kind}
              items={popup.items}
              closeLabel={t("close")}
              onClose={() => setPopup(null)}
            />
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

/** An icon button that opens a competitor's strengths or weaknesses. */
function PointsButton({
  kind,
  count,
  label,
  onClick,
}: {
  kind: "strengths" | "weaknesses";
  count: number;
  label: string;
  onClick: () => void;
}) {
  const Icon = kind === "strengths" ? ThumbsUp : ThumbsDown;
  const colors =
    kind === "strengths"
      ? "border-green-200 bg-green-50 text-green-800 hover:bg-green-100"
      : "border-red-200 bg-red-50 text-red-800 hover:bg-red-100";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={count === 0}
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${colors}`}
    >
      <Icon aria-hidden className="size-3.5" />
      {count}
    </button>
  );
}

/** A small popup listing one competitor's strengths or weaknesses. */
function PointsDialog({
  title,
  kind,
  items,
  closeLabel,
  onClose,
}: {
  title: string;
  kind: "strengths" | "weaknesses";
  items: string[];
  closeLabel: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const Icon = kind === "strengths" ? ThumbsUp : ThumbsDown;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(); // click outside closes
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="points-dialog-title"
        className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h4 id="points-dialog-title" className="flex items-center gap-2 font-semibold">
            <Icon aria-hidden className={`size-4 ${kind === "strengths" ? "text-green-700" : "text-red-700"}`} />
            {title}
          </h4>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
