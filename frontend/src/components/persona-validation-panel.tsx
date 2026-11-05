"use client";

import { useMutation } from "@tanstack/react-query";
import { ExternalLink, FlaskConical, MessagesSquare, Plus, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { PersonaAvatar } from "@/components/persona-avatar";
import { useTokenLimitMessage } from "@/lib/token-limit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  isPersonaInsights,
  researchStage,
  type IncomeLevel,
  type MaritalStatus,
  type PersonaGender,
  type PersonaInsightsAnalysis,
  type TargetPersona,
} from "@/lib/api";

const MAX_PERSONAS = 5;
const INCOME: IncomeLevel[] = ["low", "lower_middle", "middle", "upper_middle", "high"];
const GENDER: PersonaGender[] = ["female", "male", "non_binary", "any"];
const MARITAL: MaritalStatus[] = ["single", "married", "divorced", "widowed", "any"];

function blankPersona(): TargetPersona {
  return {
    id: "",
    name: "",
    age_min: 25,
    age_max: 45,
    demographic: "",
    income_level: "middle",
    gender: "any",
    marital_status: "any",
    notes: "",
  };
}

/** Problems the server would reject: a name, and ages 0-120 in order. */
export function personaProblems(personas: TargetPersona[]): boolean {
  return personas.some(
    (p) =>
      !p.name.trim() ||
      !Number.isInteger(p.age_min) ||
      !Number.isInteger(p.age_max) ||
      p.age_min < 0 ||
      p.age_max > 120 ||
      p.age_min > p.age_max,
  );
}

/**
 * Stage 7: the founder defines target personas, interviews an AI persona for
 * each (saved conversations), and summarizes what the conversations suggest.
 * Everything here is simulated, and the panel says so.
 */
export function PersonaValidationPanel({
  ventureId,
  analysis,
  language,
  personas,
  onSavePersonas,
  onResearched,
  historical = false,
  onBackToLatest,
}: {
  ventureId: string;
  analysis: PersonaInsightsAnalysis | null;
  language: "en" | "ko";
  /** The saved personas (with server-assigned IDs). */
  personas: TargetPersona[];
  onSavePersonas: (personas: TargetPersona[]) => Promise<void>;
  onResearched: () => void;
  historical?: boolean;
  onBackToLatest?: () => void;
}) {
  const t = useTranslations("PersonaValidation");
  const tokenLimitMessage = useTokenLimitMessage();
  const format = useFormatter();
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const saved = personas.filter((p) => p.id);

  const summarize = useMutation({
    mutationFn: () => researchStage(ventureId, "persona_validation", language),
    onSuccess: onResearched,
  });
  const fresh = isPersonaInsights(summarize.data ?? null) ? summarize.data : null;
  const shown = historical ? analysis : (fresh ?? analysis);
  const noConversations = summarize.error instanceof ApiError && summarize.error.status === 422;

  return (
    <section aria-labelledby="persona-validation-title" className="flex flex-col gap-4 rounded-lg border bg-slate-50/60 p-4">
      <div>
        <h3 id="persona-validation-title" className="font-semibold">
          {t("title")}
        </h3>
        <p className="text-muted-foreground text-sm">{t("intro")}</p>
      </div>
      <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" data-testid="simulated-label">
        <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t("simulatedLabel")}
      </p>

      {!historical && (
        <PersonaEditor
          // Re-mount when the saved personas change (e.g. IDs assigned on save).
          key={JSON.stringify(personas)}
          saved={personas}
          onSave={onSavePersonas}
        />
      )}

      {!historical && (
        <div className="rounded-md border bg-white p-3">
          <h4 className="mb-2 text-sm font-semibold">{t("chatTitle")}</h4>
          {saved.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("chatNeedsSave")}</p>
          ) : (
            <ChatLaunchers ventureId={ventureId} personas={saved} locale={language} />
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-md border bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold">{t("insightsTitle")}</h4>
            <p className="text-muted-foreground text-xs">{t("insightsIntro")}</p>
          </div>
          {!historical && (
            <Button size="sm" variant="outline" disabled={summarize.isPending || saved.length === 0} onClick={() => summarize.mutate()}>
              {summarize.isPending ? t("summarizing") : t("summarize")}
            </Button>
          )}
        </div>
        {historical && shown && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span>{t("viewingEarlier", { date: when(shown.researched_at) })}</span>
            <Button size="sm" variant="outline" onClick={onBackToLatest}>
              {t("backToLatest")}
            </Button>
          </div>
        )}
        {summarize.isError && (
          <p role="alert" className="text-sm text-red-800">
            {tokenLimitMessage(summarize.error) ?? (noConversations ? t("noConversations") : t("summaryFailed"))}
          </p>
        )}
        {shown && <Insights insights={shown} when={when} />}
      </div>
    </section>
  );
}

