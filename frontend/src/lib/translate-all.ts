import { analysisLanguage, cachedTranslation, listStages, listVentures, translateStageAnalysis } from "@/lib/api";

/**
 * Translates the AI content of every stage of every venture into the
 * language, through the server's translation endpoint (which caches each
 * translation next to the original; the original is never changed).
 * Stages already in that language, or already translated, are skipped.
 */
export async function translateAllContent(
  language: "en" | "ko",
  onProgress: (done: number, total: number) => void,
): Promise<{ total: number; failed: number }> {
  const jobs: { ventureId: string; slug: string }[] = [];
  for (const venture of await listVentures()) {
    for (const stage of await listStages(venture.id)) {
      const analysis = stage.ai_analysis;
      if (analysis && analysisLanguage(analysis) !== language && !cachedTranslation(analysis, language)) {
        jobs.push({ ventureId: venture.id, slug: stage.slug });
      }
    }
  }
  let failed = 0;
  onProgress(0, jobs.length);
  for (const [index, job] of jobs.entries()) {
    try {
      await translateStageAnalysis(job.ventureId, job.slug, language);
    } catch {
      failed += 1; // translated later, when the stage is opened
    }
    onProgress(index + 1, jobs.length);
  }
  return { total: jobs.length, failed };
}
