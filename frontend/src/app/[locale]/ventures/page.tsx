"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ChevronDown, ChevronRight, Download, RotateCcw, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { ConfirmVentureAction } from "@/components/confirm-venture-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import {
  archiveVenture,
  deleteVenture,
  downloadVentureArchive,
  listArchivedVentures,
  listVentures,
  restoreVenture,
  type ArchivedVenture,
  type VentureSummary,
} from "@/lib/api";

const VENTURES_KEY = ["ventures"];
const ARCHIVED_KEY = ["ventures", "archived"];

/**
 * "My ventures": everything this organization has worked on, with saved
 * progress and research -- where a returning user picks up where they left off.
 * Removing a venture archives it (restorable); archived ventures are listed
 * below, where they can be restored, downloaded or deleted for good.
 */
export default function MyVenturesPage() {
  const t = useTranslations("Ventures");
  const venturesQuery = useQuery({ queryKey: VENTURES_KEY, queryFn: listVentures });
  const ventures = venturesQuery.data ?? [];
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
        <Link
          href="/ventures/new"
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t("newIdea")}
        </Link>
      </div>

      {notice && (
        <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
          {notice}
        </p>
      )}

      {venturesQuery.isPending && <p className="text-muted-foreground text-sm">{t("loading")}</p>}
      {venturesQuery.isError && (
        <p className="text-destructive text-sm" role="alert">
          {t("loadFailed")}
        </p>
      )}

      {venturesQuery.isSuccess && ventures.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-6">
            <p>{t("empty")}</p>
            <Link href="/ventures/new" className="font-medium text-blue-700 hover:underline">
              {t("startFirst")}
            </Link>
          </CardContent>
        </Card>
      )}

      <ul className="grid gap-4 md:grid-cols-2">
        {ventures.map((venture) => (
          <li key={venture.id}>
            <VentureCard venture={venture} onArchived={() => setNotice(t("archived", { title: venture.title }))} />
          </li>
        ))}
      </ul>

      <ArchivedVentures onNotice={setNotice} />
    </main>
  );
}

