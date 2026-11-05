"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, FlaskConical, RefreshCw, RotateCcw, Send } from "lucide-react";
import { useTranslations } from "next-intl";

import { useTokenLimitMessage } from "@/lib/token-limit";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  getPersonaMarketProfile,
  listPersonaMessages,
  researchPersonaMarket,
  resetPersonaConversation,
  sendPersonaMessage,
  type PersonaMarketProfile,
  type PersonaMessage,
  type TargetPersona,
} from "@/lib/api";

// Links come from the web and are untrusted: open separately, share no
// referrer, and give them no ranking credit.
const EXTERNAL_LINK = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;

export function personaInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join("") || "?"
  );
}

/**
 * The persona chat (shown in its own window): first the market data about
 * people matching the persona's criteria -- researched on the web once per
 * set of criteria -- then the conversation, whose replies are grounded in it.
 */
export function PersonaChat({
  ventureId,
  persona,
  language,
}: {
  ventureId: string;
  persona: TargetPersona;
  language: "en" | "ko";
}) {
  const t = useTranslations("PersonaValidation");
  const tokenLimitMessage = useTokenLimitMessage();
  const queryClient = useQueryClient();
  const marketKey = ["persona-market", ventureId, persona.id];
  const market = useQuery({
    queryKey: marketKey,
    queryFn: () => getPersonaMarketProfile(ventureId, persona.id),
    retry: false,
  });
  const research = useMutation({
    mutationFn: (refresh: boolean) => researchPersonaMarket(ventureId, persona.id, language, refresh),
    onSuccess: (profile) => queryClient.setQueryData(marketKey, profile),
  });
  const notResearched = market.error instanceof ApiError && market.error.status === 404;

  // No research for these criteria yet: run it once, automatically.
  const started = useRef(false);
  useEffect(() => {
    if (notResearched && !started.current) {
      started.current = true;
      research.mutate(false);
    }
  }, [notResearched, research]);

  const profile = market.data ?? null;
  const researching = market.isLoading || research.isPending;
  // Chat once the persona is grounded -- or the research failed and the
  // founder has been told replies aren't grounded.
  const ready = !!profile || research.isError || (market.isError && !notResearched);

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" data-testid="simulated-label">
        <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t("simulatedLabel")}
      </p>

      <section aria-labelledby="market-title" className="rounded-md border bg-white p-3" data-testid="market-profile">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="market-title" className="flex items-center gap-1.5 text-sm font-semibold">
            <BarChart3 aria-hidden className="size-4 text-blue-700" />
            {t("marketTitle", { name: persona.name })}
          </h2>
          {profile && (
            <Button size="sm" variant="outline" disabled={research.isPending} onClick={() => research.mutate(true)}>
              <RefreshCw aria-hidden className={`size-3.5 ${research.isPending ? "animate-spin" : ""}`} />
              {t("refreshMarket")}
            </Button>
          )}
        </div>
        {researching && (
          <p role="status" className="text-muted-foreground mt-2 flex items-center gap-2 text-sm">
            <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            {t("researchingMarket", { name: persona.name })}
          </p>
        )}
        {research.isError && !profile && (
          <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-amber-900">
            <span className="flex-1">{tokenLimitMessage(research.error) ?? t("marketFailed")}</span>
            <Button size="sm" variant="outline" onClick={() => research.mutate(false)}>
              {t("retry")}
            </Button>
          </div>
        )}
        {profile && <MarketProfile profile={profile} />}
      </section>

      <Conversation ventureId={ventureId} persona={persona} language={language} ready={ready} />
    </div>
  );
}

