"use client";

import { useMutation } from "@tanstack/react-query";
import {
  Bell,
  BookOpen,
  Calendar,
  Camera,
  ChartColumn,
  Clock,
  Globe,
  Heart,
  Leaf,
  Lock,
  MapPin,
  MessageCircle,
  Package,
  Palette,
  RefreshCw,
  Shield,
  ShoppingCart,
  Sparkles,
  Star,
  Store,
  Users,
  Zap,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import {
  assetUrl,
  isMvp,
  researchStage,
  type MockupIcon,
  type MvpAnalysis,
  type OfferingType,
  type WebsiteMockup as WebsiteMockupContent,
} from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";

const OFFERING_TYPES: OfferingType[] = ["physical_product", "online_service", "offline_service"];
const OFFERING_ICONS: Record<OfferingType, typeof Package> = {
  physical_product: Package,
  online_service: Globe,
  offline_service: Store,
};
export const MOCKUP_ICONS: Record<MockupIcon, typeof Package> = {
  sparkles: Sparkles,
  clock: Clock,
  shield: Shield,
  heart: Heart,
  users: Users,
  chart: ChartColumn,
  calendar: Calendar,
  chat: MessageCircle,
  map: MapPin,
  star: Star,
  leaf: Leaf,
  book: BookOpen,
  camera: Camera,
  cart: ShoppingCart,
  bell: Bell,
  lightning: Zap,
};
const HEX = /^#[0-9a-fA-F]{6}$/;

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Black or white text, whichever reads better on the given background. */
export function readableTextOn(hex: string): "#ffffff" | "#111827" {
  if (!HEX.test(hex)) return "#ffffff";
  const bg = luminance(hex);
  const onWhite = (1.05) / (bg + 0.05);
  const onDark = (bg + 0.05) / (luminance("#111827") + 0.05);
  return onWhite >= onDark ? "#ffffff" : "#111827";
}

/**
 * Stage 9: the minimum viable product or service, designed from stages 1-8.
 * A physical product shows a generated concept image, an online service a
 * sample web page (drawn by this app from structured content, never
 * model-written HTML), and an offline service a service description.
 */
export function MvpPanel({
  ventureId,
  analysis,
  language,
  onSetOfferingType,
  onResearched,
  historical = false,
  onBackToLatest,
  design = null,
}: {
  ventureId: string;
  analysis: MvpAnalysis | null;
  /** The founder's own mock-up from the Design Studio, if saved. */
  design?: WebsiteMockupContent | null;
  language: "en" | "ko";
  /** Saves the founder's choice of offering type (before re-designing). */
  onSetOfferingType: (type: OfferingType) => Promise<void>;
  onResearched: () => void;
  /** Showing an earlier saved run instead of the latest MVP. */
  historical?: boolean;
  onBackToLatest?: () => void;
}) {
  const t = useTranslations("Mvp");
  const tLogin = useTranslations("Login");
  const format = useFormatter();
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  const researchMutation = useMutation({
    mutationFn: () => researchStage(ventureId, "mvp", language),
    onSuccess: onResearched,
  });
  const typeMutation = useMutation({
    mutationFn: async (type: OfferingType) => {
      await onSetOfferingType(type);
    },
    onSuccess: () => researchMutation.mutate(),
  });

  // Design the MVP once, automatically, when there's nothing yet.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!analysis && !historical && !autoStarted.current) {
      autoStarted.current = true;
      researchMutation.mutate();
    }
  }, [analysis, historical, researchMutation]);

  const fresh = isMvp(researchMutation.data ?? null) ? researchMutation.data : null;
  const shown = historical ? analysis : (fresh ?? analysis);
  const busy = researchMutation.isPending || typeMutation.isPending;

  return (
    <section aria-labelledby="mvp-title" className="flex flex-col gap-4 rounded-lg border bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="mvp-title" className="font-semibold">
          {t("title")}
        </h3>
        {!historical && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => researchMutation.mutate()} title={t("refreshHint")}>
            <RefreshCw aria-hidden className={`size-4 ${researchMutation.isPending ? "animate-spin" : ""}`} />
            {researchMutation.isPending ? t("refreshing") : t("refresh")}
          </Button>
        )}
      </div>

      {historical && shown && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>{t("viewingEarlier", { date: when(shown.researched_at) })}</span>
          <Button size="sm" variant="outline" onClick={onBackToLatest}>
            {t("backToLatest")}
          </Button>
        </div>
      )}

      {shown && !historical && (
        <OfferingTypePicker
          current={shown.offering_type}
          source={shown.offering_type_source}
          reason={shown.offering_type_reason}
          disabled={busy}
          onPick={(type) => typeMutation.mutate(type)}
        />
      )}

      {busy && (
        <p role="status" className="text-muted-foreground flex flex-col gap-0.5 text-sm">
          <span className="flex items-center gap-2">
            <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            {typeMutation.isPending ? t("typeSaving") : t("researching")}
          </span>
          <span className="pl-5 text-xs">{t("imageNote")}</span>
        </p>
      )}

      {(researchMutation.isError || typeMutation.isError) && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-800">
          <span>
            {authErrorMessage(researchMutation.error ?? typeMutation.error, tLogin, { byStatus: { 503: t("failed") } })}
          </span>
          <Button size="sm" variant="outline" onClick={() => researchMutation.mutate()}>
            {t("retry")}
          </Button>
        </div>
      )}

      {shown && <MvpBody ventureId={ventureId} mvp={shown} design={historical ? null : design} studio={!historical} />}

      {shown && (
        <p className="text-muted-foreground flex flex-col gap-0.5 border-t pt-3 text-xs">
          {shown.based_on && <span>{t("basedOn", { date: when(shown.based_on) })}</span>}
          <span>{t("disclaimer", { date: when(shown.researched_at) })}</span>
        </p>
      )}
    </section>
  );
}

