"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The shared frame of the sign-in, sign-up, verification and password-reset
 * pages: background artwork, Woosong logo, product heading, and a card.
 */
export function AuthShell({
  children,
  cardClassName,
}: {
  children: React.ReactNode;
  cardClassName?: string;
}) {
  const t = useTranslations("Login");

  return (
    <main className="relative flex flex-1 items-center overflow-x-hidden bg-[#050816] text-white">
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/images/innovation-bg.svg)" }}
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-linear-to-r from-[#050816]/90 via-[#050816]/55 to-[#050816]/10"
      />

      <div className="absolute top-4 left-4 z-10 rounded-lg bg-white px-3 py-2 shadow-lg sm:top-6 sm:left-8">
        <Image
          src="/images/woosong-logo.png"
          alt={t("logoAlt")}
          width={453}
          height={111}
          preload
          className="h-8 w-auto sm:h-10"
        />
      </div>

      <div className="relative mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] gap-10 px-4 pt-24 pb-12 sm:px-8 md:py-24 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-center">
        <section>
          <p className="text-sm font-semibold tracking-[0.3em] text-sky-300">{t("eyebrow")}</p>
          <h1 className="mt-4 text-3xl leading-tight font-semibold text-balance wrap-break-word sm:text-5xl">
            {t("heading")}
          </h1>
          <p className="mt-5 max-w-lg text-lg text-slate-200">{t("tagline")}</p>
        </section>

        <Card
          className={cn(
            "w-full max-w-md justify-self-center bg-white/95 text-slate-900 shadow-2xl backdrop-blur md:justify-self-end",
            cardClassName,
          )}
        >
          {children}
        </Card>
      </div>
    </main>
  );
}
