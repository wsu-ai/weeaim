"use client";

import { useFormatter, useTranslations } from "next-intl";

import type { ResearchRun } from "@/lib/api";

function feasibilityOf(run: ResearchRun): number | null {
  const score = run.research && "feasibility_score" in run.research ? run.research.feasibility_score : undefined;
  return typeof score === "number" ? score : null;
}

const EXTERNAL_LINK = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;

/**
 * Stage 1's right-hand column: the sources behind the research being viewed,
 * and every earlier research run (saved, so it's there in later sessions).
 */
export function ResearchSidebar({
  research,
  runs,
  viewingRunId,
  onSelectRun,
}: {
  research: { sources: { title: string; url: string }[] } | null;
  runs: ResearchRun[];
  viewingRunId: string | null;
  onSelectRun: (runId: string | null) => void;
}) {
  const t = useTranslations("ResearchSidebar");
  const format = useFormatter();
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="research-sources" className="rounded-lg border p-4">
        <h3 id="research-sources" className="mb-2 font-semibold">
          {t("sourcesTitle")}
        </h3>
        {research && research.sources.length > 0 ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {research.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} {...EXTERNAL_LINK} className="break-words text-blue-700 hover:underline">
                  {source.title}
                </a>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground text-sm">{research ? t("noSources") : t("sourcesPending")}</p>
        )}
      </section>

      <section aria-labelledby="research-history" className="rounded-lg border p-4">
        <h3 id="research-history" className="mb-1 font-semibold">
          {t("historyTitle")}
        </h3>
        <p className="text-muted-foreground mb-2 text-xs">{t("historyDescription")}</p>
        {runs.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noHistory")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {runs.map((run, index) => {
              const isLatest = index === 0;
              const isViewing = viewingRunId ? run.id === viewingRunId : isLatest;
              return (
                <li key={run.id}>
                  <button
                    type="button"
                    aria-pressed={isViewing}
                    onClick={() => onSelectRun(isLatest ? null : run.id)}
                    className={
                      "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm " +
                      (isViewing ? "bg-blue-50 font-medium text-blue-800" : "hover:bg-muted")
                    }
                  >
                    <span>
                      {when(run.created_at)}
                      {isLatest && <span className="text-muted-foreground ml-1 text-xs">({t("latest")})</span>}
                    </span>
                    {feasibilityOf(run) !== null && (
                      <span className="tabular-nums text-xs">{feasibilityOf(run)}%</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
