"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { deleteVenture, listVentures, type VentureSummary } from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";

const VENTURES_KEY = ["ventures"];

/**
 * "My ventures": everything this organization has worked on, with saved
 * progress and research -- where a returning user picks up where they left off.
 */
export default function MyVenturesPage() {
  const t = useTranslations("Ventures");
  const venturesQuery = useQuery({ queryKey: VENTURES_KEY, queryFn: listVentures });
  const ventures = venturesQuery.data ?? [];
  const [deletedTitle, setDeletedTitle] = useState<string | null>(null);
  // Deleting is offered when several ideas are being worked on.
  const allowDelete = ventures.length > 1;

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

      {deletedTitle && (
        <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
          {t("deleted", { title: deletedTitle })}
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
            <VentureCard
              venture={venture}
              canDelete={allowDelete && venture.can_delete}
              onDeleted={() => setDeletedTitle(venture.title)}
            />
          </li>
        ))}
      </ul>
    </main>
  );
}

function VentureCard({
  venture,
  canDelete,
  onDeleted,
}: {
  venture: VentureSummary;
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const t = useTranslations("Ventures");
  const tLogin = useTranslations("Login");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [typedTitle, setTypedTitle] = useState("");

  const deleteMutation = useMutation({
    mutationFn: () => deleteVenture(venture.id),
    onSuccess: () => {
      onDeleted();
      queryClient.setQueryData<VentureSummary[]>(VENTURES_KEY, (old) =>
        old?.filter((v) => v.id !== venture.id),
      );
      queryClient.invalidateQueries({ queryKey: VENTURES_KEY });
    },
  });

  const progress = Math.round((venture.completed_stages / Math.max(venture.total_stages, 1)) * 100);
  const titleMatches = typedTitle.trim() === venture.title.trim();
  const inputId = `confirm-delete-${venture.id}`;

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="font-bold">
            <Link href={`/ventures/${venture.id}`} className="hover:text-blue-700 hover:underline">
              {venture.title}
            </Link>
          </CardTitle>
          {canDelete && !confirming && (
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
          <div role="group" aria-labelledby={`${inputId}-label`} className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3">
            <p id={`${inputId}-label`} className="font-medium text-red-900">
              {t("confirmTitle", { title: venture.title })}
            </p>
            <p className="text-red-900">{t("confirmBody")}</p>
            <label htmlFor={inputId} className="text-red-900">
              {t("typeTitle")}
            </label>
            <Input id={inputId} value={typedTitle} onChange={(e) => setTypedTitle(e.target.value)} autoComplete="off" />
            {deleteMutation.isError && (
              <p role="alert" className="text-destructive">
                {authErrorMessage(deleteMutation.error, tLogin, { byStatus: { 403: t("notAllowed") } })}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="destructive"
                disabled={!titleMatches || deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
              >
                {deleteMutation.isPending ? t("deleting") : t("confirmDelete")}
              </Button>
              <Button
                variant="ghost"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  setConfirming(false);
                  setTypedTitle("");
                }}
              >
                {t("cancel")}
              </Button>
            </div>
          </div>
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
