"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AwaitingApproval, VerifyEmailForm } from "@/components/verify-email-form";
import { Link } from "@/i18n/navigation";
import { signup, type Affiliation } from "@/lib/api";
import { authErrorMessage, errorDetail } from "@/lib/auth-errors";

const AFFILIATIONS: Affiliation[] = [
  "woosong_student",
  "woosong_faculty_staff",
  "woosong_alumni",
  "external_founder",
  "other",
];
// These need the user to name their school or organization.
const NEEDS_ORGANIZATION_NAME: Affiliation[] = ["external_founder", "other"];
const MIN_PASSWORD_LENGTH = 10;

type SignupFormValues = {
  full_name: string;
  email: string;
  password: string;
  confirm_password: string;
  affiliation: string;
  affiliation_name: string;
  department: string;
  preferred_language: "en" | "ko";
  access_reason: string;
  accept_terms: boolean;
  accept_privacy: boolean;
  accept_ai_processing: boolean;
};

type Step = { name: "form" } | { name: "verify"; email: string; password: string } | { name: "done" };

const SELECT_CLASSES =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm";

export default function SignupPage() {
  const t = useTranslations("Signup");
  const tLogin = useTranslations("Login");
  const locale = useLocale();
  const [step, setStep] = useState<Step>({ name: "form" });

  const schema = z
    .object({
      full_name: z.string().trim().min(2, { message: t("errorFullName") }).max(100),
      email: z.email({ message: tLogin("errorEmailInvalid") }),
      password: z
        .string()
        .min(MIN_PASSWORD_LENGTH, { message: t("errorPasswordTooShort") })
        .max(128, { message: t("errorPasswordTooLong") }),
      confirm_password: z.string(),
      affiliation: z.string().refine((v) => AFFILIATIONS.includes(v as Affiliation), {
        message: t("errorAffiliation"),
      }),
      affiliation_name: z.string().trim().max(200),
      department: z.string().trim().max(200),
      preferred_language: z.enum(["en", "ko"]),
      access_reason: z
        .string()
        .trim()
        .min(10, { message: t("errorAccessReason") })
        .max(500, { message: t("errorAccessReasonTooLong") }),
      accept_terms: z.boolean().refine((v) => v, { message: t("errorConsentRequired") }),
      accept_privacy: z.boolean().refine((v) => v, { message: t("errorConsentRequired") }),
      accept_ai_processing: z.boolean().refine((v) => v, { message: t("errorConsentRequired") }),
    })
    .superRefine((values, ctx) => {
      if (values.password !== values.confirm_password) {
        ctx.addIssue({ code: "custom", path: ["confirm_password"], message: t("errorPasswordMismatch") });
      }
      const localPart = values.email.split("@")[0]?.toLowerCase() ?? "";
      if (localPart.length >= 3 && values.password.toLowerCase().includes(localPart)) {
        ctx.addIssue({ code: "custom", path: ["password"], message: t("errorPasswordContainsEmail") });
      }
      if (
        NEEDS_ORGANIZATION_NAME.includes(values.affiliation as Affiliation) &&
        !values.affiliation_name
      ) {
        ctx.addIssue({ code: "custom", path: ["affiliation_name"], message: t("errorAffiliationName") });
      }
    });

  const form = useForm<SignupFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: "",
      email: "",
      password: "",
      confirm_password: "",
      affiliation: "",
      affiliation_name: "",
      department: "",
      preferred_language: locale === "ko" ? "ko" : "en",
      access_reason: "",
      accept_terms: false,
      accept_privacy: false,
      accept_ai_processing: false,
    },
  });
  const errors = form.formState.errors;
  const affiliation = useWatch({ control: form.control, name: "affiliation" });
  const passwordLength = useWatch({ control: form.control, name: "password" }).length;

  const signupMutation = useMutation({
    mutationFn: (values: SignupFormValues) =>
      signup({
        full_name: values.full_name.trim(),
        email: values.email.trim(),
        password: values.password,
        affiliation: values.affiliation as Affiliation,
        affiliation_name: values.affiliation_name.trim() || null,
        department: values.department.trim() || null,
        preferred_language: values.preferred_language,
        access_reason: values.access_reason.trim(),
        accept_terms: values.accept_terms,
        accept_privacy: values.accept_privacy,
        accept_ai_processing: values.accept_ai_processing,
      }),
    onSuccess: (_result, values) =>
      setStep({ name: "verify", email: values.email.trim(), password: values.password }),
    onError: (error) => {
      // The backend's password policy, in case it's stricter than the form.
      const detail = errorDetail(error);
      if (detail === "password_too_short") form.setError("password", { message: t("errorPasswordTooShort") });
      if (detail === "password_contains_email") form.setError("password", { message: t("errorPasswordContainsEmail") });
    },
  });

  const submitError =
    signupMutation.isError && !errors.password
      ? authErrorMessage(signupMutation.error, tLogin, { byStatus: { 422: t("errorInvalid") } })
      : null;

  if (step.name === "verify") {
    return (
      <AuthShell>
        <CardHeader>
          <CardTitle>{t("verifyTitle")}</CardTitle>
          <CardDescription>{t("verifyDescription", { email: step.email })}</CardDescription>
        </CardHeader>
        <CardContent>
          <VerifyEmailForm
            initialEmail={step.email}
            knownPassword={step.password}
            codeJustSent
            onVerified={() => setStep({ name: "done" })}
          />
        </CardContent>
      </AuthShell>
    );
  }

  if (step.name === "done") {
    return (
      <AuthShell>
        <CardHeader>
          <CardTitle>{t("doneTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <AwaitingApproval />
          <Link href="/" className="text-sm font-medium text-blue-700 hover:underline">
            {t("backToSignIn")}
          </Link>
        </CardContent>
      </AuthShell>
    );
  }

  const fieldError = (message?: string) =>
    message ? (
      <p className="text-destructive text-sm" role="alert">
        {message}
      </p>
    ) : null;

  return (
    <AuthShell cardClassName="max-w-lg">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={form.handleSubmit((values) => signupMutation.mutate(values))}
          className="flex flex-col gap-3"
          noValidate
        >
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-semibold">{t("sectionAccount")}</legend>

            <label htmlFor="full_name" className="text-sm font-medium">
              {t("fullName")}
            </label>
            <Input id="full_name" autoComplete="name" aria-invalid={!!errors.full_name} {...form.register("full_name")} />
            {fieldError(errors.full_name?.message)}

            <label htmlFor="email" className="text-sm font-medium">
              {t("email")}
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder={tLogin("emailPlaceholder")}
              aria-invalid={!!errors.email}
              {...form.register("email")}
            />
            {fieldError(errors.email?.message)}

            <label htmlFor="password" className="text-sm font-medium">
              {t("password")}
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              aria-describedby="password-hint"
              {...form.register("password")}
            />
            <p
              id="password-hint"
              className={
                passwordLength >= MIN_PASSWORD_LENGTH ? "text-xs text-green-700" : "text-muted-foreground text-xs"
              }
            >
              {t("passwordHint", { count: MIN_PASSWORD_LENGTH })}
            </p>
            {fieldError(errors.password?.message)}

            <label htmlFor="confirm_password" className="text-sm font-medium">
              {t("confirmPassword")}
            </label>
            <Input
              id="confirm_password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.confirm_password}
              {...form.register("confirm_password")}
            />
            {fieldError(errors.confirm_password?.message)}
          </fieldset>

          <fieldset className="mt-2 flex flex-col gap-3">
            <legend className="mb-1 text-sm font-semibold">{t("sectionAbout")}</legend>

            <label htmlFor="affiliation" className="text-sm font-medium">
              {t("affiliation")}
            </label>
            <select
              id="affiliation"
              className={SELECT_CLASSES}
              aria-invalid={!!errors.affiliation}
              {...form.register("affiliation")}
            >
              <option value="" disabled>
                {t("affiliationPlaceholder")}
              </option>
              {AFFILIATIONS.map((value) => (
                <option key={value} value={value}>
                  {t(`affiliationOptions.${value}`)}
                </option>
              ))}
            </select>
            {fieldError(errors.affiliation?.message)}

            {NEEDS_ORGANIZATION_NAME.includes(affiliation as Affiliation) && (
              <>
                <label htmlFor="affiliation_name" className="text-sm font-medium">
                  {t("affiliationName")}
                </label>
                <Input
                  id="affiliation_name"
                  autoComplete="organization"
                  aria-invalid={!!errors.affiliation_name}
                  {...form.register("affiliation_name")}
                />
                {fieldError(errors.affiliation_name?.message)}
              </>
            )}

            <label htmlFor="department" className="text-sm font-medium">
              {t("department")} <span className="text-muted-foreground font-normal">{t("optional")}</span>
            </label>
            <Input id="department" {...form.register("department")} />

            <label htmlFor="preferred_language" className="text-sm font-medium">
              {t("preferredLanguage")}
            </label>
            <select id="preferred_language" className={SELECT_CLASSES} {...form.register("preferred_language")}>
              <option value="en">English</option>
              <option value="ko">한국어</option>
            </select>

            <label htmlFor="access_reason" className="text-sm font-medium">
              {t("accessReason")}
            </label>
            <Textarea
              id="access_reason"
              rows={3}
              placeholder={t("accessReasonPlaceholder")}
              aria-invalid={!!errors.access_reason}
              {...form.register("access_reason")}
            />
            {fieldError(errors.access_reason?.message)}
          </fieldset>

          <fieldset className="mt-2 flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold">{t("sectionConsent")}</legend>
            {(["accept_terms", "accept_privacy", "accept_ai_processing"] as const).map((name) => (
              <div key={name}>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1 size-4 shrink-0" {...form.register(name)} />
                  <span>{t(`consents.${name}`)}</span>
                </label>
                {fieldError(errors[name]?.message)}
              </div>
            ))}
            <details className="text-muted-foreground text-xs">
              <summary className="cursor-pointer select-none">{t("privacySummaryTitle")}</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>{t("privacyCollected")}</li>
                <li>{t("privacyPurpose")}</li>
                <li>{t("privacyAi")}</li>
                <li>{t("privacyRetention")}</li>
              </ul>
            </details>
          </fieldset>

          {submitError && (
            <p className="text-destructive text-sm" role="alert">
              {submitError}
            </p>
          )}

          <Button type="submit" className="mt-2" disabled={signupMutation.isPending}>
            {signupMutation.isPending ? t("submitting") : t("submit")}
          </Button>
          <p className="text-muted-foreground text-center text-sm">
            {t("haveAccount")}{" "}
            <Link href="/" className="font-medium text-blue-700 hover:underline">
              {t("signInLink")}
            </Link>
          </p>
        </form>
      </CardContent>
    </AuthShell>
  );
}
