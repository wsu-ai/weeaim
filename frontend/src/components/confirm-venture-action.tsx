"use client";

import { useMutation } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, requestReauthCode, type Reauth } from "@/lib/api";
import { useSession } from "@/lib/session";

/**
 * Two-step confirmation for removing a venture: "Are you sure?", then proof
 * it's really the signed-in user -- their login password, or (for accounts
 * without one, e.g. Google sign-in) a code emailed to them. The server checks
 * the password or code; this only collects it.
 */
export function ConfirmVentureAction({
  ventureId,
  title,
  mode,
  action,
  onDone,
  onCancel,
}: {
  ventureId: string;
  title: string;
  /** "archive" removes it to the archive; "delete" erases an archived venture. */
  mode: "archive" | "delete";
  action: (reauth: Reauth) => Promise<void>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("ConfirmVenture");
  const session = useSession().data;
  const usesCode = session?.has_password === false;
  const [step, setStep] = useState<"ask" | "verify">("ask");
  const [secret, setSecret] = useState("");

  const codeMutation = useMutation({ mutationFn: () => requestReauthCode(ventureId) });
  const confirmMutation = useMutation({
    mutationFn: () => action(usesCode ? { code: secret.trim() } : { password: secret }),
    onSuccess: onDone,
    onError: () => setSecret(""),
  });

  const id = `confirm-${mode}-${ventureId}`;
  const error = confirmMutation.error ?? codeMutation.error;

  return (
    <div
      role="group"
      aria-labelledby={`${id}-question`}
      className="flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm"
      data-testid={`confirm-${mode}`}
    >
      <p id={`${id}-question`} className="font-medium text-red-900">
        {t(`${mode}.question`, { title })}
      </p>

      {step === "ask" ? (
        <>
          <p className="text-red-900">{t(`${mode}.body`)}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={() => setStep("verify")}>
              {t(`${mode}.yes`)}
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              {t("cancel")}
            </Button>
          </div>
        </>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (secret.trim()) confirmMutation.mutate();
          }}
        >
          <p className="flex items-center gap-1.5 font-medium text-red-900">
            <ShieldCheck aria-hidden className="size-4" />
            {t("verifyTitle")}
          </p>

          {usesCode ? (
            <>
              <p className="text-red-900">{t("codeIntro")}</p>
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={codeMutation.isPending}
                  onClick={() => codeMutation.mutate()}
                >
                  {codeMutation.isSuccess ? t("resendCode") : t("sendCode")}
                </Button>
              </div>
              {codeMutation.isSuccess && (
                <p role="status" className="text-red-900">
                  {t("codeSent", { email: session?.email ?? "" })}
                </p>
              )}
              <label htmlFor={`${id}-secret`} className="text-red-900">
                {t("codeLabel")}
              </label>
              <Input
                id={`${id}-secret`}
                value={secret}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                onChange={(e) => setSecret(e.target.value)}
              />
            </>
          ) : (
            <>
              <label htmlFor={`${id}-secret`} className="text-red-900">
                {t("passwordLabel")}
              </label>
              <Input
                id={`${id}-secret`}
                type="password"
                value={secret}
                autoComplete="current-password"
                autoFocus
                onChange={(e) => setSecret(e.target.value)}
              />
            </>
          )}

          {error && (
            <p role="alert" className="text-destructive">
              {errorMessage(error, t)}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" disabled={!secret.trim() || confirmMutation.isPending}>
              {confirmMutation.isPending ? t("working") : t(`${mode}.confirm`)}
            </Button>
            <Button type="button" variant="ghost" disabled={confirmMutation.isPending} onClick={onCancel}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function errorMessage(error: Error, t: ReturnType<typeof useTranslations<"ConfirmVenture">>): string {
  if (error instanceof ApiError) {
    if (error.detail === "wrong_password") return t("errors.wrong_password");
    if (error.detail === "wrong_code") return t("errors.wrong_code");
    if (error.status === 429) return t("errors.too_many_attempts");
    if (error.status === 403) return t("errors.forbidden");
  }
  return t("errors.failed");
}
