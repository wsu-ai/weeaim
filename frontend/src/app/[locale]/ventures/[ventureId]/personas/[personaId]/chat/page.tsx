"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect } from "react";

import { PersonaChat, personaInitials } from "@/components/persona-chat";
import { Button } from "@/components/ui/button";
import { listStages, type TargetPersona } from "@/lib/api";

/**
 * The persona chat window, opened from Stage 7 ("Launch a chat with the
 * Persona"). Signed-in only (the ventures layout); the venture and persona
 * are loaded within the user's organization by the API.
 */
export default function PersonaChatPage() {
  const t = useTranslations("PersonaValidation");
  const locale = useLocale();
  const { ventureId, personaId } = useParams<{ ventureId: string; personaId: string }>();
  const stages = useQuery({ queryKey: ["stages", ventureId], queryFn: () => listStages(ventureId) });
  const answers = stages.data?.find((stage) => stage.slug === "persona_validation")?.answers ?? {};
  const persona = ((answers.personas as TargetPersona[] | undefined) ?? []).find((p) => p.id === personaId) ?? null;

  useEffect(() => {
    if (persona) document.title = t("chatWindowTitle", { name: persona.name });
  }, [persona, t]);

  if (stages.isLoading) {
    return <main className="p-6" aria-busy="true" />;
  }
  if (!persona) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-col gap-3 p-6">
        <p role="alert" className="text-sm">
          {t("personaMissing")}
        </p>
        <Button variant="outline" onClick={() => window.close()}>
          {t("closeWindow")}
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 p-4">
      <header className="flex items-center gap-3">
        <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-amber-100 font-bold text-amber-900">
          {personaInitials(persona.name)}
        </span>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">{t("chatWindowTitle", { name: persona.name })}</h1>
          <p className="text-muted-foreground text-xs" data-testid="persona-criteria">
            {persona.age_min}–{persona.age_max} · {t(`income.${persona.income_level}`)} · {t(`gender.${persona.gender}`)} ·{" "}
            {t(`marital.${persona.marital_status}`)}
            {persona.demographic && ` · ${persona.demographic}`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.close()}>
          {t("closeWindow")}
        </Button>
      </header>
      <PersonaChat ventureId={ventureId} persona={persona} language={locale === "ko" ? "ko" : "en"} />
    </main>
  );
}
