"use client";

import { useTranslations } from "next-intl";

import { FEASIBILITY_FACTORS, type FeasibilityRating, type IdeaResearchAnalysis } from "@/lib/api";

const RATING_CLASSES: Record<FeasibilityRating, string> = {
  favorable: "bg-green-100 text-green-800",
  moderate: "bg-amber-100 text-amber-800",
  challenging: "bg-red-100 text-red-800",
};

function barColor(score: number): string {
  if (score >= 70) return "bg-green-600";
  if (score >= 40) return "bg-amber-500";
  return "bg-red-600";
}

/**
 * Stage 1's "Degree of Feasibility". The percentage is computed by the
 * backend from fixed factor ratings (never a number the AI made up); this
 * shows it with the breakdown behind it.
 */
export function FeasibilityDegree({ research }: { research: IdeaResearchAnalysis | null }) {
  const t = useTranslations("Feasibility");
  const score = research?.feasibility_score;
  const factors = research?.feasibility_factors;

  return (
    <section aria-labelledby="feasibility-degree" className="flex flex-col gap-2 rounded-lg border p-4">
      <p id="feasibility-degree" className="text-base font-semibold">
        {t("label")}{" "}
        <span className="text-blue-700 tabular-nums" data-testid="feasibility-score">
          {score === undefined ? "—" : `${score}%`}
        </span>
      </p>

      {score !== undefined ? (
        <span
          role="progressbar"
          aria-label={t("label")}
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={100}
          className="bg-muted block h-2 w-full overflow-hidden rounded-full"
        >
          <span className={`block h-full rounded-full ${barColor(score)}`} style={{ width: `${score}%` }} />
        </span>
      ) : (
        <p className="text-muted-foreground text-sm">{research ? t("rerunToCalculate") : t("pending")}</p>
      )}

      {factors && (
        <details className="text-sm">
          <summary className="text-muted-foreground cursor-pointer select-none">{t("howCalculated")}</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {FEASIBILITY_FACTORS.map((name) => (
              <li key={name} className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t(`factors.${name}`)}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${RATING_CLASSES[factors[name].rating]}`}>
                    {t(`ratings.${factors[name].rating}`)}
                  </span>
                </span>
                <span className="text-muted-foreground">{factors[name].reason}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-2 text-xs">{t("method")}</p>
        </details>
      )}
    </section>
  );
}
