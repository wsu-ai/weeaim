"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  approveSignup,
  listAdminOrganizations,
  listSignups,
  rejectSignup,
  type AdminOrganization,
  type ReviewResult,
  type SignupReviewItem,
  type SignupStatus,
} from "@/lib/api";
import { authErrorMessage, errorDetail } from "@/lib/auth-errors";
import { isAdmin, useSession } from "@/lib/session";

const SIGNUPS_KEY = "admin-signups";
const TABS: SignupStatus[] = ["pending", "approved", "rejected"];
const SELECT_CLASSES =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Flash = { kind: "success" | "warning" | "error"; text: string };

const FLASH_CLASSES: Record<Flash["kind"], string> = {
  success: "border-green-200 bg-green-50 text-green-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-900",
};

export default function AdminSignupsPage() {
  const t = useTranslations("Admin");
  const session = useSession().data;
  const admin = isAdmin(session);
  const [tab, setTab] = useState<SignupStatus>("pending");
  const [flash, setFlash] = useState<Flash | null>(null);

  const pendingQuery = useQuery({
    queryKey: [SIGNUPS_KEY, "pending"],
    queryFn: () => listSignups("pending"),
    enabled: admin,
  });
  const historyQuery = useQuery({
    queryKey: [SIGNUPS_KEY, tab],
    queryFn: () => listSignups(tab),
    enabled: admin && tab !== "pending",
  });
  const orgsQuery = useQuery({
    queryKey: ["admin-organizations"],
    queryFn: listAdminOrganizations,
    enabled: admin,
  });

  if (session && !admin) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 p-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("noAccessTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">{t("noAccessBody")}</CardContent>
        </Card>
      </main>
    );
  }

  const activeQuery = tab === "pending" ? pendingQuery : historyQuery;
  const pendingCount = pendingQuery.data?.length;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>

      <div role="tablist" aria-label={t("title")} className="flex gap-1 border-b">
        {TABS.map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium " +
              (tab === value
                ? "border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent")
            }
          >
            {t(`tabs.${value}`)}
            {value === "pending" && pendingCount !== undefined && ` (${pendingCount})`}
          </button>
        ))}
      </div>

      {flash && (
        <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${FLASH_CLASSES[flash.kind]}`}>
          {flash.text}
        </p>
      )}

      {activeQuery.isPending && <p className="text-muted-foreground text-sm">{t("loading")}</p>}
      {activeQuery.isError && (
        <p className="text-destructive text-sm" role="alert">
          {t("loadFailed")}
        </p>
      )}

      {activeQuery.data?.length === 0 && (
        <p className="text-muted-foreground py-8 text-center text-sm">{t(`empty.${tab}`)}</p>
      )}

      {tab === "pending"
        ? pendingQuery.data?.map((signup) => (
            <PendingSignupCard
              key={signup.id}
              signup={signup}
              organizations={orgsQuery.data ?? []}
              onReviewed={setFlash}
            />
          ))
        : historyQuery.data?.map((signup) => <ReviewedSignupCard key={signup.id} signup={signup} />)}
    </main>
  );
}

function SignupDetails({ signup }: { signup: SignupReviewItem }) {
  const t = useTranslations("Admin");
  const tSignup = useTranslations("Signup");
  const format = useFormatter();
  const when = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" }) : "—";

  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">{t("fields.email")}</dt>
      <dd className="break-all">{signup.email}</dd>
      <dt className="text-muted-foreground">{t("fields.affiliation")}</dt>
      <dd>
        {signup.affiliation ? tSignup(`affiliationOptions.${signup.affiliation}`) : "—"}
        {signup.affiliation_name && ` · ${signup.affiliation_name}`}
      </dd>
      <dt className="text-muted-foreground">{t("fields.department")}</dt>
      <dd>{signup.department || "—"}</dd>
      <dt className="text-muted-foreground">{t("fields.language")}</dt>
      <dd>{signup.preferred_language === "ko" ? "한국어" : "English"}</dd>
      <dt className="text-muted-foreground">{t("fields.registered")}</dt>
      <dd>{when(signup.registered_at)}</dd>
      <dt className="text-muted-foreground">{t("fields.verified")}</dt>
      <dd>{when(signup.verified_at)}</dd>
      <dt className="text-muted-foreground">{t("fields.plannedUse")}</dt>
      <dd className="whitespace-pre-wrap">{signup.access_reason || "—"}</dd>
    </dl>
  );
}

function PendingSignupCard({
  signup,
  organizations,
  onReviewed,
}: {
  signup: SignupReviewItem;
  organizations: AdminOrganization[];
  onReviewed: (flash: Flash) => void;
}) {
  const t = useTranslations("Admin");
  const tLogin = useTranslations("Login");
  const queryClient = useQueryClient();
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [role, setRole] = useState("member");
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  const selectedOrg = organizations.find((o) => o.slug === orgSlug) ?? organizations[0];
  const roles: string[] = selectedOrg?.grantable_roles ?? ["member"];
  const name = signup.full_name || signup.email;

  function onSuccess(result: ReviewResult, decision: "approved" | "rejected") {
    queryClient.invalidateQueries({ queryKey: [SIGNUPS_KEY] });
    const text =
      decision === "approved"
        ? t("approvedMessage", { name, organization: selectedOrg?.name ?? "" })
        : t("rejectedMessage", { name });
    onReviewed(
      result.email_sent
        ? { kind: "success", text }
        : { kind: "warning", text: `${text} ${t("emailNotSent")}` },
    );
  }

  function onError(error: unknown) {
    if (errorDetail(error) === "already_reviewed") {
      queryClient.invalidateQueries({ queryKey: [SIGNUPS_KEY] });
      onReviewed({ kind: "warning", text: t("alreadyReviewed", { name }) });
      return;
    }
    onReviewed({
      kind: "error",
      text: authErrorMessage(error, tLogin, { byStatus: { 403: t("notAllowed") } }),
    });
  }

  const approveMutation = useMutation({
    mutationFn: () => approveSignup(signup.id, selectedOrg!.slug, roles.includes(role) ? role : "member"),
    onSuccess: (result) => onSuccess(result, "approved"),
    onError,
  });
  const rejectMutation = useMutation({
    mutationFn: () => rejectSignup(signup.id, note),
    onSuccess: (result) => onSuccess(result, "rejected"),
    onError,
  });
  const busy = approveMutation.isPending || rejectMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <SignupDetails signup={signup} />

        {rejecting ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={`note-${signup.id}`} className="text-sm font-medium">
              {t("rejectNoteLabel")}
            </label>
            <Textarea
              id={`note-${signup.id}`}
              rows={2}
              maxLength={500}
              placeholder={t("rejectNotePlaceholder")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="destructive" disabled={busy} onClick={() => rejectMutation.mutate()}>
                {rejectMutation.isPending ? t("working") : t("confirmReject")}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>
                {t("cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("organization")}</span>
              <select
                className={SELECT_CLASSES}
                value={selectedOrg?.slug ?? ""}
                onChange={(e) => setOrgSlug(e.target.value)}
                disabled={!organizations.length}
              >
                {organizations.map((org) => (
                  <option key={org.slug} value={org.slug}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t("role")}</span>
              <select
                className={SELECT_CLASSES}
                value={roles.includes(role) ? role : "member"}
                onChange={(e) => setRole(e.target.value)}
              >
                {roles.map((value) => (
                  <option key={value} value={value}>
                    {t(`roles.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <Button disabled={busy || !selectedOrg} onClick={() => approveMutation.mutate()}>
              {approveMutation.isPending ? t("working") : t("approve")}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
              {t("reject")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewedSignupCard({ signup }: { signup: SignupReviewItem }) {
  const t = useTranslations("Admin");
  const format = useFormatter();
  const reviewedAt = signup.reviewed_at
    ? format.dateTime(new Date(signup.reviewed_at), { dateStyle: "medium", timeStyle: "short" })
    : "—";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{signup.full_name || signup.email}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm">
          {t(signup.status === "approved" ? "approvedSummary" : "rejectedSummary", {
            when: reviewedAt,
            reviewer: signup.reviewed_by ?? t("commandLine"),
          })}
          {signup.status === "approved" && signup.organizations.length > 0 && (
            <> · {signup.organizations.join(", ")}</>
          )}
        </p>
        {signup.review_note && (
          <p className="text-muted-foreground text-sm">
            {t("note")}: {signup.review_note}
          </p>
        )}
        <SignupDetails signup={signup} />
      </CardContent>
    </Card>
  );
}
