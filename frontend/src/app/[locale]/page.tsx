"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
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
import { createVenture } from "@/lib/api";

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
    formState: { errors },
  } = useForm<IdeaFormValues>({
    resolver: zodResolver(ideaSchema),
  });

  const mutation = useMutation({
    mutationFn: (values: IdeaFormValues) => createVenture(values.idea),
  });

  async function onSubmit(values: IdeaFormValues) {
    try {
      await mutation.mutateAsync(values);
    } catch {
      // Surfaced via mutation.isError below; nothing further to do here.
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {mutation.isSuccess ? (
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
              {mutation.isError && (
                <p className="text-destructive text-sm" role="alert">
                  {t("errorSubmitFailed")}
                </p>
              )}
              <Button
                type="submit"
                disabled={mutation.isPending}
                className="self-start"
              >
                {mutation.isPending ? t("submitting") : t("submit")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
