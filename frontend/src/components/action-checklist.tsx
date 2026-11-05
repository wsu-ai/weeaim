"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import type { ActionItem, ActionPriority } from "@/lib/api";

const PRIORITY_ORDER: Record<ActionPriority, number> = { high: 0, medium: 1, low: 2 };
const PRIORITY_CLASSES: Record<ActionPriority, string> = {
  high: "bg-red-50 text-red-800",
  medium: "bg-amber-50 text-amber-800",
  low: "bg-slate-100 text-slate-700",
};

export type ActionGroup<T extends ActionItem> = { key: string; title: string; items: T[] };

/**
 * The action items a stage ends with (Stages 7 and 8), as a checklist with
 * progress. Ticks are saved by the wizard page in the stage's answers.
 */
export function ActionChecklist<T extends ActionItem>({
  groups,
  completedActions,
  onToggle,
  readOnly,
  showTimeframe = false,
  meta,
  title,
  collapsible = false,
}: {
  groups: ActionGroup<T>[];
  /** IDs of the ticked items; IDs no longer in the list are ignored. */
  completedActions: string[];
  onToggle: (actionId: string, done: boolean) => void;
  /** An earlier saved run: shown, but can't be ticked. */
  readOnly: boolean;
  /** Show each item's timeframe (when groups aren't by timeframe). */
  showTimeframe?: boolean;
  /** Extra line under an item's title, e.g. the criterion it targets. */
  meta?: (item: T) => ReactNode;
  /** Heading; defaults to "Your action items". */
  title?: string;
  /** Each group as a collapsible section (closed until opened). */
  collapsible?: boolean;
}) {
  const t = useTranslations("ActionChecklist");
  const done = new Set(completedActions);
  const all = groups.flatMap((group) => group.items);
  const doneCount = all.filter((item) => done.has(item.id)).length;
  const total = all.length;
  const heading = title ?? t("title");

  return (
    <div className="rounded-md border bg-white p-4" data-testid="action-items">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-semibold">{heading}</h4>
        <span className="text-muted-foreground text-xs tabular-nums" data-testid="actions-progress">
          {t("progress", { done: doneCount, total })}
        </span>
      </div>
      <span
        role="progressbar"
        aria-label={heading}
        aria-valuenow={doneCount}
        aria-valuemin={0}
        aria-valuemax={total}
        className="bg-muted mb-4 block h-1.5 w-full overflow-hidden rounded-full"
      >
        <span
          className={`block h-full rounded-full ${doneCount === total && total > 0 ? "bg-green-600" : "bg-blue-600"}`}
          style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }}
        />
      </span>
      {readOnly && <p className="text-muted-foreground mb-3 text-xs">{t("readOnly")}</p>}

      <div className="flex flex-col gap-4">
        {groups.map((group) => {
          if (group.items.length === 0) return null;
          const items = [...group.items].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
          const groupDone = items.filter((item) => done.has(item.id)).length;
          const list = (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <ActionRow
                  key={item.id}
                  item={item}
                  done={done.has(item.id)}
                  disabled={readOnly}
                  showTimeframe={showTimeframe}
                  meta={meta?.(item)}
                  onToggle={(checked) => onToggle(item.id, checked)}
                />
              ))}
            </ul>
          );
          if (collapsible) {
            return (
              <details key={group.key} className="group rounded-md border bg-white" data-testid={`actions-${group.key}`}>
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-90" />
                  <span className="flex-1">{group.title}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
                      groupDone === items.length ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {t("progress", { done: groupDone, total: items.length })}
                  </span>
                </summary>
                <div className="border-t p-3">{list}</div>
              </details>
            );
          }
          return (
            <div key={group.key} data-testid={`actions-${group.key}`}>
              <h5 className="mb-2 text-sm font-semibold">{group.title}</h5>
              {list}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActionRow({
  item,
  done,
  disabled,
  showTimeframe,
  meta,
  onToggle,
}: {
  item: ActionItem;
  done: boolean;
  disabled: boolean;
  showTimeframe: boolean;
  meta?: ReactNode;
  onToggle: (checked: boolean) => void;
}) {
  const t = useTranslations("ActionChecklist");
  const inputId = `action-${item.id}`;
  return (
    <li className={`rounded-md border p-3 text-sm ${done ? "bg-green-50/60" : "bg-white"}`} data-testid={`action-${item.id}`}>
      <div className="flex items-start gap-2">
        <input
          id={inputId}
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-blue-600"
          checked={done}
          disabled={disabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={inputId} className={`font-medium ${done ? "text-muted-foreground line-through" : ""}`}>
              {item.title}
            </label>
            <span className={`rounded px-1.5 py-0.5 text-xs ${PRIORITY_CLASSES[item.priority]}`}>
              {t(`priorities.${item.priority}`)}
            </span>
            {showTimeframe && (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-800">
                {t(`timeframes.${item.timeframe}`)}
              </span>
            )}
          </div>
          {meta}
          <p className="text-muted-foreground text-xs">{item.why}</p>
          <ol className="list-decimal space-y-0.5 pl-5 text-xs">
            {item.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
          <p className="text-xs">
            <span className="font-semibold">{t("successMetric")}</span> {item.success_metric}
          </p>
        </div>
      </div>
    </li>
  );
}
