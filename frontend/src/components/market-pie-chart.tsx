"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import type { MarketScopeResult } from "@/lib/api";

// Categorical slots 1-3 of the validated chart palette (blue, orange, aqua):
// all-pairs CVD-safe on the light surface. Aqua is under 3:1 contrast, so
// every slice is also named, valued and percentaged in the legend.
const SLICE_COLORS = {
  som: "#2a78d6",
  samRest: "#eb6834",
  tamRest: "#1baf7a",
} as const;
const SURFACE = "#ffffff";

type SliceKey = keyof typeof SLICE_COLORS;

const SIZE = 180;
const RADIUS = 84;
const CENTER = SIZE / 2;
const MIN_SWEEP = (4 * Math.PI) / 180;

function point(angle: number): [number, number] {
  // Angles start at 12 o'clock and run clockwise.
  return [CENTER + RADIUS * Math.sin(angle), CENTER - RADIUS * Math.cos(angle)];
}

function slicePath(start: number, end: number): string {
  const [x1, y1] = point(start);
  const [x2, y2] = point(end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M ${CENTER} ${CENTER} L ${x1} ${y1} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

/**
 * One market's TAM split into its three non-overlapping parts: SOM, the rest
 * of SAM, and the rest of TAM. The whole pie is the TAM.
 */
export function MarketPieChart({ scope }: { scope: MarketScopeResult }) {
  const t = useTranslations("MarketEvidence");
  const format = useFormatter();
  const [hovered, setHovered] = useState<SliceKey | null>(null);
  const { currency, tam, sam, som } = scope.market_sizes;

  const money = (value: number) =>
    format.number(value, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 });
  const percent = (value: number) =>
    format.number(tam > 0 ? value / tam : 0, { style: "percent", maximumFractionDigits: 1 });

  const slices: { key: SliceKey; value: number }[] = [
    { key: "som", value: Math.max(som, 0) },
    { key: "samRest", value: Math.max(sam - som, 0) },
    { key: "tamRest", value: Math.max(tam - sam, 0) },
  ];

  if (tam <= 0) {
    return <p className="text-muted-foreground text-xs">{t("pie.empty")}</p>;
  }

  // A tiny SOM (often under 1%) would vanish behind the 2px gap, so every
  // non-empty slice gets at least MIN_SWEEP; the larger slices give up the
  // difference. The legend always shows the true values.
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const raw = slices.map((slice) => (total > 0 ? (slice.value / total) * Math.PI * 2 : 0));
  const bumped = raw.map((sweep) => (sweep > 0 && sweep < MIN_SWEEP ? MIN_SWEEP : sweep));
  const extra = bumped.reduce((sum, sweep) => sum + sweep, 0) - Math.PI * 2;
  const large = raw.reduce((sum, sweep) => (sweep >= MIN_SWEEP ? sum + sweep : sum), 0);
  const sweeps = bumped.map((sweep, i) =>
    raw[i] >= MIN_SWEEP && large > 0 ? sweep - (extra * raw[i]) / large : sweep,
  );

  let angle = 0;
  const arcs = slices.map((slice, i) => {
    const sweep = sweeps[i];
    const arc = { ...slice, start: angle, end: angle + sweep };
    angle += sweep;
    return arc;
  });
  const label = (key: SliceKey) => t(`pie.slices.${key}`);
  const describe = (key: SliceKey, value: number) => `${label(key)}: ${money(value)} (${percent(value)})`;

  return (
    <figure className="flex flex-col items-center gap-4 sm:flex-row sm:items-center" data-testid={`market-pie-${scope.scope}`}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-44 w-44 shrink-0"
        role="img"
        aria-label={t("pie.label", {
          area: scope.area_name || t("scopes.legacy"),
          tam: money(tam),
        })}
      >
        {arcs.map((arc) => {
          if (arc.value <= 0) return null;
          const shared = {
            fill: SLICE_COLORS[arc.key],
            stroke: SURFACE,
            strokeWidth: 2, // the 2px surface gap between fills
            opacity: hovered && hovered !== arc.key ? 0.45 : 1,
            onMouseEnter: () => setHovered(arc.key),
            onMouseLeave: () => setHovered(null),
            className: "transition-opacity",
          };
          const whole = arc.end - arc.start >= Math.PI * 2 - 1e-9;
          return whole ? (
            <circle key={arc.key} cx={CENTER} cy={CENTER} r={RADIUS} {...shared}>
              <title>{describe(arc.key, arc.value)}</title>
            </circle>
          ) : (
            <path key={arc.key} d={slicePath(arc.start, arc.end)} data-slice={arc.key} {...shared}>
              <title>{describe(arc.key, arc.value)}</title>
            </path>
          );
        })}
      </svg>

      <figcaption className="flex w-full flex-col gap-2 text-xs">
        <p className="text-sm font-semibold">
          {t("pie.title", { tam: money(tam) })}
        </p>
        <ul className="flex flex-col gap-1.5">
          {slices.map((slice) => (
            <li
              key={slice.key}
              className={`flex items-center gap-2 rounded px-1 ${hovered === slice.key ? "bg-slate-100" : ""}`}
              onMouseEnter={() => setHovered(slice.key)}
              onMouseLeave={() => setHovered(null)}
            >
              <span aria-hidden className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: SLICE_COLORS[slice.key] }} />
              <span className="flex-1">{label(slice.key)}</span>
              <span className="font-semibold tabular-nums">{money(slice.value)}</span>
              <span className="text-muted-foreground w-12 text-right tabular-nums">{percent(slice.value)}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">{t("pie.note")}</p>
      </figcaption>
    </figure>
  );
}