function VentureCard({ venture, onArchived }: { venture: VentureSummary; onArchived: () => void }) {
  const t = useTranslations("Ventures");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const progress = Math.round((venture.completed_stages / Math.max(venture.total_stages, 1)) * 100);

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="font-bold">
            <Link href={`/ventures/${venture.id}`} className="hover:text-blue-700 hover:underline">
              {venture.title}
            </Link>
          </CardTitle>
          {venture.can_delete && !confirming && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("deleteVenture", { title: venture.title })}
              title={t("deleteVenture", { title: venture.title })}
              onClick={() => setConfirming(true)}
              className="text-muted-foreground shrink-0 hover:text-red-700"
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {confirming ? (
          <ConfirmVentureAction
            ventureId={venture.id}
            title={venture.title}
            mode="archive"
            action={(reauth) => archiveVenture(venture.id, reauth)}
            onCancel={() => setConfirming(false)}
            onDone={() => {
              onArchived();
              queryClient.setQueryData<VentureSummary[]>(VENTURES_KEY, (old) =>
                old?.filter((v) => v.id !== venture.id),
              );
              queryClient.invalidateQueries({ queryKey: VENTURES_KEY });
            }}
          />
        ) : (
          <>
            <p className="text-muted-foreground line-clamp-2">
              {venture.current_idea_statement || venture.original_idea}
            </p>
            <div className="flex flex-col gap-1">
              <span className="flex justify-between text-xs">
                <span>{t("stagesCompleted", { done: venture.completed_stages, total: venture.total_stages })}</span>
                <span className="tabular-nums">{progress}%</span>
              </span>
              <span
                role="progressbar"
                aria-label={t("progressLabel", { title: venture.title })}
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                className="bg-muted block h-1.5 overflow-hidden rounded-full"
              >
                <span className="block h-full rounded-full bg-blue-600" style={{ width: `${progress}%` }} />
              </span>
            </div>
            <p className="text-xs">
              {venture.feasibility_score !== null
                ? t("feasibility", { score: venture.feasibility_score })
                : venture.researched_at
                  ? t("researchedNoScore")
                  : t("notResearched")}
            </p>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-xs">
                {t("lastUpdated", {
                  date: format.dateTime(new Date(venture.updated_at), { dateStyle: "medium", timeStyle: "short" }),
                })}
              </span>
              <Link href={`/ventures/${venture.id}`} className="text-sm font-medium text-blue-700 hover:underline">
                {t("continue")}
              </Link>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Archived ventures (collapsed): restore, download as one file, or delete for good. */
function ArchivedVentures({ onNotice }: { onNotice: (message: string) => void }) {
  const t = useTranslations("Ventures");
  const archivedQuery = useQuery({ queryKey: ARCHIVED_KEY, queryFn: listArchivedVentures });
  const archived = archivedQuery.data ?? [];
  const [open, setOpen] = useState(false);

  if (archived.length === 0) return null;
  return (
    <section aria-labelledby="archived-title" className="flex flex-col gap-3 border-t pt-4" data-testid="archived-ventures">
      <h2 id="archived-title">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-2 text-lg font-semibold hover:text-blue-700"
        >
          {open ? <ChevronDown aria-hidden className="size-5" /> : <ChevronRight aria-hidden className="size-5" />}
          <Archive aria-hidden className="size-5 text-slate-500" />
          {t("archivedTitle", { count: archived.length })}
        </button>
      </h2>
      {open && (
        <>
          <p className="text-muted-foreground text-sm">{t("archivedDescription")}</p>
          <ul className="flex flex-col gap-3">
            {archived.map((venture) => (
              <li key={venture.id}>
                <ArchivedRow venture={venture} onNotice={onNotice} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ArchivedRow({ venture, onNotice }: { venture: ArchivedVenture; onNotice: (message: string) => void }) {
  const t = useTranslations("Ventures");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: VENTURES_KEY });
  };
  const restoreMutation = useMutation({
    mutationFn: () => restoreVenture(venture.id),
    onSuccess: () => {
      onNotice(t("restored", { title: venture.title }));
      refresh();
    },
  });
  const downloadMutation = useMutation({
    mutationFn: () => downloadVentureArchive(venture.id),
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
  });

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-semibold">{venture.title}</p>
            <p className="text-muted-foreground text-xs">
              {t("archivedOn", {
                date: format.dateTime(new Date(venture.archived_at), { dateStyle: "medium", timeStyle: "short" }),
              })}
              {" · "}
              {t("stagesCompleted", { done: venture.completed_stages, total: venture.total_stages })}
            </p>
          </div>
          {!deleting && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={restoreMutation.isPending} onClick={() => restoreMutation.mutate()}>
                <RotateCcw aria-hidden />
                {t("restore")}
              </Button>
              <Button size="sm" variant="outline" disabled={downloadMutation.isPending} onClick={() => downloadMutation.mutate()}>
                <Download aria-hidden />
                {t("downloadArchive")}
              </Button>
              <Button size="sm" variant="ghost" className="text-red-700 hover:text-red-800" onClick={() => setDeleting(true)}>
                <Trash2 aria-hidden />
                {t("deletePermanently")}
              </Button>
            </div>
          )}
        </div>
        {(restoreMutation.isError || downloadMutation.isError) && (
          <p role="alert" className="text-destructive">
            {t("actionFailed")}
          </p>
        )}
        {deleting && (
          <ConfirmVentureAction
            ventureId={venture.id}
            title={venture.title}
            mode="delete"
            action={(reauth) => deleteVenture(venture.id, reauth)}
            onCancel={() => setDeleting(false)}
            onDone={() => {
              onNotice(t("deleted", { title: venture.title }));
              queryClient.setQueryData<ArchivedVenture[]>(ARCHIVED_KEY, (old) =>
                old?.filter((v) => v.id !== venture.id),
              );
              refresh();
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}
