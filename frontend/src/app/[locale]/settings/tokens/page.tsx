"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { getTokenUsage, updateTokenLimits, type TokenLimits, type TokenUsage } from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";

const TOKEN_USAGE_KEY = ["token-usage"];
const MAX_LIMIT = 1_000_000_000_000;

/** "" -> no limit; a whole number 1..10^12 -> that limit; anything else -> invalid. */
function parseLimit(text: string): number | null | "invalid" {
  const trimmed = text.replace(/[,\s]/g, "");
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const value = Number(trimmed);
  return value >= 1 && value <= MAX_LIMIT ? value : "invalid";
}

function UsageBar({ used, limit, label }: { used: number; limit: number | null; label: string }) {
  if (!limit) return null;
  const percent = Math.min(100, Math.round((used / limit) * 100));
  const color = used >= limit ? "bg-red-600" : percent >= 80 ? "bg-amber-500" : "bg-blue-600";
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className="bg-muted block h-1.5 w-full overflow-hidden rounded-full"
    >
      <span className={`block h-full rounded-full ${color}`} style={{ width: `${percent}%` }} />
    </span>
  );
}

/** Token usage per venture idea and for the organization, and the two limits. */
export default function TokenUsagePage() {
  const t = useTranslations("Tokens");
  const format = useFormatter();
  const usageQuery = useQuery({ queryKey: TOKEN_USAGE_KEY, queryFn: getTokenUsage });
  const usage = usageQuery.data;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-6">
      <Link href="/settings" className="text-sm text-blue-700 hover:underline">
        ← {t("backToSettings")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-muted-foreground text-sm">{t("description")}</p>

      {usageQuery.isPending && <p className="text-muted-foreground text-sm">{t("loading")}</p>}
      {usageQuery.isError && (
        <p role="alert" className="text-destructive text-sm">
          {t("loadFailed")}
        </p>
      )}

      {usage && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("organizationTitle")}</CardTitle>
              <CardDescription>{t("organizationDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="text-2xl font-semibold tabular-nums" data-testid="organization-total">
                {format.number(usage.organization_total)}
                <span className="text-muted-foreground ml-2 text-sm font-normal">
                  {usage.limits.organization_limit
                    ? t("ofLimit", { limit: format.number(usage.limits.organization_limit) })
                    : t("noLimit")}
                </span>
              </p>
              <UsageBar
                used={usage.organization_total}
                limit={usage.limits.organization_limit}
                label={t("organizationBar")}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("venturesTitle")}</CardTitle>
              <CardDescription>
                {usage.limits.per_venture_limit
                  ? t("perVentureLimitIs", { limit: format.number(usage.limits.per_venture_limit) })
                  : t("noPerVentureLimit")}
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <table className="w-full min-w-[520px] text-sm" data-testid="venture-tokens">
                <thead className="bg-muted/50 text-muted-foreground text-left text-xs uppercase tracking-wide">
                  <tr>
                    <th scope="col" className="px-6 py-2 font-medium">{t("columns.venture")}</th>
                    <th scope="col" className="px-6 py-2 text-right font-medium">{t("columns.tokens")}</th>
                    <th scope="col" className="w-48 px-6 py-2 font-medium">{t("columns.ofLimit")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {usage.ventures.map((v) => {
                    const limit = usage.limits.per_venture_limit;
                    const over = v.venture_id !== null && !!limit && v.tokens >= limit;
                    const name = v.venture_id === null ? t("deletedVentures") : (v.title ?? "");
                    return (
                      <tr key={v.venture_id ?? "deleted"}>
                        <td className="px-6 py-2.5">
                          <span className={v.venture_id === null ? "text-muted-foreground italic" : "font-medium"}>{name}</span>
                          {v.archived && (
                            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t("archived")}</span>
                          )}
                          {over && (
                            <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-800">
                              {t("overLimit")}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-2.5 text-right tabular-nums">{format.number(v.tokens)}</td>
                        <td className="px-6 py-2.5">
                          {v.venture_id !== null && limit ? (
                            <span className="flex items-center gap-2">
                              <UsageBar used={v.tokens} limit={limit} label={t("ventureBar", { name })} />
                              <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">
                                {Math.round((v.tokens / limit) * 100)}%
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <LimitsCard usage={usage} />
        </>
      )}
    </main>
  );
}

function LimitsCard({ usage }: { usage: TokenUsage }) {
  const t = useTranslations("Tokens");
  const tLogin = useTranslations("Login");
  const queryClient = useQueryClient();
  const [perVenture, setPerVenture] = useState(usage.limits.per_venture_limit?.toString() ?? "");
  const [organization, setOrganization] = useState(usage.limits.organization_limit?.toString() ?? "");
  const parsedVenture = parseLimit(perVenture);
  const parsedOrganization = parseLimit(organization);
  const invalid = parsedVenture === "invalid" || parsedOrganization === "invalid";

  const saveMutation = useMutation({
    mutationFn: (limits: TokenLimits) => updateTokenLimits(limits),
    onSuccess: (updated) => queryClient.setQueryData(TOKEN_USAGE_KEY, updated),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("limitsTitle")}</CardTitle>
        <CardDescription>{usage.can_edit ? t("limitsDescription") : t("limitsReadOnly")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (invalid) return;
            saveMutation.mutate({
              per_venture_limit: parsedVenture as number | null,
              organization_limit: parsedOrganization as number | null,
            });
          }}
        >
          <label htmlFor="per_venture_limit" className="text-sm font-medium">
            {t("perVentureLabel")}
          </label>
          <Input
            id="per_venture_limit"
            inputMode="numeric"
            placeholder={t("noLimitPlaceholder")}
            value={perVenture}
            readOnly={!usage.can_edit}
            aria-invalid={parsedVenture === "invalid"}
            onChange={(e) => setPerVenture(e.target.value)}
          />
          <label htmlFor="organization_limit" className="text-sm font-medium">
            {t("organizationLabel")}
          </label>
          <Input
            id="organization_limit"
            inputMode="numeric"
            placeholder={t("noLimitPlaceholder")}
            value={organization}
            readOnly={!usage.can_edit}
            aria-invalid={parsedOrganization === "invalid"}
            onChange={(e) => setOrganization(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">{t("limitsHint")}</p>
          {invalid && (
            <p role="alert" className="text-destructive text-sm">
              {t("invalidLimit")}
            </p>
          )}
          {saveMutation.isError && (
            <p role="alert" className="text-destructive text-sm">
              {authErrorMessage(saveMutation.error, tLogin, { byStatus: { 403: t("notAllowed") } })}
            </p>
          )}
          {saveMutation.isSuccess && (
            <p role="status" className="text-sm text-green-700">
              {t("saved")}
            </p>
          )}
          {usage.can_edit && (
            <div>
              <Button type="submit" disabled={invalid || saveMutation.isPending}>
                {saveMutation.isPending ? t("saving") : t("save")}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
