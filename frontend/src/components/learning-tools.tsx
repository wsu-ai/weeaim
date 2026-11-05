"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenCheck, CheckCircle2, GraduationCap, RefreshCw, X, XCircle } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  generateLearning,
  getLearning,
  type LearningKind,
  type ProfessorNotesContent,
  type StudyGuideContent,
} from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";
import { useTokenLimitMessage } from "@/lib/token-limit";

const TOOLS: { kind: LearningKind; icon: typeof GraduationCap; colors: string }[] = [
  { kind: "professor_notes", icon: GraduationCap, colors: "bg-indigo-100 text-indigo-700" },
  { kind: "study_guide", icon: BookOpenCheck, colors: "bg-emerald-100 text-emerald-700" },
];

/**
 * Professor Notes and Study Guide for the current stage: two icons at the
 * top of the right-hand column, each opening the material in a side panel.
 * It's written by the AI the first time and saved, so reopening is instant.
 */
export function LearningTools({
  ventureId,
  stageSlug,
  stageTitle,
  language,
}: {
  ventureId: string;
  stageSlug: string;
  stageTitle: string;
  language: "en" | "ko";
}) {
  const t = useTranslations("Learning");
  const [open, setOpen] = useState<LearningKind | null>(null);

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-white p-3" data-testid="learning-tools">
      <p className="text-muted-foreground text-xs font-medium">{t("heading")}</p>
      <div className="grid grid-cols-2 gap-2">
        {TOOLS.map(({ kind, icon: Icon, colors }) => (
          <button
            key={kind}
            type="button"
            onClick={() => setOpen(kind)}
            title={t(`${kind}.hint`)}
            className="flex flex-col items-center gap-1.5 rounded-lg border p-2 text-center text-xs font-medium hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            data-testid={`learning-${kind}`}
          >
            <span className={`flex size-11 items-center justify-center rounded-full ${colors}`}>
              <Icon aria-hidden className="size-6" />
            </span>
            {t(`${kind}.title`)}
          </button>
        ))}
      </div>
      {open && (
        <LearningPanel
          key={open}
          ventureId={ventureId}
          stageSlug={stageSlug}
          stageTitle={stageTitle}
          kind={open}
          language={language}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function LearningPanel({
  ventureId,
  stageSlug,
  stageTitle,
  kind,
  language,
  onClose,
}: {
  ventureId: string;
  stageSlug: string;
  stageTitle: string;
  kind: LearningKind;
  language: "en" | "ko";
  onClose: () => void;
}) {
  const t = useTranslations("Learning");
  const tLogin = useTranslations("Login");
  const format = useFormatter();
  const tokenLimitMessage = useTokenLimitMessage();
  const queryClient = useQueryClient();
  const queryKey = ["learning", ventureId, stageSlug, kind, language];
  const closeRef = useRef<HTMLButtonElement>(null);

  const saved = useQuery({ queryKey, queryFn: () => getLearning(ventureId, stageSlug, kind, language) });
  const write = useMutation({
    mutationFn: () => generateLearning(ventureId, stageSlug, kind, language),
    onSuccess: (content) => queryClient.setQueryData(queryKey, content),
  });

  // Written the first time it's opened (that's what the button is for).
  const started = useRef(false);
  useEffect(() => {
    if (saved.isSuccess && saved.data === null && !started.current) {
      started.current = true;
      write.mutate();
    }
  }, [saved.isSuccess, saved.data, write]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const content = saved.data ?? null;
  const Icon = kind === "professor_notes" ? GraduationCap : BookOpenCheck;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="learning-title"
        className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl"
        data-testid="learning-panel"
      >
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div>
            <h2 id="learning-title" className="flex items-center gap-2 text-lg font-semibold">
              <Icon aria-hidden className="size-5 text-indigo-700" />
              {t(`${kind}.title`)}
            </h2>
            <p className="text-muted-foreground text-sm">{stageTitle}</p>
          </div>
          <div className="flex items-center gap-1">
            {content && (
              <Button size="sm" variant="outline" disabled={write.isPending} onClick={() => write.mutate()}>
                <RefreshCw aria-hidden className="size-4" />
                {t("regenerate")}
              </Button>
            )}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label={t("close")}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {(saved.isPending || write.isPending) && (
            <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
              <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
              {t("writing")}
            </p>
          )}
          {(write.isError || saved.isError) && (
            <p role="alert" className="mb-3 text-sm text-red-800">
              {tokenLimitMessage(write.error) ?? authErrorMessage(write.error ?? saved.error, tLogin, { byStatus: { 503: t("failed") } })}
            </p>
          )}
          {content && !write.isPending && (
            <>
              {content.kind === "professor_notes" ? <Notes notes={content} /> : <Guide guide={content} />}
              <p className="text-muted-foreground mt-6 border-t pt-3 text-xs">
                {t("disclaimer", {
                  date: format.dateTime(new Date(content.generated_at), { dateStyle: "medium", timeStyle: "short" }),
                })}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-sm font-semibold text-indigo-900">{title}</h3>
      {children}
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function Notes({ notes }: { notes: ProfessorNotesContent }) {
  const t = useTranslations("Learning.notes");
  return (
    <div data-testid="professor-notes">
      <p className="mb-5 text-sm leading-relaxed">{notes.overview}</p>
      <Block title={t("objectives")}>
        <Bullets items={notes.learning_objectives} />
      </Block>
      <Block title={t("concepts")}>
        <div className="flex flex-col gap-2">
          {notes.core_concepts.map((c, i) => (
            <div key={i} className="rounded-md border p-3 text-sm">
              <p className="font-semibold">{c.name}</p>
              <p>{c.explanation}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                <span className="font-medium">{t("whyItMatters")}</span> {c.why_it_matters}
              </p>
            </div>
          ))}
        </div>
      </Block>
      {notes.frameworks.length > 0 && (
        <Block title={t("frameworks")}>
          <ul className="space-y-1 text-sm">
            {notes.frameworks.map((f, i) => (
              <li key={i}>
                <span className="font-medium">{f.name}</span> — {f.how_to_use}
              </li>
            ))}
          </ul>
        </Block>
      )}
      <Block title={t("teachingPlan")}>
        <ol className="space-y-1 text-sm">
          {notes.teaching_plan.map((step, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-16 shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-center text-xs font-medium text-indigo-800 tabular-nums">
                {t("minutes", { n: step.minutes })}
              </span>
              <span>{step.activity}</span>
            </li>
          ))}
        </ol>
      </Block>
      <Block title={t("discussion")}>
        <Bullets items={notes.discussion_questions} />
      </Block>
      {notes.common_misconceptions.length > 0 && (
        <Block title={t("misconceptions")}>
          <ul className="space-y-2 text-sm">
            {notes.common_misconceptions.map((m, i) => (
              <li key={i}>
                <p className="text-red-800">✗ {m.misconception}</p>
                <p className="text-green-800">✓ {m.correction}</p>
              </li>
            ))}
          </ul>
        </Block>
      )}
      <Block title={t("activity")}>
        <div className="rounded-md border bg-slate-50 p-3 text-sm">
          <p className="font-semibold">{notes.class_activity.title}</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            {notes.class_activity.instructions.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <p className="mt-2 text-xs">
            <span className="font-medium">{t("deliverable")}</span> {notes.class_activity.deliverable}
          </p>
        </div>
      </Block>
      <Block title={t("assessment")}>
        <Bullets items={notes.assessment_ideas} />
      </Block>
      <Block title={t("example")}>
        <p className="text-sm">{notes.example_from_this_venture}</p>
      </Block>
    </div>
  );
}

function Guide({ guide }: { guide: StudyGuideContent }) {
  const t = useTranslations("Learning.guide");
  return (
    <div data-testid="study-guide">
      <p className="mb-5 text-sm leading-relaxed">{guide.overview}</p>
      <Block title={t("objectives")}>
        <Bullets items={guide.learning_objectives} />
      </Block>
      <Block title={t("keyTerms")}>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {guide.key_terms.map((k, i) => (
            <div key={i} className="rounded-md border p-2">
              <dt className="font-semibold">{k.term}</dt>
              <dd className="text-muted-foreground">{k.definition}</dd>
            </div>
          ))}
        </dl>
      </Block>
      <Block title={t("concepts")}>
        <div className="flex flex-col gap-2">
          {guide.concepts_explained.map((c, i) => (
            <div key={i} className="rounded-md border p-3 text-sm">
              <p className="font-semibold">{c.concept}</p>
              <p>{c.explanation}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                <span className="font-medium">{t("forExample")}</span> {c.example}
              </p>
            </div>
          ))}
        </div>
      </Block>
      <Block title={t("workedExample")}>
        <p className="rounded-md bg-emerald-50 p-3 text-sm">{guide.worked_example}</p>
      </Block>
      <Block title={t("selfCheck")}>
        <div className="flex flex-col gap-3">
          {guide.self_check.map((q, i) => (
            <QuizItem key={i} index={i} question={q} />
          ))}
        </div>
      </Block>
      <Block title={t("exercise")}>
        <div className="rounded-md border bg-slate-50 p-3 text-sm">
          <p className="font-semibold">{guide.practice_exercise.task}</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            {guide.practice_exercise.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <p className="mt-2 text-xs font-medium">{t("successCriteria")}</p>
          <Bullets items={guide.practice_exercise.success_criteria} />
        </div>
      </Block>
      <Block title={t("summary")}>
        <Bullets items={guide.summary_points} />
      </Block>
    </div>
  );
}

function QuizItem({ index, question }: { index: number; question: StudyGuideContent["self_check"][number] }) {
  const t = useTranslations("Learning.guide");
  const [picked, setPicked] = useState<number | null>(null);
  const correct = picked === question.answer_index;
  return (
    <fieldset className="rounded-md border p-3 text-sm" data-testid={`quiz-${index}`}>
      <legend className="px-1 font-medium">
        {index + 1}. {question.question}
      </legend>
      <div className="flex flex-col gap-1">
        {question.options.map((option, i) => (
          <label key={i} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-50">
            <input
              type="radio"
              name={`quiz-${index}`}
              checked={picked === i}
              onChange={() => setPicked(i)}
              className="accent-emerald-600"
            />
            {option}
          </label>
        ))}
      </div>
      {picked !== null && (
        <p role="status" className={`mt-2 flex items-start gap-1.5 ${correct ? "text-green-800" : "text-red-800"}`}>
          {correct ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" /> : <XCircle aria-hidden className="mt-0.5 size-4 shrink-0" />}
          <span>
            <span className="font-semibold">{correct ? t("correct") : t("notQuite", { answer: question.options[question.answer_index] })}</span>{" "}
            {question.explanation}
          </span>
        </p>
      )}
    </fieldset>
  );
}

