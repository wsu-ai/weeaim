"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Palette, Plus, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { MOCKUP_ICONS, WebsiteMockup } from "@/components/mvp-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/i18n/navigation";
import {
  getVenture,
  isMvp,
  listStages,
  updateStage,
  type MockupIcon,
  type WebsiteMockup as Design,
} from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";

// The same limits the server checks (backend/app/wizard/schemas.py MockupDesign).
const LIMITS = {
  brand_name: 40,
  hero_headline: 90,
  hero_subheadline: 200,
  cta_label: 30,
  nav_item: 30,
  feature_title: 60,
  feature_description: 240,
  step: 200,
  pricing_teaser: 200,
  footer_note: 200,
};
const MAX_NAV = 5;
const MIN_FEATURES = 2;
const MAX_FEATURES = 6;
const MAX_STEPS = 5;
const HEX = /^#[0-9a-fA-F]{6}$/;
const ICONS = Object.keys(MOCKUP_ICONS) as MockupIcon[];

/** Problems that would stop the design from saving (the server checks again). */
function problems(design: Design): string[] {
  const found: string[] = [];
  if (!design.brand_name.trim()) found.push("brandRequired");
  if (!design.hero_headline.trim()) found.push("headlineRequired");
  if (!design.cta_label.trim()) found.push("ctaRequired");
  if (!HEX.test(design.primary_color) || !HEX.test(design.accent_color)) found.push("badColor");
  if (design.features.some((f) => !f.title.trim())) found.push("featureTitleRequired");
  const tooLong =
    design.brand_name.length > LIMITS.brand_name ||
    design.hero_headline.length > LIMITS.hero_headline ||
    design.hero_subheadline.length > LIMITS.hero_subheadline ||
    design.cta_label.length > LIMITS.cta_label ||
    design.pricing_teaser.length > LIMITS.pricing_teaser ||
    design.footer_note.length > LIMITS.footer_note ||
    design.nav_items.some((item) => item.length > LIMITS.nav_item) ||
    design.how_it_works.some((step) => step.length > LIMITS.step) ||
    design.features.some((f) => f.title.length > LIMITS.feature_title || f.description.length > LIMITS.feature_description);
  if (tooLong) found.push("tooLong");
  return found;
}

/** Empty menu items and steps are dropped when saving. */
function tidy(design: Design): Design {
  return {
    ...design,
    brand_name: design.brand_name.trim(),
    nav_items: design.nav_items.map((item) => item.trim()).filter(Boolean),
    how_it_works: design.how_it_works.map((step) => step.trim()).filter(Boolean),
    features: design.features.map((f) => ({ ...f, title: f.title.trim(), description: f.description.trim() })),
  };
}

/**
 * The Design Studio: edit the Stage 10 website mock-up -- brand, colours,
 * wording and features -- with a live preview, and save it as the founder's
 * own design. The AI's original stays in the stage and can be restored.
 */
export default function DesignStudioPage() {
  const t = useTranslations("DesignStudio");
  const { ventureId } = useParams<{ ventureId: string }>();
  const ventureQuery = useQuery({ queryKey: ["venture", ventureId], queryFn: () => getVenture(ventureId) });
  const stagesQuery = useQuery({ queryKey: ["stages", ventureId], queryFn: () => listStages(ventureId) });
  const mvpStage = stagesQuery.data?.find((s) => s.slug === "mvp");
  const analysis = mvpStage && isMvp(mvpStage.ai_analysis) ? mvpStage.ai_analysis : null;
  const original = analysis?.offering_type === "online_service" ? (analysis.website_mockup ?? null) : null;
  const saved = (mvpStage?.answers?.mockup_design as Design | undefined) ?? null;
  const backHref = `/ventures/${ventureId}?stage=mvp`;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={backHref} className="text-sm text-blue-700 hover:underline">
            ← {t("back")}
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold">
            <Palette aria-hidden className="size-6 text-blue-900" />
            {t("title")}
          </h1>
          {ventureQuery.data && <p className="text-muted-foreground text-sm">{ventureQuery.data.title}</p>}
        </div>
      </div>

      {stagesQuery.isPending && <p className="text-muted-foreground text-sm">{t("loading")}</p>}
      {stagesQuery.isError && (
        <p role="alert" className="text-destructive text-sm">
          {t("loadFailed")}
        </p>
      )}
      {stagesQuery.isSuccess && !original && (
        <div className="rounded-md border bg-white p-4 text-sm">
          <p>{t("noMockup")}</p>
          <Link href={backHref} className="mt-2 inline-block font-medium text-blue-700 hover:underline">
            {t("back")} →
          </Link>
        </div>
      )}
      {mvpStage && original && (
        <Studio
          key={JSON.stringify(saved)}
          ventureId={ventureId}
          answers={mvpStage.answers ?? {}}
          original={original}
          saved={saved}
        />
      )}
    </main>
  );
}

