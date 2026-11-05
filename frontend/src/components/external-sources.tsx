"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, KeyRound, Plus, Trash2, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  createExternalSource,
  deleteExternalSource,
  listExternalSources,
  testExternalSource,
  updateExternalSource,
  type ExternalSource,
} from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";

const QUERY_KEY = ["external-sources"];
const KNOWN_ERRORS = [
  "https_required",
  "missing_query_placeholder",
  "credentials_in_url",
  "port_not_allowed",
  "host_not_allowed",
  "private_address",
  "host_not_found",
  "key_storage_not_configured",
  "too_many_sources",
];

/** "External Source": the button under Stage 1's Sources, opening the organization's external data sources. */
export function ExternalSourcesButton() {
  const t = useTranslations("ExternalSources");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" className="w-full" onClick={() => setOpen(true)} data-testid="external-source-button">
        <Database aria-hidden className="size-4" />
        {t("button")}
      </Button>
      {open && <ExternalSourcesDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function useErrorText() {
  const t = useTranslations("ExternalSources");
  const tLogin = useTranslations("Login");
  return (error: unknown) =>
    error instanceof ApiError && error.detail && KNOWN_ERRORS.includes(error.detail)
      ? t(`errors.${error.detail}`)
      : authErrorMessage(error, tLogin, { byStatus: { 403: t("errors.forbidden") } });
}

function ExternalSourcesDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("ExternalSources");
  const closeRef = useRef<HTMLButtonElement>(null);
  const listQuery = useQuery({ queryKey: QUERY_KEY, queryFn: listExternalSources });
  const list = listQuery.data;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-sources-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div>
            <h2 id="external-sources-title" className="flex items-center gap-2 text-lg font-semibold">
              <Database aria-hidden className="size-5 text-blue-800" />
              {t("title")}
            </h2>
            <p className="text-muted-foreground text-sm">{t("description")}</p>
          </div>
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
        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          {listQuery.isPending && <p className="text-muted-foreground text-sm">{t("loading")}</p>}
          {listQuery.isError && (
            <p role="alert" className="text-destructive text-sm">
              {t("loadFailed")}
            </p>
          )}
          {list && (
            <>
              {!list.can_edit && (
                <p className="rounded-md bg-slate-50 p-2 text-sm text-slate-700">{t("readOnly")}</p>
              )}
              {list.sources.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("none")}</p>
              ) : (
                <ul className="flex flex-col gap-2" data-testid="external-source-list">
                  {list.sources.map((source) => (
                    <SourceRow key={source.id} source={source} canEdit={list.can_edit} keysSupported={list.keys_supported} />
                  ))}
                </ul>
              )}
              {list.can_edit && <AddSourceForm keysSupported={list.keys_supported} full={list.sources.length >= 10} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceRow({ source, canEdit, keysSupported }: { source: ExternalSource; canEdit: boolean; keysSupported: boolean }) {
  const t = useTranslations("ExternalSources");
  const format = useFormatter();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const [newKey, setNewKey] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: (change: Parameters<typeof updateExternalSource>[1]) => updateExternalSource(source.id, change),
    onSuccess: () => {
      setNewKey(null);
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: () => deleteExternalSource(source.id), onSuccess: refresh });
  const test = useMutation({ mutationFn: () => testExternalSource(source.id), onSuccess: refresh });
  const error = update.error ?? remove.error ?? test.error;

  return (
    <li className="flex flex-col gap-2 rounded-md border p-3 text-sm" data-testid={`external-source-${source.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{source.name}</p>
          <p className="text-muted-foreground break-all text-xs">{source.url_template}</p>
          <p className="mt-1 flex flex-wrap gap-2 text-xs">
            {source.has_key && (
              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                <KeyRound aria-hidden className="size-3" />
                {t("keySaved", { header: source.header_name || "Authorization" })}
              </span>
            )}
            {!source.enabled && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">{t("disabled")}</span>}
            {source.last_status && (
              <span className={source.last_status === "ok" ? "text-green-800" : "text-red-800"}>
                {source.last_status === "ok"
                  ? t("lastOk", { date: format.dateTime(new Date(source.last_used_at!), { dateStyle: "medium", timeStyle: "short" }) })
                  : t("lastError", { error: source.last_error ?? "" })}
              </span>
            )}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? t("testing") : t("test")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => update.mutate({ enabled: !source.enabled })}>
              {source.enabled ? t("disable") : t("enable")}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("delete", { name: source.name })}
              onClick={() => {
                if (window.confirm(t("deleteConfirm", { name: source.name }))) remove.mutate();
              }}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        )}
      </div>

      {test.isSuccess && (
        <p role="status" className={test.data.status === "ok" ? "text-green-800" : "text-red-800"} data-testid="test-result">
          {test.data.status === "ok"
            ? t("testOk", { items: test.data.items, titles: test.data.sample_titles.join(", ") || "—" })
            : t("testFailed", { error: test.data.error ?? "" })}
        </p>
      )}

      {canEdit && keysSupported && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {newKey === null ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setNewKey("")}>
                {source.has_key ? t("replaceKey") : t("addKey")}
              </Button>
              {source.has_key && (
                <Button size="sm" variant="ghost" onClick={() => update.mutate({ api_key: "" })}>
                  {t("removeKey")}
                </Button>
              )}
            </>
          ) : (
            <form
              className="flex flex-1 items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (newKey.trim()) update.mutate({ api_key: newKey });
              }}
            >
              <Input
                type="password"
                autoComplete="off"
                aria-label={t("newKey")}
                placeholder={t("newKey")}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
              <Button size="sm" type="submit" disabled={!newKey.trim()}>
                {t("saveKey")}
              </Button>
              <Button size="sm" type="button" variant="ghost" onClick={() => setNewKey(null)}>
                {t("cancel")}
              </Button>
            </form>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-800">
          {errorText(error)}
        </p>
      )}
    </li>
  );
}

function AddSourceForm({ keysSupported, full }: { keysSupported: boolean; full: boolean }) {
  const t = useTranslations("ExternalSources");
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [header, setHeader] = useState("Authorization");
  const [key, setKey] = useState("");
  const missingQuery = url.trim() !== "" && !url.includes("{query}");

  const add = useMutation({
    mutationFn: () =>
      createExternalSource({
        name: name.trim(),
        url_template: url.trim(),
        header_name: key.trim() ? header.trim() || "Authorization" : null,
        api_key: key.trim() || null,
      }),
    onSuccess: () => {
      setName("");
      setUrl("");
      setKey("");
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  return (
    <form
      className="flex flex-col gap-2 rounded-md border bg-slate-50/60 p-3 text-sm"
      aria-labelledby="add-source-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && url.trim() && !missingQuery) add.mutate();
      }}
    >
      <h3 id="add-source-title" className="flex items-center gap-1.5 font-semibold">
        <Plus aria-hidden className="size-4" />
        {t("addTitle")}
      </h3>
      <label htmlFor="source-name" className="text-xs font-medium">
        {t("name")}
      </label>
      <Input id="source-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="source-url" className="text-xs font-medium">
        {t("url")}
      </label>
      <Input
        id="source-url"
        maxLength={500}
        placeholder="https://api.example.com/search?q={query}"
        value={url}
        aria-invalid={missingQuery}
        onChange={(e) => setUrl(e.target.value)}
      />
      <p className={`text-xs ${missingQuery ? "text-red-700" : "text-muted-foreground"}`}>{t("urlHint")}</p>
      {keysSupported ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="source-header" className="text-xs font-medium">
              {t("header")}
            </label>
            <Input id="source-header" maxLength={60} value={header} onChange={(e) => setHeader(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="source-key" className="text-xs font-medium">
              {t("key")}
            </label>
            <Input id="source-key" type="password" autoComplete="off" maxLength={1000} value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
          <p className="text-muted-foreground text-xs sm:col-span-2">{t("keyHint")}</p>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">{t("keysNotSupported")}</p>
      )}
      {add.isError && (
        <p role="alert" className="text-sm text-red-800">
          {errorText(add.error)}
        </p>
      )}
      <div>
        <Button type="submit" size="sm" disabled={full || add.isPending || !name.trim() || !url.trim() || missingQuery}>
          {add.isPending ? t("adding") : t("add")}
        </Button>
        {full && <span className="text-muted-foreground ml-2 text-xs">{t("full")}</span>}
      </div>
    </form>
  );
}
