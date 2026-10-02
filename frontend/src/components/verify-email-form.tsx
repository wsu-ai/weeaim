"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resendVerification, verifyEmail } from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";

const RESEND_COOLDOWN_SECONDS = 60;

type VerifyFormValues = { email: string; password: string; code: string };

/**
 * Enter the 6-digit code emailed at sign-up. The account's password is
 * required too (the backend checks both); when the user has just signed up
 * it's passed in from memory instead of asked for again.
 */
export function VerifyEmailForm({
  initialEmail = "",
  knownPassword,
  codeJustSent = false,
  onVerified,
}: {
  initialEmail?: string;
  knownPassword?: string;
  codeJustSent?: boolean;
  onVerified: () => void;
}) {
  const t = useTranslations("VerifyEmail");
  const tLogin = useTranslations("Login");
  const [cooldown, setCooldown] = useState(codeJustSent ? RESEND_COOLDOWN_SECONDS : 0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const schema = z.object({
    email: z.email({ message: tLogin("errorEmailInvalid") }),
    password: z.string().min(1, { message: tLogin("errorPasswordRequired") }),
    code: z.string().trim().regex(/^\d{6}$/, { message: t("errorCodeFormat") }),
  });
  const form = useForm<VerifyFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: initialEmail, password: knownPassword ?? "", code: "" },
  });

  const verifyMutation = useMutation({
    mutationFn: (values: VerifyFormValues) =>
      verifyEmail(values.email.trim(), values.code.trim(), values.password),
    onSuccess: onVerified,
  });
  const resendMutation = useMutation({
    mutationFn: () => resendVerification(form.getValues("email").trim()),
    onSuccess: () => setCooldown(RESEND_COOLDOWN_SECONDS),
  });

  const verifyError = verifyMutation.isError
    ? authErrorMessage(verifyMutation.error, tLogin, {
        byDetail: { invalid_code: t("errorInvalidCode") },
      })
    : null;
  const errors = form.formState.errors;

  return (
    <form
      onSubmit={form.handleSubmit((values) => verifyMutation.mutate(values))}
      className="flex flex-col gap-3"
      noValidate
    >
      {knownPassword === undefined && (
        <>
          <label htmlFor="verify-email" className="text-sm font-medium">
            {t("emailLabel")}
          </label>
          <Input
            id="verify-email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
            {...form.register("email")}
          />
          {errors.email && (
            <p className="text-destructive text-sm" role="alert">
              {errors.email.message}
            </p>
          )}
          <label htmlFor="verify-password" className="text-sm font-medium">
            {t("passwordLabel")}
          </label>
          <Input
            id="verify-password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            {...form.register("password")}
          />
          {errors.password && (
            <p className="text-destructive text-sm" role="alert">
              {errors.password.message}
            </p>
          )}
        </>
      )}

      <label htmlFor="verify-code" className="text-sm font-medium">
        {t("codeLabel")}
      </label>
      <Input
        id="verify-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="123456"
        className="tracking-[0.4em]"
        aria-invalid={!!errors.code}
        {...form.register("code")}
      />
      {errors.code && (
        <p className="text-destructive text-sm" role="alert">
          {errors.code.message}
        </p>
      )}
      {verifyError && (
        <p className="text-destructive text-sm" role="alert">
          {verifyError}
        </p>
      )}

      <Button type="submit" disabled={verifyMutation.isPending}>
        {verifyMutation.isPending ? t("verifying") : t("submit")}
      </Button>

      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
        <span>{t("noCode")}</span>
        <Button
          type="button"
          variant="link"
          className="h-auto p-0"
          disabled={cooldown > 0 || resendMutation.isPending}
          onClick={() => resendMutation.mutate()}
        >
          {cooldown > 0 ? t("resendIn", { seconds: cooldown }) : t("resend")}
        </Button>
      </div>
      {resendMutation.isSuccess && cooldown > 0 && (
        <p className="text-muted-foreground text-sm" role="status">
          {t("resent")}
        </p>
      )}
      {resendMutation.isError && (
        <p className="text-destructive text-sm" role="alert">
          {authErrorMessage(resendMutation.error, tLogin)}
        </p>
      )}
    </form>
  );
}

/** Shown once the email is verified: the account now waits for an admin. */
export function AwaitingApproval() {
  const t = useTranslations("VerifyEmail");
  return (
    <div className="flex flex-col gap-2" role="status">
      <p className="font-medium">{t("awaitingTitle")}</p>
      <p className="text-muted-foreground text-sm">{t("awaitingBody")}</p>
    </div>
  );
}
