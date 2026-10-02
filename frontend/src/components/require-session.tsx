"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { logout } from "@/lib/api";
import { isAdmin, useSession, useSetSession } from "@/lib/session";

/**
 * Sends visitors without an active session back to the login page and
 * shows who is signed in.
 *
 * A UX guard only: the backend checks the session cookie on every request,
 * so nothing here is relied on for authorization.
 */
export function RequireSession({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Session");
  const tLogin = useTranslations("Login");
  const router = useRouter();
  const sessionQuery = useSession();
  const setSession = useSetSession();
  const session = sessionQuery.data;
  // Signed out, or signed in without an organization chosen yet (the login
  // page handles choosing one).
  const mustLeave = sessionQuery.isError || session === null || (session && !session.active_organization);

  useEffect(() => {
    if (mustLeave) router.replace("/");
  }, [mustLeave, router]);

  const logoutMutation = useMutation({
    mutationFn: logout,
    // Leave even if the request failed: the cookie expires on its own.
    onSettled: () => {
      setSession(null);
      router.replace("/");
    },
  });

  if (!session || mustLeave) return null;

  const orgName =
    session.organizations.find((org) => org.slug === session.active_organization)?.name ?? "";

  return (
    <>
      <header className="flex items-center justify-between gap-4 border-b py-2 pr-4 pl-3 text-sm sm:pr-6">
        <nav className="flex items-center gap-4">
          <Image
            src="/images/woosong-logo.png"
            alt={tLogin("logoAlt")}
            width={453}
            height={111}
            preload
            className="h-8 w-auto"
          />
          <span className="font-semibold tracking-wide">WEEAIM</span>
          <Link href="/ventures" className="text-muted-foreground hover:text-foreground">
            {t("myVentures")}
          </Link>
          <Link href="/ventures/new" className="text-muted-foreground hover:text-foreground">
            {t("newIdea")}
          </Link>
          {isAdmin(session) && (
            <Link href="/admin/signups" className="text-muted-foreground hover:text-foreground">
              {t("admin")}
            </Link>
          )}
        </nav>
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-muted-foreground truncate">
            {t("signedInAs", { email: session.email })} · {orgName}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
          >
            {t("signOut")}
          </Button>
        </div>
      </header>
      {children}
    </>
  );
}
