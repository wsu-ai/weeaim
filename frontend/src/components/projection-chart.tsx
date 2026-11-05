"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

// Categorical slots 1-2 of the validated chart palette (blue, orange) on the
// light surface; text always uses text tokens, never the series colour.
export const SERIES_COLORS = ["#2a78d6", "#eb6834"] as const;
const GRID = "#e7e5e4";
const AXIS_TEXT = "#52514e";
const ZERO_LINE = "#a8a29e";
const MARKER = "#b91c1c";

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 16, right: 92, bottom: 26, left: 64 };

export type ChartSeries = { key: string; label: string; values: number[] };

function niceStep(span: number, ticks = 4): number {
  if (span <= 0) return 1;
  const raw = span / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

/** Clean y-axis ticks that include 0 and cover the whole data range. */
export function yTicks(min: number, max: number): number[] {
  const low = Math.min(0, min);
  const high = Math.max(0, max);
  const step = niceStep(high - low || 1);
  const first = Math.floor(low / step);
  const last = Math.max(Math.ceil(high / step), first + 1);
  return Array.from({ length: last - first + 1 }, (_, i) => {
    const v = (first + i) * step;
    return Math.abs(v) < step / 1e6 ? 0 : v;
  });
}

/**
 * A monthly line chart: 2px lines, hairline grid, a zero line, direct end
 * labels plus a legend for two series, and a crosshair that snaps to the
 * nearest month with one tooltip listing every series (also by keyboard).
 */
export function ProjectionChart({
  series,
  label,
  formatValue,
  formatTick,
  monthLabel,
  marker,
}: {
  series: ChartSeries[];
  /** Accessible description of the whole chart. */
  label: string;
  formatValue: (value: number) => string;
  formatTick: (value: number) => string;
  monthLabel: (month: number) => string;
  /** An annotated month, e.g. when the cash runs out. */
  marker?: { month: number; label: string };
}) {
  const id = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const count = Math.max(...series.map((s) => s.values.length), 1);
  const all = series.flatMap((s) => s.values);
  const ticks = yTicks(Math.min(...all, 0), Math.max(...all, 0));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1] === yMin ? yMin + 1 : ticks[ticks.length - 1];

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (count === 1 ? plotW / 2 : (index / (count - 1)) * plotW);
  const y = (value: number) => PAD.top + plotH - ((value - yMin) / (yMax - yMin)) * plotH;
  const path = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  // End labels only when they won't collide; otherwise legend + tooltip carry them.
  const ends = series.map((s) => y(s.values[s.values.length - 1] ?? 0));
  const endLabels = ends.length < 2 || Math.abs(ends[0] - ends[1]) >= 14;

  function monthAt(clientX: number): number {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const svgX = ((clientX - rect.left) / rect.width) * WIDTH;
    const ratio = (svgX - PAD.left) / plotW;
    return Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))));
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === "ArrowRight") setActive((a) => Math.min(count - 1, (a ?? -1) + 1));
    else if (event.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? count) - 1));
    else if (event.key === "Escape") setActive(null);
    else return;
    event.preventDefault();
  }

  const tooltipLeft = active === null ? 0 : (x(active) / WIDTH) * 100;

  return (
    <figure className="relative" data-testid={`chart-${series.map((s) => s.key).join("-")}`}>
      {series.length > 1 && (
        <figcaption className="mb-1 flex flex-wrap gap-4 text-xs" style={{ color: AXIS_TEXT }}>
          {series.map((s, i) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-0.5 w-4 rounded" style={{ backgroundColor: SERIES_COLORS[i] }} />
              {s.label}
            </span>
          ))}
        </figcaption>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        role="img"
        aria-label={label}
        aria-describedby={active !== null ? `${id}-tip` : undefined}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerMove={(e: PointerEvent) => setActive(monthAt(e.clientX))}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke={tick === 0 ? ZERO_LINE : GRID}
              strokeWidth={1}
            />
            <text x={PAD.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
              {formatTick(tick)}
            </text>
          </g>
        ))}
        {[1, 12, 24, 36].filter((m) => m <= count).map((m) => (
          <text key={m} x={x(m - 1)} y={HEIGHT - 8} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>
            {m}
          </text>
        ))}

        {marker && marker.month >= 1 && marker.month <= count && (
          <g data-testid="chart-marker">
            <line x1={x(marker.month - 1)} x2={x(marker.month - 1)} y1={PAD.top} y2={PAD.top + plotH} stroke={MARKER} strokeWidth={1} />
            <text x={x(marker.month - 1) + 4} y={PAD.top + 10} fontSize={10} fill="#0b0b0b">
              {marker.label}
            </text>
          </g>
        )}

        {series.map((s, i) => (
          <path
            key={s.key}
            d={path(s.values)}
            fill="none"
            stroke={SERIES_COLORS[i]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {series.map((s, i) => {
          const last = s.values.length - 1;
          return (
            <g key={`${s.key}-end`}>
              <circle cx={x(last)} cy={y(s.values[last] ?? 0)} r={4} fill={SERIES_COLORS[i]} stroke="#ffffff" strokeWidth={2} />
              {endLabels && (
                <text x={x(last) + 8} y={ends[i]} dy="0.32em" fontSize={10} fill="#0b0b0b">
                  {formatTick(s.values[last] ?? 0)}
                </text>
              )}
            </g>
          );
        })}

        {active !== null && (
          <g pointerEvents="none">
            <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH} stroke={AXIS_TEXT} strokeWidth={1} />
            {series.map((s, i) => (
              <circle
                key={s.key}
                cx={x(active)}
                cy={y(s.values[active] ?? 0)}
                r={4}
                fill={SERIES_COLORS[i]}
                stroke="#ffffff"
                strokeWidth={2}
              />
            ))}
          </g>
        )}
      </svg>
      {active !== null && (
        <div
          id={`${id}-tip`}
          role="status"
          className="pointer-events-none absolute top-6 z-10 -translate-x-1/2 rounded-md border bg-white px-2 py-1 text-xs whitespace-nowrap shadow"
          style={{ left: `${Math.min(85, Math.max(15, tooltipLeft))}%` }}
          data-testid="chart-tooltip"
        >
          <p className="font-semibold">{monthLabel(active + 1)}</p>
          {series.map((s, i) => (
            <p key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block size-2 rounded-full" style={{ backgroundColor: SERIES_COLORS[i] }} />
              {s.label}: <span className="font-medium tabular-nums">{formatValue(s.values[active] ?? 0)}</span>
            </p>
          ))}
        </div>
      )}
    </figure>
  );
}
