"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { AuthShell } from "@/components/auth-shell";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AwaitingApproval, VerifyEmailForm } from "@/components/verify-email-form";
import { Link } from "@/i18n/navigation";

// For users who signed up earlier and are verifying later (e.g. sent here
// from the sign-in page). They re-enter their password alongside the code.
function VerifyEmailContent() {
  const t = useTranslations("VerifyEmail");
  const initialEmail = useSearchParams().get("email") ?? "";
  const [verified, setVerified] = useState(false);

  return (
    <AuthShell>
      <CardHeader>
        <CardTitle>{verified ? t("doneTitle") : t("title")}</CardTitle>
        {!verified && <CardDescription>{t("description")}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {verified ? (
          <AwaitingApproval />
        ) : (
          <VerifyEmailForm initialEmail={initialEmail} onVerified={() => setVerified(true)} />
        )}
        <Link href="/" className="text-sm font-medium text-blue-700 hover:underline">
          {t("backToSignIn")}
        </Link>
      </CardContent>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
