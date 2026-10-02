"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AuthShell } from "@/components/auth-shell";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Link, useRouter } from "@/i18n/navigation";
import {
  devLogin,
  getAuthConfig,
  googleLogin,
  logout,
  passwordLogin,
  selectOrganization,
} from "@/lib/api";
import { authErrorMessage, errorDetail } from "@/lib/auth-errors";
import { useSession, useSetSession } from "@/lib/session";

type PasswordFormValues = { email: string; password: string };
type DevLoginFormValues = { email: string };

const HOME_AFTER_LOGIN = "/ventures";

export default function LoginPage() {
  const t = useTranslations("Login");
  const locale = useLocale();
  const router = useRouter();
  const session = useSession().data;
  const setSession = useSetSession();
  const configQuery = useQuery({ queryKey: ["auth-config"], queryFn: getAuthConfig });
  const config = configQuery.data;

  // Signed in with an organization chosen: nothing to do here.
  useEffect(() => {
    if (session?.active_organization) router.replace(HOME_AFTER_LOGIN);
  }, [session, router]);

  const googleMutation = useMutation({ mutationFn: googleLogin, onSuccess: setSession });
  const passwordMutation = useMutation({
    mutationFn: (values: PasswordFormValues) => passwordLogin(values.email, values.password),
    onSuccess: setSession,
  });
  const devMutation = useMutation({
    mutationFn: (values: DevLoginFormValues) => devLogin(values.email),
    onSuccess: setSession,
  });
  const selectMutation = useMutation({ mutationFn: selectOrganization, onSuccess: setSession });
  const switchAccountMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => setSession(null),
  });

  const passwordSchema = z.object({
    email: z.email({ message: t("errorEmailInvalid") }),
    password: z.string().min(1, { message: t("errorPasswordRequired") }),
  });
  const passwordForm = useForm<PasswordFormValues>({ resolver: zodResolver(passwordSchema) });

  const devSchema = z.object({ email: z.email({ message: t("errorEmailInvalid") }) });
  const devForm = useForm<DevLoginFormValues>({ resolver: zodResolver(devSchema) });

  // Account states the backend reports once the user has proven who they are.
  const accountStatusMessages = {
    pending_approval: t("errorPendingApproval"),
    account_disabled: t("errorAccountDisabled"),
  };

  const googleError = googleMutation.isError
    ? authErrorMessage(googleMutation.error, t, {
        byDetail: accountStatusMessages,
        byStatus: { 403: t("errorNotInvited"), 401: t("errorGoogleFailed") },
      })
    : null;
  const passwordNeedsVerification =
    passwordMutation.isError && errorDetail(passwordMutation.error) === "email_not_verified";
  const passwordError =
    passwordMutation.isError && !passwordNeedsVerification
      ? authErrorMessage(passwordMutation.error, t, {
          byDetail: accountStatusMessages,
          byStatus: { 401: t("errorInvalidCredentials"), 429: t("errorTooManyAttempts") },
        })
      : null;
  const devError = devMutation.isError
    ? authErrorMessage(devMutation.error, t, { byStatus: { 401: t("errorUnknownUser") } })
    : null;

  // Signed in, but belongs to several organizations and hasn't picked one.
  const needsOrganization = session && !session.active_organization;

  if (needsOrganization) {
    return (
      <AuthShell>
        <CardHeader>
          <CardTitle>{t("chooseOrganization")}</CardTitle>
          <CardDescription>{t("chooseOrganizationDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {session.organizations.map((org) => (
            <Button
              key={org.slug}
              variant="outline"
              className="justify-start"
              disabled={selectMutation.isPending}
              onClick={() => selectMutation.mutate(org.slug)}
            >
              {org.name}
            </Button>
          ))}
          {selectMutation.isError && (
            <p className="text-destructive text-sm" role="alert">
              {authErrorMessage(selectMutation.error, t)}
            </p>
          )}
          <Button
            variant="ghost"
            className="self-start"
            disabled={switchAccountMutation.isPending}
            onClick={() => switchAccountMutation.mutate()}
          >
            {t("back")}
          </Button>
        </CardContent>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <CardHeader>
        <CardTitle>{t("cardTitle")}</CardTitle>
        <CardDescription>{t("cardDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {config?.google_client_id ? (
          <GoogleSignInButton
            clientId={config.google_client_id}
            locale={locale}
            onCredential={(credential) => googleMutation.mutate(credential)}
          />
        ) : (
          config && <p className="text-muted-foreground text-sm">{t("googleNotConfigured")}</p>
        )}
        {configQuery.isError && (
          <p className="text-destructive text-sm" role="alert">
            {authErrorMessage(configQuery.error, t)}
          </p>
        )}
        {googleMutation.isPending && (
          <p className="text-muted-foreground text-sm" role="status">
            {t("submitting")}
          </p>
        )}
        {googleError && (
          <p className="text-destructive text-sm" role="alert">
            {googleError}
          </p>
        )}

        <div className="text-muted-foreground flex items-center gap-3 text-xs">
          <span className="bg-border h-px flex-1" />
          {t("divider")}
          <span className="bg-border h-px flex-1" />
        </div>

        <form
          onSubmit={passwordForm.handleSubmit((values) => passwordMutation.mutate(values))}
          className="flex flex-col gap-3"
          noValidate
        >
          <label htmlFor="login-email" className="text-sm font-medium">
            {t("passwordEmailLabel")}
          </label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder={t("emailPlaceholder")}
            aria-invalid={!!passwordForm.formState.errors.email}
            {...passwordForm.register("email")}
          />
          {passwordForm.formState.errors.email && (
            <p className="text-destructive text-sm" role="alert">
              {passwordForm.formState.errors.email.message}
            </p>
          )}

          <div className="flex items-center justify-between">
            <label htmlFor="login-password" className="text-sm font-medium">
              {t("passwordLabel")}
            </label>
            <Link href="/forgot-password" className="text-sm text-blue-700 hover:underline">
              {t("forgotPassword")}
            </Link>
          </div>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!passwordForm.formState.errors.password}
            {...passwordForm.register("password")}
          />
          {passwordForm.formState.errors.password && (
            <p className="text-destructive text-sm" role="alert">
              {passwordForm.formState.errors.password.message}
            </p>
          )}
          {passwordError && (
            <p className="text-destructive text-sm" role="alert">
              {passwordError}
            </p>
          )}
          {passwordNeedsVerification && (
            <p className="text-destructive text-sm" role="alert">
              {t("errorEmailNotVerified")}{" "}
              <Link
                href={{
                  pathname: "/verify-email",
                  query: { email: passwordForm.getValues("email") },
                }}
                className="font-medium underline"
              >
                {t("verifyNow")}
              </Link>
            </p>
          )}
          <Button type="submit" disabled={passwordMutation.isPending}>
            {passwordMutation.isPending ? t("submitting") : t("passwordSubmit")}
          </Button>
        </form>

        <p className="text-muted-foreground text-center text-sm">
          {t("noAccount")}{" "}
          <Link href="/signup" className="font-medium text-blue-700 hover:underline">
            {t("signUpLink")}
          </Link>
        </p>

        {config?.dev_login_enabled && (
          <details className="text-muted-foreground border-t pt-3 text-sm">
            <summary className="cursor-pointer select-none">{t("devSection")}</summary>
            <form
              onSubmit={devForm.handleSubmit((values) => devMutation.mutate(values))}
              className="mt-3 flex flex-col gap-3"
              noValidate
            >
              <label htmlFor="dev-email" className="text-foreground text-sm font-medium">
                {t("emailLabel")}
              </label>
              <Input
                id="dev-email"
                type="email"
                autoComplete="off"
                placeholder="dev@weeaim.local"
                aria-invalid={!!devForm.formState.errors.email}
                {...devForm.register("email")}
              />
              {devForm.formState.errors.email && (
                <p className="text-destructive text-sm" role="alert">
                  {devForm.formState.errors.email.message}
                </p>
              )}
              {devError && (
                <p className="text-destructive text-sm" role="alert">
                  {devError}
                </p>
              )}
              <Button type="submit" variant="outline" disabled={devMutation.isPending}>
                {devMutation.isPending ? t("submitting") : t("devSubmit")}
              </Button>
              <p className="text-xs">{t("devNotice")}</p>
            </form>
          </details>
        )}
      </CardContent>
    </AuthShell>
  );
}
