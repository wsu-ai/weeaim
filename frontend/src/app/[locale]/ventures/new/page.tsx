"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import {
  ApiError,
  confirmIdea,
  createVenture,
  interpretIdea,
  type IdeaInterpretation,
  type Venture,
} from "@/lib/api";
import { useTokenLimitMessage } from "@/lib/token-limit";

type IdeaFormValues = { idea: string };

export default function IdeaIntakePage() {
  const t = useTranslations("IdeaIntake");
  const tc = useTranslations("IdeaConfirmation");
  const router = useRouter();

  const [ventureId, setVentureId] = useState<string | null>(null);
  const [interpretation, setInterpretation] = useState<IdeaInterpretation | null>(null);

  const ideaSchema = z.object({
    idea: z
      .string()
      .min(20, { message: t("errorTooShort") })
      .max(2000, { message: t("errorTooLong") }),
  });

  const ideaForm = useForm<IdeaFormValues>({ resolver: zodResolver(ideaSchema) });

  const limitMessage = useTokenLimitMessage();
  // The venture saved by an attempt whose AI step failed: trying again with
  // the same idea reuses it instead of saving a duplicate.
  const savedVenture = useRef<Venture | null>(null);

  const submitMutation = useMutation({
    mutationFn: async (values: IdeaFormValues) => {
      const saved = savedVenture.current;
      const venture = saved && saved.original_idea === values.idea ? saved : await createVenture(values.idea);
      savedVenture.current = venture;
      const interp = await interpretIdea(venture.id);
      return { venture, interp };
    },
    onSuccess: ({ venture, interp }) => {
      setVentureId(venture.id);
      setInterpretation(interp);
    },
  });

  // A token cap or AI account problem gets its own message; a service the
  // server says is unavailable gets the server's reason; anything else the
  // generic one.
  function submitErrorMessage(error: unknown): string {
    const limit = limitMessage(error);
    if (limit) return limit;
    if (error instanceof ApiError && error.status === 503 && error.detail) return error.detail;
    return t("errorSubmitFailed");
  }

  const reviewForm = useForm<IdeaInterpretation>();

  useEffect(() => {
    if (interpretation) {
      reviewForm.reset(interpretation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interpretation]);

  const confirmMutation = useMutation({
    mutationFn: (values: IdeaInterpretation) => {
      if (!ventureId) throw new Error("Missing venture id");
      return confirmIdea(ventureId, values);
    },
    onSuccess: () => {
      if (ventureId) router.push(`/ventures/${ventureId}`);
    },
  });

  if (interpretation) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>{tc("title")}</CardTitle>
            <CardDescription>{tc("description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={reviewForm.handleSubmit((values) => confirmMutation.mutate(values))}
              className="flex flex-col gap-3"
              noValidate
            >
              <label htmlFor="review-title" className="text-sm font-medium">
                {tc("fieldTitle")}
              </label>
              <Input id="review-title" {...reviewForm.register("title")} />

              <label htmlFor="review-summary" className="text-sm font-medium">
                {tc("fieldSummary")}
              </label>
              <Textarea id="review-summary" rows={3} {...reviewForm.register("summary")} />

              <label htmlFor="review-industry" className="text-sm font-medium">
                {tc("fieldIndustry")}
              </label>
              <Input id="review-industry" {...reviewForm.register("industry")} />

              <label htmlFor="review-geography" className="text-sm font-medium">
                {tc("fieldGeography")}
              </label>
              <Input id="review-geography" {...reviewForm.register("geography")} />

              <label htmlFor="review-target-customer" className="text-sm font-medium">
                {tc("fieldTargetCustomer")}
              </label>
              <Input id="review-target-customer" {...reviewForm.register("target_customer")} />

              <label htmlFor="review-problem-hypothesis" className="text-sm font-medium">
                {tc("fieldProblemHypothesis")}
              </label>
              <Textarea
                id="review-problem-hypothesis"
                rows={2}
                {...reviewForm.register("problem_hypothesis")}
              />

              {confirmMutation.isError && (
                <p className="text-destructive text-sm" role="alert">
                  {tc("errorConfirmFailed")}
                </p>
              )}

              <Button type="submit" disabled={confirmMutation.isPending} className="self-start">
                {confirmMutation.isPending ? tc("confirming") : tc("confirm")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {submitMutation.isPending ? (
            <p role="status">{tc("loading")}</p>
          ) : (
            <form
              onSubmit={ideaForm.handleSubmit((values) => submitMutation.mutate(values))}
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
                aria-invalid={!!ideaForm.formState.errors.idea}
                {...ideaForm.register("idea")}
              />
              {ideaForm.formState.errors.idea && (
                <p className="text-destructive text-sm" role="alert">
                  {ideaForm.formState.errors.idea.message}
                </p>
              )}
              {submitMutation.isError && (
                <p className="text-destructive text-sm" role="alert">
                  {submitErrorMessage(submitMutation.error)}
                </p>
              )}
              <Button type="submit" className="self-start">
                {t("submit")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
