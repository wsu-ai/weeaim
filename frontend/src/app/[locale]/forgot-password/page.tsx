"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { forgotPassword, resetPassword } from "@/lib/api";
import { authErrorMessage, errorDetail } from "@/lib/auth-errors";

const MIN_PASSWORD_LENGTH = 10;

type RequestValues = { email: string };
type ResetValues = { code: string; new_password: string; confirm_password: string };
type Step = { name: "request" } | { name: "reset"; email: string } | { name: "done" };

export default function ForgotPasswordPage() {
  const t = useTranslations("ForgotPassword");
  const tLogin = useTranslations("Login");
  const tSignup = useTranslations("Signup");
  const [step, setStep] = useState<Step>({ name: "request" });

  const requestForm = useForm<RequestValues>({
    resolver: zodResolver(z.object({ email: z.email({ message: tLogin("errorEmailInvalid") }) })),
  });
  const resetSchema = z
    .object({
      code: z.string().trim().regex(/^\d{6}$/, { message: t("errorCodeFormat") }),
      new_password: z
        .string()
        .min(MIN_PASSWORD_LENGTH, { message: tSignup("errorPasswordTooShort") })
        .max(128, { message: tSignup("errorPasswordTooLong") }),
      confirm_password: z.string(),
    })
    .refine((v) => v.new_password === v.confirm_password, {
      path: ["confirm_password"],
      message: tSignup("errorPasswordMismatch"),
    });
  const resetForm = useForm<ResetValues>({ resolver: zodResolver(resetSchema) });

  const requestMutation = useMutation({
    mutationFn: (values: RequestValues) => forgotPassword(values.email.trim()),
    onSuccess: (_result, values) => setStep({ name: "reset", email: values.email.trim() }),
  });
  const resetMutation = useMutation({
    mutationFn: (values: ResetValues) =>
      resetPassword(step.name === "reset" ? step.email : "", values.code.trim(), values.new_password),
    onSuccess: () => setStep({ name: "done" }),
    onError: (error) => {
      const detail = errorDetail(error);
      if (detail === "password_contains_email") {
        resetForm.setError("new_password", { message: tSignup("errorPasswordContainsEmail") });
      }
    },
  });

  const resetError =
    resetMutation.isError && !resetForm.formState.errors.new_password
      ? authErrorMessage(resetMutation.error, tLogin, {
          byDetail: { invalid_code: t("errorInvalidCode") },
        })
      : null;

  return (
    <AuthShell>
      {step.name === "request" && (
        <>
          <CardHeader>
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={requestForm.handleSubmit((values) => requestMutation.mutate(values))}
              className="flex flex-col gap-3"
              noValidate
            >
              <label htmlFor="reset-email" className="text-sm font-medium">
                {t("emailLabel")}
              </label>
              <Input
                id="reset-email"
                type="email"
                autoComplete="email"
                placeholder={tLogin("emailPlaceholder")}
                aria-invalid={!!requestForm.formState.errors.email}
                {...requestForm.register("email")}
              />
              {requestForm.formState.errors.email && (
                <p className="text-destructive text-sm" role="alert">
                  {requestForm.formState.errors.email.message}
                </p>
              )}
              {requestMutation.isError && (
                <p className="text-destructive text-sm" role="alert">
                  {authErrorMessage(requestMutation.error, tLogin)}
                </p>
              )}
              <Button type="submit" disabled={requestMutation.isPending}>
                {requestMutation.isPending ? t("sending") : t("sendCode")}
              </Button>
            </form>
          </CardContent>
        </>
      )}

      {step.name === "reset" && (
        <>
          <CardHeader>
            <CardTitle>{t("resetTitle")}</CardTitle>
            <CardDescription>{t("resetDescription", { email: step.email })}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={resetForm.handleSubmit((values) => resetMutation.mutate(values))}
              className="flex flex-col gap-3"
              noValidate
            >
              <label htmlFor="reset-code" className="text-sm font-medium">
                {t("codeLabel")}
              </label>
              <Input
                id="reset-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                className="tracking-[0.4em]"
                aria-invalid={!!resetForm.formState.errors.code}
                {...resetForm.register("code")}
              />
              {resetForm.formState.errors.code && (
                <p className="text-destructive text-sm" role="alert">
                  {resetForm.formState.errors.code.message}
                </p>
              )}

              <label htmlFor="new-password" className="text-sm font-medium">
                {t("newPassword")}
              </label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!resetForm.formState.errors.new_password}
                {...resetForm.register("new_password")}
              />
              <p className="text-muted-foreground text-xs">
                {tSignup("passwordHint", { count: MIN_PASSWORD_LENGTH })}
              </p>
              {resetForm.formState.errors.new_password && (
                <p className="text-destructive text-sm" role="alert">
                  {resetForm.formState.errors.new_password.message}
                </p>
              )}

              <label htmlFor="confirm-new-password" className="text-sm font-medium">
                {t("confirmPassword")}
              </label>
              <Input
                id="confirm-new-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!resetForm.formState.errors.confirm_password}
                {...resetForm.register("confirm_password")}
              />
              {resetForm.formState.errors.confirm_password && (
                <p className="text-destructive text-sm" role="alert">
                  {resetForm.formState.errors.confirm_password.message}
                </p>
              )}
              {resetError && (
                <p className="text-destructive text-sm" role="alert">
                  {resetError}
                </p>
              )}
              <Button type="submit" disabled={resetMutation.isPending}>
                {resetMutation.isPending ? t("saving") : t("submit")}
              </Button>
              <Button
                type="button"
                variant="link"
                className="h-auto self-start p-0"
                onClick={() => setStep({ name: "request" })}
              >
                {t("startOver")}
              </Button>
            </form>
          </CardContent>
        </>
      )}

      {step.name === "done" && (
        <>
          <CardHeader>
            <CardTitle>{t("doneTitle")}</CardTitle>
            <CardDescription>{t("doneDescription")}</CardDescription>
          </CardHeader>
        </>
      )}

      <CardContent>
        <Link href="/" className="text-sm font-medium text-blue-700 hover:underline">
          {t("backToSignIn")}
        </Link>
      </CardContent>
    </AuthShell>
  );
}