function OfferingTypePicker({
  current,
  source,
  reason,
  disabled,
  onPick,
}: {
  current: OfferingType;
  source: "ai" | "founder";
  reason: string;
  disabled: boolean;
  onPick: (type: OfferingType) => void;
}) {
  const t = useTranslations("Mvp");
  // The choice being saved, shown at once; cleared when a new MVP arrives.
  const [picked, setPicked] = useState<{ type: OfferingType; for: OfferingType } | null>(null);
  const selected = picked && picked.for === current ? picked.type : current;
  return (
    <div className="flex flex-col gap-1">
      <div role="radiogroup" aria-label={t("typeLabel")} className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{t("typeLabel")}</span>
        {OFFERING_TYPES.map((type) => {
          const Icon = OFFERING_ICONS[type];
          const active = type === selected;
          return (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => {
                if (type === current) return;
                setPicked({ type, for: current });
                onPick(type);
              }}
              className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm transition-colors disabled:opacity-60 ${
                active ? "border-blue-600 bg-blue-50 font-semibold text-blue-800" : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <Icon aria-hidden className="size-4" />
              {t(`offeringTypes.${type}`)}
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs">
        {source === "founder" ? t("typeChosenByYou") : t("typeChosenByAi", { reason })}
      </p>
    </div>
  );
}

function MvpBody({
  ventureId,
  mvp,
  design,
  studio,
}: {
  ventureId: string;
  mvp: MvpAnalysis;
  design: WebsiteMockupContent | null;
  /** Offer the Design Studio (not for an earlier saved run). */
  studio: boolean;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const t = useTranslations("Mvp");
  return (
    <>
      <div className="rounded-md border-2 border-blue-200 bg-white p-4" data-testid="mvp-concept">
        <p className="text-lg font-semibold">{mvp.name}</p>
        <p className="text-sm text-blue-800">{mvp.tagline}</p>
        <p className="mt-2 text-sm leading-relaxed">{mvp.summary}</p>
        <dl className="mt-2 flex flex-col gap-0.5 text-xs">
          <div className="flex gap-1">
            <dt className="font-semibold">{t("targetUser")}</dt>
            <dd>{mvp.target_user}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="font-semibold">{t("problem")}</dt>
            <dd>{mvp.problem_solved}</dd>
          </div>
        </dl>
      </div>

      {mvp.offering_type === "physical_product" && mvp.physical_product && (
        <ProductView ventureId={ventureId} mvp={mvp} product={mvp.physical_product} />
      )}
      {mvp.offering_type === "online_service" && mvp.website_mockup && (
        <div className="flex flex-col gap-2">
          {design && (
            <p className="flex flex-wrap items-center gap-2 text-xs" data-testid="design-note">
              <span className="rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-900">
                {showOriginal ? t("showingOriginal") : t("showingDesign")}
              </span>
              <button
                type="button"
                className="text-blue-700 hover:underline"
                onClick={() => setShowOriginal((value) => !value)}
              >
                {showOriginal ? t("showMyDesign") : t("showOriginal")}
              </button>
            </p>
          )}
          <WebsiteMockup mockup={design && !showOriginal ? design : mvp.website_mockup} />
          {studio && (
            <div>
              <Link
                href={`/ventures/${ventureId}/design-studio`}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                data-testid="design-studio-button"
              >
                <Palette aria-hidden className="size-4" />
                {t("designStudio")}
              </Link>
              <p className="text-muted-foreground mt-1 text-xs">{t("designStudioHint")}</p>
            </div>
          )}
        </div>
      )}
      {mvp.offering_type === "offline_service" && mvp.offline_service && <ServiceView service={mvp.offline_service} />}

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <h4 className="mb-1 text-sm font-semibold">{t("coreFeaturesTitle")}</h4>
          <ul className="flex flex-col gap-1 text-sm">
            {mvp.core_features.map((item, index) => (
              <li key={index}>
                <span className="font-medium">{item.feature}</span>
                <span className="text-muted-foreground block text-xs">{item.why}</span>
              </li>
            ))}
          </ul>
        </div>
        <ListSection title={t("leftOutTitle")} items={mvp.left_out_for_now} />
        <ListSection title={t("howToTestTitle")} items={mvp.how_to_test} />
      </div>
    </>
  );
}

function ProductView({
  ventureId,
  mvp,
  product,
}: {
  ventureId: string;
  mvp: MvpAnalysis;
  product: NonNullable<MvpAnalysis["physical_product"]>;
}) {
  const t = useTranslations("Mvp");
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="mvp-product">
      <figure className="flex flex-col gap-1">
        {mvp.image ? (
          // A generated asset served by the API (not a static file), so a
          // plain <img> rather than next/image.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={assetUrl(ventureId, mvp.image.asset_id)}
            alt={t("productImageAlt", { name: mvp.name, tagline: mvp.tagline })}
            className="aspect-square w-full rounded-md border bg-white object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-white p-6 text-center">
            <Package aria-hidden className="size-10 text-slate-400" />
            {mvp.image_failed && <p className="text-sm text-amber-800">{t("imageFailed")}</p>}
          </div>
        )}
        <figcaption className="text-muted-foreground text-xs">{t("imageCaption")}</figcaption>
      </figure>
      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <dt className="font-semibold">{t("materials")}</dt>
          <dd>{product.materials.join(", ")}</dd>
        </div>
        <div>
          <dt className="font-semibold">{t("dimensions")}</dt>
          <dd>{product.dimensions}</dd>
        </div>
        <div>
          <dt className="font-semibold">{t("components")}</dt>
          <dd>
            <ul className="list-disc pl-5">
              {product.components.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="font-semibold">{t("prototypeRoute")}</dt>
          <dd>{product.prototype_route}</dd>
        </div>
      </dl>
    </div>
  );
}

/** A sample landing page in a browser frame, drawn from structured content. */
export function WebsiteMockup({ mockup }: { mockup: WebsiteMockupContent }) {
  const t = useTranslations("Mvp");
  // The server already validates colours; check again before they reach style.
  const primary = HEX.test(mockup.primary_color) ? mockup.primary_color : "#1d4ed8";
  const accent = HEX.test(mockup.accent_color) ? mockup.accent_color : "#f59e0b";
  const onPrimary = readableTextOn(primary);
  const onAccent = readableTextOn(accent);
  const host = `${mockup.brand_name.toLowerCase().replace(/[^a-z0-9]+/g, "") || "brand"}.example`;

  return (
    <figure
      // A thick dark-blue frame marks where the mock-up starts and ends.
      className="overflow-hidden rounded-lg border-4 border-blue-900 bg-white shadow-sm"
      aria-label={t("mockupTitle", { brand: mockup.brand_name })}
      data-testid="website-mockup"
    >
      <div className="flex items-center gap-2 border-b bg-slate-100 px-3 py-2">
        <span aria-hidden className="flex gap-1">
          <span className="size-2.5 rounded-full bg-red-400" />
          <span className="size-2.5 rounded-full bg-amber-400" />
          <span className="size-2.5 rounded-full bg-green-400" />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1 rounded bg-white px-2 py-0.5 text-xs text-slate-600">
          <Lock aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{host}</span>
        </span>
        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
          {t("mockupLabel")}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <span className="font-bold" style={{ color: primary }}>
          {mockup.brand_name}
        </span>
        <nav aria-hidden className="flex flex-wrap gap-3 text-xs text-slate-600">
          {mockup.nav_items.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </nav>
      </div>

      <div className="px-4 py-10 text-center sm:px-10" style={{ backgroundColor: primary, color: onPrimary }}>
        <p className="text-2xl font-bold sm:text-3xl" data-testid="mockup-headline">
          {mockup.hero_headline}
        </p>
        <p className="mx-auto mt-2 max-w-xl text-sm opacity-90">{mockup.hero_subheadline}</p>
        <span
          aria-hidden
          className="mt-5 inline-block rounded-full px-5 py-2 text-sm font-semibold shadow"
          style={{ backgroundColor: accent, color: onAccent }}
          data-testid="mockup-cta"
        >
          {mockup.cta_label}
        </span>
      </div>

      <div className="grid gap-3 px-4 py-6 sm:grid-cols-2 lg:grid-cols-3">
        {mockup.features.map((feature) => {
          const Icon = MOCKUP_ICONS[feature.icon] ?? Sparkles;
          return (
            <div key={feature.title} className="rounded-md border p-3" data-testid="mockup-feature">
              <Icon aria-hidden className="mb-1 size-5" style={{ color: primary }} />
              <p className="text-sm font-semibold">{feature.title}</p>
              <p className="text-xs text-slate-600">{feature.description}</p>
            </div>
          );
        })}
      </div>

      {mockup.how_it_works.length > 0 && (
        <div className="border-t px-4 py-5">
          <p className="mb-2 text-sm font-semibold">{t("howItWorks")}</p>
          <ol className="grid gap-2 sm:grid-cols-3">
            {mockup.how_it_works.map((step, index) => (
              <li key={index} className="flex items-start gap-2 text-xs">
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ backgroundColor: primary, color: onPrimary }}
                >
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="border-t px-4 py-4 text-center text-sm font-medium">{mockup.pricing_teaser}</div>
      <div className="bg-slate-50 px-4 py-3 text-center text-[11px] text-slate-500">{mockup.footer_note}</div>
    </figure>
  );
}

function ServiceView({ service }: { service: NonNullable<MvpAnalysis["offline_service"]> }) {
  const t = useTranslations("Mvp");
  return (
    <div className="flex flex-col gap-4 rounded-md border bg-white p-4" data-testid="mvp-service">
      <div>
        <h4 className="mb-1 text-sm font-semibold">{t("serviceTitle")}</h4>
        <p className="text-sm leading-relaxed">{service.overview}</p>
      </div>
      <div>
        <h4 className="mb-2 text-sm font-semibold">{t("journeyTitle")}</h4>
        <ol className="flex flex-col gap-2">
          {service.customer_journey.map((step, index) => (
            <li key={index} className="flex items-start gap-3 text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                {index + 1}
              </span>
              <span>
                <span className="font-medium">{step.step}</span>
                <span className="text-muted-foreground block text-xs">{step.what_happens}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <h4 className="mb-1 text-sm font-semibold">{t("deliveryTitle")}</h4>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground text-xs">{t("where")}</dt>
            <dd>{service.delivery.where}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("who")}</dt>
            <dd>{service.delivery.who_delivers}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("when")}</dt>
            <dd>{service.delivery.when}</dd>
          </div>
        </dl>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <ListSection title={t("whatCustomerGets")} items={service.what_customer_gets} />
        <ListSection title={t("resourcesNeeded")} items={service.resources_needed} />
      </div>
      <p className="text-sm">
        <span className="font-semibold">{t("pricing")}:</span> {service.pricing_note}
      </p>
    </div>
  );
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold">{title}</h4>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