function PersonaEditor({ saved, onSave }: { saved: TargetPersona[]; onSave: (personas: TargetPersona[]) => Promise<void> }) {
  const t = useTranslations("PersonaValidation");
  const [edited, setEdited] = useState<TargetPersona[] | null>(saved.length === 0 ? [blankPersona()] : null);
  const personas = edited ?? saved;
  const invalid = personaProblems(personas);
  // The persona whose profile is open (one at a time). A first, blank persona
  // opens straight away so it can be filled in.
  const [open, setOpen] = useState<number | null>(saved.length === 0 ? 0 : null);
  const save = useMutation({
    mutationFn: () => onSave(personas.map((p) => ({ ...p, name: p.name.trim(), demographic: p.demographic.trim() }))),
    onSuccess: () => setEdited(null),
  });

  const update = (index: number, change: Partial<TargetPersona>) =>
    setEdited(personas.map((p, i) => (i === index ? { ...p, ...change } : p)));

  return (
    <form
      className="flex flex-col gap-3 rounded-md border bg-white p-3"
      aria-labelledby="personas-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) save.mutate();
      }}
    >
      <h4 id="personas-title" className="text-sm font-semibold">
        {t("personasTitle")} <span className="font-normal">{t("personasHint")}</span>
      </h4>
      <ul className="flex flex-wrap gap-3" data-testid="persona-gallery">
        {personas.map((persona, index) => {
          const label = persona.name.trim() || t("personaN", { n: index + 1 });
          const needsWork = personaProblems([persona]);
          const selected = open === index;
          return (
            <li key={index}>
              <button
                type="button"
                aria-expanded={selected}
                aria-controls={`persona-profile-${index}`}
                onClick={() => setOpen(selected ? null : index)}
                data-testid={`persona-avatar-${index}`}
                title={t("showProfile", { name: label })}
                className={`flex w-28 flex-col items-center gap-1 rounded-lg border-2 bg-white p-2 text-center text-xs transition-colors hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                  selected ? "border-blue-600 bg-blue-50" : needsWork ? "border-red-300" : "border-transparent"
                }`}
              >
                <PersonaAvatar
                  persona={persona}
                  index={index}
                  size={72}
                  label={t("avatarLabel", {
                    name: label,
                    min: persona.age_min,
                    max: persona.age_max,
                    gender: t(`gender.${persona.gender}`),
                  })}
                />
                <span className="line-clamp-2 font-semibold">{label}</span>
                <span className="text-muted-foreground">
                  {t("avatarCaption", { min: persona.age_min, max: persona.age_max, gender: t(`gender.${persona.gender}`) })}
                </span>
                {needsWork && <span className="font-medium text-red-700">{t("needsDetails")}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {personas.map((persona, index) => {
          if (open !== index) return null;
          const id = (field: string) => `persona-${index}-${field}`;
          const label = persona.name.trim() || t("personaN", { n: index + 1 });
          return (
            <fieldset key={index} id={`persona-profile-${index}`} className="flex flex-col gap-2 rounded-md border border-blue-200 bg-blue-50/30 p-3 text-xs" data-testid={`persona-card-${index}`}>
              <legend className="flex w-full items-center justify-between gap-2 px-1 text-sm font-semibold">
                <span className="flex items-center gap-2">
                  <PersonaAvatar persona={persona} index={index} size={28} />
                  {label}
                </span>
                {personas.length > 1 && (
                  <Button type="button" size="sm" variant="ghost" aria-label={t("removePersona", { name: label })}
                    onClick={() => {
                      setEdited(personas.filter((_, i) => i !== index));
                      setOpen(null);
                    }}>
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                )}
              </legend>
              <label htmlFor={id("name")} className="font-medium">{t("fields.name")}</label>
              <Input id={id("name")} maxLength={60} value={persona.name} onChange={(e) => update(index, { name: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor={id("age-min")} className="font-medium">{t("fields.ageMin")}</label>
                  <Input id={id("age-min")} type="number" min={0} max={120} step={1} value={persona.age_min}
                    onChange={(e) => update(index, { age_min: e.target.value === "" ? 0 : Number(e.target.value) })} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={id("age-max")} className="font-medium">{t("fields.ageMax")}</label>
                  <Input id={id("age-max")} type="number" min={0} max={120} step={1} value={persona.age_max}
                    onChange={(e) => update(index, { age_max: e.target.value === "" ? 0 : Number(e.target.value) })} />
                </div>
              </div>
              <label htmlFor={id("demographic")} className="font-medium">{t("fields.demographic")}</label>
              <Input id={id("demographic")} maxLength={300} placeholder={t("fields.demographicPlaceholder")} value={persona.demographic}
                onChange={(e) => update(index, { demographic: e.target.value })} />
              <div className="grid grid-cols-3 gap-2">
                <Select id={id("income")} label={t("fields.income")} value={persona.income_level}
                  options={INCOME.map((v) => ({ value: v, label: t(`income.${v}`) }))}
                  onChange={(v) => update(index, { income_level: v as IncomeLevel })} />
                <Select id={id("gender")} label={t("fields.gender")} value={persona.gender}
                  options={GENDER.map((v) => ({ value: v, label: t(`gender.${v}`) }))}
                  onChange={(v) => update(index, { gender: v as PersonaGender })} />
                <Select id={id("marital")} label={t("fields.marital")} value={persona.marital_status}
                  options={MARITAL.map((v) => ({ value: v, label: t(`marital.${v}`) }))}
                  onChange={(v) => update(index, { marital_status: v as MaritalStatus })} />
              </div>
              <label htmlFor={id("notes")} className="font-medium">{t("fields.notes")}</label>
              <Input id={id("notes")} maxLength={500} value={persona.notes} onChange={(e) => update(index, { notes: e.target.value })} />
            </fieldset>
          );
        })}
      {invalid && (
        <p role="alert" className="text-sm text-red-800">
          {t("invalid")}
        </p>
      )}
      {save.isError && (
        <p role="alert" className="text-sm text-red-800">
          {t("saveFailed")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={personas.length >= MAX_PERSONAS}
          onClick={() => {
            setEdited([...personas, blankPersona()]);
            setOpen(personas.length); // open the new persona's profile
          }}>
          <Plus aria-hidden className="size-4" />
          {t("addPersona")}
        </Button>
        <Button type="submit" disabled={edited === null || invalid || save.isPending}>
          {save.isPending ? t("saving") : t("savePersonas")}
        </Button>
        <span className="text-muted-foreground text-xs">{t("maxPersonas")}</span>
        {save.isSuccess && edited === null && (
          <span role="status" className="text-xs text-green-700">
            {t("saved")}
          </span>
        )}
      </div>
    </form>
  );
}

function Select({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <select id={id} className="border-input h-8 rounded-md border bg-white px-1" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Path of a persona's chat window (its own page). */
export function personaChatPath(locale: string, ventureId: string, personaId: string): string {
  return `/${locale}/ventures/${encodeURIComponent(ventureId)}/personas/${encodeURIComponent(personaId)}/chat`;
}

/** One "Launch a chat" button per saved persona; each opens its own window. */
function ChatLaunchers({ ventureId, personas, locale }: { ventureId: string; personas: TargetPersona[]; locale: string }) {
  const t = useTranslations("PersonaValidation");
  const [blocked, setBlocked] = useState(false);

  function launch(persona: TargetPersona) {
    const url = personaChatPath(locale, ventureId, persona.id);
    // A named window: launching the same persona again focuses its window.
    const popup = window.open(url, `weeaim-persona-${persona.id}`, "popup,width=560,height=820");
    if (popup) {
      popup.focus();
      setBlocked(false);
    } else {
      // Pop-ups blocked: open it in a new tab instead.
      window.open(url, "_blank");
      setBlocked(true);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="chat-launchers">
      <ul className="flex flex-col gap-2">
        {personas.map((persona, index) => (
          <li key={persona.id} className="flex flex-wrap items-center gap-3 rounded-md border p-2">
            <PersonaAvatar persona={persona} index={index} size={36} />
            <div className="min-w-40 flex-1 text-sm">
              <p className="font-medium">{persona.name}</p>
              <p className="text-muted-foreground text-xs">{t("launchHint", { name: persona.name })}</p>
            </div>
            <Button type="button" onClick={() => launch(persona)} aria-label={`${t("launchChat")}: ${persona.name}`}>
              <MessagesSquare aria-hidden className="size-4" />
              {t("launchChat")}
              <ExternalLink aria-hidden className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      {blocked && (
        <p role="status" className="text-xs text-amber-900">
          {t("popupBlocked")}
        </p>
      )}
    </div>
  );
}

function Insights({ insights, when }: { insights: PersonaInsightsAnalysis; when: (iso: string) => string }) {
  const t = useTranslations("PersonaValidation");
  return (
    <div className="flex flex-col gap-3" data-testid="persona-insights">
      {insights.market_profiles_used !== undefined && (
        <p className="text-muted-foreground text-xs" data-testid="insights-basis">
          {t("insightsBasis", {
            conversations: insights.conversations_used ?? 0,
            markets: insights.market_profiles_used,
          })}
        </p>
      )}
      <p className="text-sm leading-relaxed">{insights.summary}</p>
      {insights.per_persona.map((item) => (
        <div key={item.persona_id} className="rounded-md border p-3 text-sm" data-testid={`insight-${item.persona_id}`}>
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {item.name}
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-700">
              {t("willingness", { level: t(`willingnessLevels.${item.willingness_to_pay}`) })}
            </span>
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <List title={t("reactions")} items={item.reactions} />
            <List title={t("objections")} items={item.objections} />
            <List title={t("feasibility")} items={item.feasibility_signals} />
            <List title={t("viability")} items={item.viability_signals} />
          </div>
          {item.quotes.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-semibold">{t("quotes")}</p>
              {item.quotes.map((quote, index) => (
                <blockquote key={index} className="text-muted-foreground border-l-2 border-amber-300 pl-2 text-xs italic">
                  “{quote}”
                </blockquote>
              ))}
            </div>
          )}
        </div>
      ))}
      <List title={t("testWithReal")} items={insights.assumptions_to_test_with_real_customers} />
      <p className="text-muted-foreground border-t pt-2 text-xs">{t("disclaimer", { date: when(insights.researched_at) })}</p>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold">{title}</p>
      <ul className="list-disc space-y-0.5 pl-4 text-xs">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