function MarketProfile({ profile }: { profile: PersonaMarketProfile }) {
  const t = useTranslations("PersonaValidation");
  const lists: [string, string[]][] = [
    [t("habits"), profile.daily_life_and_habits],
    [t("alternatives"), profile.current_alternatives],
    [t("spending"), profile.spending_and_price_sensitivity],
    [t("adoption"), profile.adoption_signals],
    [t("likelyObjections"), profile.likely_objections],
  ];
  return (
    <details className="mt-2 text-sm" open>
      <summary className="cursor-pointer">{profile.summary}</summary>
      <ul className="mt-2 flex flex-col gap-1 text-xs" data-testid="market-facts">
        {profile.facts.map((fact, index) => (
          <li key={index}>
            {fact.fact}{" "}
            {fact.source_url ? (
              <a href={fact.source_url} {...EXTERNAL_LINK} className="text-blue-700 hover:underline">
                ({fact.source_title || fact.source_url})
              </a>
            ) : (
              fact.source_title && (
                <span className="text-muted-foreground">
                  ({fact.source_title} — {t("sourceUnverified")})
                </span>
              )
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
        {lists.map(([title, items]) =>
          items.length === 0 ? null : (
            <div key={title}>
              <p className="font-semibold">{title}</p>
              <ul className="list-disc pl-4">
                {items.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          ),
        )}
      </div>
      {profile.data_gaps.length > 0 && (
        <p className="text-muted-foreground mt-2 text-xs">
          <span className="font-semibold">{t("dataGaps")}:</span> {profile.data_gaps.join(" ")}
        </p>
      )}
      <p className="mt-1 text-xs text-green-800">{t("marketGrounded")}</p>
    </details>
  );
}

function Conversation({
  ventureId,
  persona,
  language,
  ready,
}: {
  ventureId: string;
  persona: TargetPersona;
  language: "en" | "ko";
  ready: boolean;
}) {
  const t = useTranslations("PersonaValidation");
  const tokenLimitMessage = useTokenLimitMessage();
  const queryClient = useQueryClient();
  const key = ["persona-messages", ventureId, persona.id];
  const messages = useQuery({ queryKey: key, queryFn: () => listPersonaMessages(ventureId, persona.id) });
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const send = useMutation({
    mutationFn: (content: string) => sendPersonaMessage(ventureId, persona.id, content, language),
    onMutate: (content) => {
      setPending(content);
      setDraft("");
    },
    onSuccess: ({ founder, persona: reply }) => {
      queryClient.setQueryData<PersonaMessage[]>(key, (old = []) => [...old, founder, reply]);
    },
    onError: () => {
      // The founder's message may have been saved even though the reply failed.
      queryClient.invalidateQueries({ queryKey: key });
    },
    onSettled: () => setPending(null),
  });
  const reset = useMutation({
    mutationFn: () => resetPersonaConversation(ventureId, persona.id),
    onSuccess: () => queryClient.setQueryData<PersonaMessage[]>(key, []),
  });

  const list = messages.data ?? [];
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [list.length, pending]);
  const full = send.error instanceof ApiError && send.error.status === 409;

  return (
    <section className="flex flex-col gap-2" data-testid="conversation" aria-label={t("chatWindowTitle", { name: persona.name })}>
      <div className="flex min-h-64 flex-1 flex-col gap-2 overflow-y-auto rounded-md border bg-slate-50 p-3" aria-live="polite">
        {list.length === 0 && !pending && (
          <p className="text-muted-foreground text-sm">{t("chatEmpty", { name: persona.name })}</p>
        )}
        {list.map((message) => (
          <Bubble key={message.id} mine={message.role === "founder"} who={message.role === "founder" ? t("you") : persona.name} text={message.content} />
        ))}
        {pending && <Bubble mine who={t("you")} text={pending} />}
        {send.isPending && (
          <p role="status" className="text-muted-foreground text-xs italic">
            {t("typing", { name: persona.name })}
          </p>
        )}
        <div ref={endRef} />
      </div>
      {send.isError && (
        <p role="alert" className="text-sm text-red-800">
          {tokenLimitMessage(send.error) ??
            (full ? t("conversationFull") : t("chatFailed", { name: persona.name }))}
        </p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && draft.trim() && !send.isPending) send.mutate(draft.trim());
        }}
      >
        <label htmlFor={`message-${persona.id}`} className="sr-only">
          {t("messageLabel", { name: persona.name })}
        </label>
        <Input
          id={`message-${persona.id}`}
          className="flex-1"
          maxLength={4000}
          placeholder={t("messagePlaceholder")}
          value={draft}
          disabled={!ready}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" disabled={!ready || !draft.trim() || send.isPending}>
          <Send aria-hidden className="size-4" />
          {t("send")}
        </Button>
        <Button type="button" variant="outline" disabled={list.length === 0 || reset.isPending} onClick={() => reset.mutate()}>
          <RotateCcw aria-hidden className="size-4" />
          {t("startOver")}
        </Button>
      </form>
    </section>
  );
}

function Bubble({ mine, who, text }: { mine: boolean; who: string; text: string }) {
  return (
    <div className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
      <span aria-hidden className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${mine ? "bg-blue-600 text-white" : "bg-amber-100 text-amber-900"}`}>
        {personaInitials(who)}
      </span>
      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${mine ? "bg-blue-600 text-white" : "border bg-white"}`}>
        <span className="sr-only">{who}: </span>
        {text}
      </div>
    </div>
  );
}