function Studio({
  ventureId,
  answers,
  original,
  saved,
}: {
  ventureId: string;
  answers: Record<string, unknown>;
  original: Design;
  saved: Design | null;
}) {
  const t = useTranslations("DesignStudio");
  const tLogin = useTranslations("Login");
  const queryClient = useQueryClient();
  const start = saved ?? original;
  const [design, setDesign] = useState<Design>(start);
  const dirty = JSON.stringify(design) !== JSON.stringify(start);
  const issues = problems(design);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const saveMutation = useMutation({
    mutationFn: (next: Design | null) =>
      updateStage(ventureId, "mvp", { answers: { ...answers, mockup_design: next }, complete: false }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["stages", ventureId] }),
  });

  const set = <K extends keyof Design>(key: K, value: Design[K]) => setDesign((d) => ({ ...d, [key]: value }));
  const setFeature = (index: number, change: Partial<Design["features"][number]>) =>
    set("features", design.features.map((f, i) => (i === index ? { ...f, ...change } : f)));
  const moveFeature = (index: number, by: -1 | 1) => {
    const features = [...design.features];
    [features[index], features[index + by]] = [features[index + by], features[index]];
    set("features", features);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <form
        className="flex flex-col gap-4"
        aria-label={t("editorLabel")}
        onSubmit={(e) => {
          e.preventDefault();
          if (issues.length === 0) saveMutation.mutate(tidy(design));
        }}
      >
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-white/95 p-3 backdrop-blur" data-testid="studio-toolbar">
          <Button type="submit" disabled={!dirty || issues.length > 0 || saveMutation.isPending}>
            {saveMutation.isPending ? t("saving") : t("save")}
          </Button>
          <Button type="button" variant="outline" disabled={!dirty} onClick={() => setDesign(start)}>
            <Undo2 aria-hidden className="size-4" />
            {t("discard")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={JSON.stringify(design) === JSON.stringify(original)}
            onClick={() => setDesign(original)}
          >
            <RotateCcw aria-hidden className="size-4" />
            {t("resetToOriginal")}
          </Button>
          <span className="text-muted-foreground text-xs" role="status">
            {saveMutation.isPending ? "" : dirty ? t("unsaved") : saveMutation.isSuccess ? t("saved") : saved ? t("yourDesign") : t("aiOriginal")}
          </span>
        </div>
        {issues.length > 0 && (
          <ul role="alert" className="list-disc rounded-md border border-red-200 bg-red-50 py-2 pr-3 pl-7 text-sm text-red-800">
            {issues.map((issue) => (
              <li key={issue}>{t(`problems.${issue}`)}</li>
            ))}
          </ul>
        )}
        {saveMutation.isError && (
          <p role="alert" className="text-destructive text-sm">
            {authErrorMessage(saveMutation.error, tLogin)}
          </p>
        )}

        <Section title={t("brandSection")}>
          <TextField id="brand_name" label={t("brandName")} value={design.brand_name} limit={LIMITS.brand_name} onChange={(v) => set("brand_name", v)} />
          <div className="grid grid-cols-2 gap-3">
            <ColorField id="primary_color" label={t("primaryColor")} value={design.primary_color} onChange={(v) => set("primary_color", v)} />
            <ColorField id="accent_color" label={t("accentColor")} value={design.accent_color} onChange={(v) => set("accent_color", v)} />
          </div>
        </Section>

        <Section title={t("menuSection")}>
          <ListEditor
            idPrefix="nav"
            items={design.nav_items}
            max={MAX_NAV}
            limit={LIMITS.nav_item}
            itemLabel={(n) => t("menuItem", { n })}
            addLabel={t("addMenuItem")}
            removeLabel={(n) => t("removeMenuItem", { n })}
            onChange={(items) => set("nav_items", items)}
          />
        </Section>

        <Section title={t("heroSection")}>
          <TextField id="hero_headline" label={t("headline")} value={design.hero_headline} limit={LIMITS.hero_headline} onChange={(v) => set("hero_headline", v)} />
          <TextField id="hero_subheadline" label={t("subheadline")} value={design.hero_subheadline} limit={LIMITS.hero_subheadline} multiline onChange={(v) => set("hero_subheadline", v)} />
          <TextField id="cta_label" label={t("ctaLabel")} value={design.cta_label} limit={LIMITS.cta_label} onChange={(v) => set("cta_label", v)} />
        </Section>

        <Section title={t("featuresSection")}>
          {design.features.map((feature, index) => {
            const Icon = MOCKUP_ICONS[feature.icon];
            const n = index + 1;
            return (
              <fieldset key={index} className="flex flex-col gap-2 rounded-md border bg-slate-50/60 p-3" data-testid={`feature-${index}`}>
                <legend className="flex w-full items-center justify-between gap-2 px-1 text-sm font-semibold">
                  <span className="flex items-center gap-2">
                    {Icon && <Icon aria-hidden className="size-4 text-blue-900" />}
                    {t("featureN", { n })}
                  </span>
                  <span className="flex gap-1">
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={t("moveUp", { n })} disabled={index === 0} onClick={() => moveFeature(index, -1)}>
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={t("moveDown", { n })} disabled={index === design.features.length - 1} onClick={() => moveFeature(index, 1)}>
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={t("removeFeature", { n })} disabled={design.features.length <= MIN_FEATURES} onClick={() => set("features", design.features.filter((_, i) => i !== index))}>
                      <Trash2 aria-hidden />
                    </Button>
                  </span>
                </legend>
                <TextField id={`feature-${index}-title`} label={t("featureTitle")} value={feature.title} limit={LIMITS.feature_title} onChange={(v) => setFeature(index, { title: v })} />
                <TextField id={`feature-${index}-description`} label={t("featureDescription")} value={feature.description} limit={LIMITS.feature_description} multiline onChange={(v) => setFeature(index, { description: v })} />
                <label htmlFor={`feature-${index}-icon`} className="text-xs font-medium">
                  {t("featureIcon")}
                </label>
                <select
                  id={`feature-${index}-icon`}
                  className="border-input h-9 rounded-md border bg-white px-2 text-sm"
                  value={feature.icon}
                  onChange={(e) => setFeature(index, { icon: e.target.value as MockupIcon })}
                >
                  {ICONS.map((icon) => (
                    <option key={icon} value={icon}>
                      {t(`icons.${icon}`)}
                    </option>
                  ))}
                </select>
              </fieldset>
            );
          })}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={design.features.length >= MAX_FEATURES}
              onClick={() => set("features", [...design.features, { title: "", description: "", icon: "sparkles" }])}
            >
              <Plus aria-hidden className="size-4" />
              {t("addFeature")}
            </Button>
            <span className="text-muted-foreground ml-2 text-xs">{t("featureLimits")}</span>
          </div>
        </Section>

        <Section title={t("stepsSection")}>
          <ListEditor
            idPrefix="step"
            items={design.how_it_works}
            max={MAX_STEPS}
            limit={LIMITS.step}
            itemLabel={(n) => t("step", { n })}
            addLabel={t("addStep")}
            removeLabel={(n) => t("removeStep", { n })}
            onChange={(items) => set("how_it_works", items)}
          />
        </Section>

        <Section title={t("closingSection")}>
          <TextField id="pricing_teaser" label={t("pricingTeaser")} value={design.pricing_teaser} limit={LIMITS.pricing_teaser} onChange={(v) => set("pricing_teaser", v)} />
          <TextField id="footer_note" label={t("footerNote")} value={design.footer_note} limit={LIMITS.footer_note} onChange={(v) => set("footer_note", v)} />
        </Section>
      </form>

      <section aria-labelledby="preview-title" className="lg:sticky lg:top-4 lg:self-start">
        <h2 id="preview-title" className="mb-2 text-sm font-semibold">
          {t("preview")}
        </h2>
        <div data-testid="studio-preview">
          <WebsiteMockup mockup={design} />
        </div>
      </section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border bg-white p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function TextField({
  id,
  label,
  value,
  limit,
  multiline = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  limit: number;
  multiline?: boolean;
  onChange: (value: string) => void;
}) {
  const over = value.length > limit;
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium">
          {label}
        </label>
        <span className={`text-xs tabular-nums ${over ? "font-semibold text-red-700" : "text-muted-foreground"}`}>
          {value.length}/{limit}
        </span>
      </span>
      {multiline ? (
        <Textarea id={id} rows={2} value={value} aria-invalid={over} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input id={id} value={value} aria-invalid={over} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <span className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={HEX.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border bg-white p-0.5"
        />
        <Input id={id} value={value} maxLength={7} aria-invalid={!HEX.test(value)} onChange={(e) => onChange(e.target.value.trim())} />
      </span>
    </div>
  );
}

function ListEditor({
  idPrefix,
  items,
  max,
  limit,
  itemLabel,
  addLabel,
  removeLabel,
  onChange,
}: {
  idPrefix: string;
  items: string[];
  max: number;
  limit: number;
  itemLabel: (n: number) => string;
  addLabel: string;
  removeLabel: (n: number) => string;
  onChange: (items: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, index) => (
        <div key={index} className="flex items-end gap-2">
          <div className="flex-1">
            <TextField
              id={`${idPrefix}-${index}`}
              label={itemLabel(index + 1)}
              value={item}
              limit={limit}
              onChange={(value) => onChange(items.map((x, i) => (i === index ? value : x)))}
            />
          </div>
          <Button type="button" size="icon-sm" variant="ghost" aria-label={removeLabel(index + 1)} onClick={() => onChange(items.filter((_, i) => i !== index))}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="outline" size="sm" disabled={items.length >= max} onClick={() => onChange([...items, ""])}>
          <Plus aria-hidden className="size-4" />
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
