"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  analyzeStage,
  listStages,
  updateStage,
  type StageField,
  type WizardStageStatus,
} from "@/lib/api";

const STATUS_BADGE_CLASSES: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  awaiting_user: "bg-amber-100 text-amber-800",
  needs_revision: "bg-red-100 text-red-800",
};

function fieldToFormValue(field: StageField, answers: Record<string, unknown> | null): string {
  const value = answers?.[field.name];
  if (field.type === "list") {
    return Array.isArray(value) ? value.join("\n") : "";
  }
  return typeof value === "string" ? value : "";
}

function formValueToAnswer(field: StageField, raw: string): unknown {
  if (field.type === "list") {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return raw;
}

export default function VentureWizardPage() {
  const t = useTranslations("Wizard");
  const locale = useLocale();
  const params = useParams<{ ventureId: string }>();
  const ventureId = params.ventureId;
  const queryClient = useQueryClient();

  const stagesQuery = useQuery({
    queryKey: ["stages", ventureId],
    queryFn: () => listStages(ventureId),
  });

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const stages = stagesQuery.data ?? [];
  const selectedStage = stages.find((s) => s.slug === selectedSlug) ?? null;
  const fields = selectedStage?.question_schema?.fields ?? [];

  function selectStage(stage: WizardStageStatus) {
    if (!stage.implemented) return;
    setSelectedSlug(stage.slug);
    const stageFields = stage.question_schema?.fields ?? [];
    const initial: Record<string, string> = {};
    for (const field of stageFields) {
      initial[field.name] = fieldToFormValue(field, stage.answers);
    }
    setFormValues(initial);
  }

  const saveMutation = useMutation({
    mutationFn: (complete: boolean) => {
      if (!selectedStage) throw new Error("No stage selected");
      const answers: Record<string, unknown> = {};
      for (const field of fields) {
        answers[field.name] = formValueToAnswer(field, formValues[field.name] ?? "");
      }
      return updateStage(ventureId, selectedStage.slug, { answers, complete });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: () => {
      if (!selectedStage) throw new Error("No stage selected");
      return analyzeStage(ventureId, selectedStage.slug);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stages", ventureId] });
    },
  });

  const statusLabels: Record<string, string> = {
    not_started: t("statusNotStarted"),
    in_progress: t("statusInProgress"),
    completed: t("statusCompleted"),
    awaiting_user: t("statusAwaitingUser"),
    needs_revision: t("statusNeedsRevision"),
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 gap-6 p-6">
      <aside className="w-64 shrink-0">
        <h1 className="mb-4 text-lg font-semibold">{t("pageTitle")}</h1>
        {stagesQuery.isError && (
          <p className="text-destructive text-sm" role="alert">
            {t("errorLoadFailed")}
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {stages.map((stage) => (
            <li key={stage.slug}>
              <button
                type="button"
                disabled={!stage.implemented}
                onClick={() => selectStage(stage)}
                aria-current={stage.slug === selectedSlug}
                className="flex w-full flex-col items-start gap-1 rounded-md p-2 text-left text-sm disabled:opacity-50 enabled:hover:bg-muted"
              >
                <span>{locale === "ko" ? stage.title_ko : stage.title_en}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE_CLASSES[stage.status] ?? ""}`}
                >
                  {stage.implemented ? statusLabels[stage.status] : t("comingSoon")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex-1">
        {!selectedStage ? (
          <p className="text-muted-foreground">{t("noStageSelected")}</p>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>
                {locale === "ko" ? selectedStage.title_ko : selectedStage.title_en}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {selectedStage.status === "needs_revision" && (
                <p className="rounded-md bg-red-50 p-2 text-sm text-red-800" role="alert">
                  {t("revisionBanner")}
                </p>
              )}

              <div className="flex flex-col gap-3">
                {fields.map((field) => (
                  <div key={field.name} className="flex flex-col gap-1">
                    <label htmlFor={field.name} className="text-sm font-medium">
                      {locale === "ko" ? field.label_ko : field.label_en}
                    </label>
                    <Textarea
                      id={field.name}
                      rows={field.type === "list" ? 4 : 3}
                      value={formValues[field.name] ?? ""}
                      onChange={(e) =>
                        setFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                      }
                      onBlur={() => saveMutation.mutate(false)}
                    />
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  onClick={() => saveMutation.mutate(true)}
                  disabled={saveMutation.isPending}
                >
                  {t("markComplete")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => analyzeMutation.mutate()}
                  disabled={analyzeMutation.isPending}
                >
                  {analyzeMutation.isPending ? t("analyzing") : t("getFeedback")}
                </Button>
                {saveMutation.isPending && (
                  <span className="text-muted-foreground text-sm">{t("saving")}</span>
                )}
                {!saveMutation.isPending && saveMutation.isSuccess && (
                  <span className="text-muted-foreground text-sm">{t("saved")}</span>
                )}
              </div>

              {saveMutation.isError && (
                <p className="text-destructive text-sm" role="alert">
                  {t("errorSaveFailed")}
                </p>
              )}
              {analyzeMutation.isError && (
                <p className="text-destructive text-sm" role="alert">
                  {t("errorAnalyzeFailed")}
                </p>
              )}

              {selectedStage.ai_analysis && (
                <div className="flex flex-col gap-2 border-t pt-4">
                  <h3 className="font-semibold">{t("feedbackTitle")}</h3>
                  <p className="text-sm">{selectedStage.ai_analysis.summary}</p>

                  <h4 className="text-sm font-medium">{t("feedbackStrengths")}</h4>
                  <ul className="list-disc pl-5 text-sm">
                    {selectedStage.ai_analysis.strengths.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>

                  <h4 className="text-sm font-medium">{t("feedbackGaps")}</h4>
                  <ul className="list-disc pl-5 text-sm">
                    {selectedStage.ai_analysis.gaps.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>

                  <h4 className="text-sm font-medium">{t("feedbackNextSteps")}</h4>
                  <ul className="list-disc pl-5 text-sm">
                    {selectedStage.ai_analysis.suggested_next_steps.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}
