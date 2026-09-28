"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export default function IdeaIntakePage() {
  const t = useTranslations("IdeaIntake");

  const ideaSchema = z.object({
    idea: z
      .string()
      .min(20, { message: t("errorTooShort") })
      .max(2000, { message: t("errorTooLong") }),
  });
  type IdeaFormValues = z.infer<typeof ideaSchema>;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isSubmitSuccessful },
  } = useForm<IdeaFormValues>({
    resolver: zodResolver(ideaSchema),
  });

  // Mocked submission for the Phase 5 vertical slice: no backend call yet.
  // Phase 6 replaces this with a real POST /api/ventures via react-query.
  async function onSubmit() {
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isSubmitSuccessful ? (
            <div role="status">
              <h2 className="font-semibold">{t("confirmationTitle")}</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {t("confirmationBody")}
              </p>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="flex flex-col gap-3"
              noValidate
            >
              <label htmlFor="idea" className="text-sm font-medium">
                {t("label")}
              </label>
              <Textarea
                id="idea"
                rows={6}
                placeholder={t("placeholder")}
                aria-invalid={!!errors.idea}
                {...register("idea")}
              />
              {errors.idea && (
                <p className="text-destructive text-sm" role="alert">
                  {errors.idea.message}
                </p>
              )}
              <Button type="submit" disabled={isSubmitting} className="self-start">
                {isSubmitting ? t("submitting") : t("submit")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
