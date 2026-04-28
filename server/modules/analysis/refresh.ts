import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { analyses, analysisClaims, conversations, statements, subSteps } from "@shared/schema";
import { getActivePrompt } from "../prompts/getPrompt";
import { analyseStatements } from "./analyse";

/**
 * Kick off a fresh Canvas 1 analyse pass for `userId`. Inserts an in-progress
 * `analyses` row, returns its id immediately, and runs the actual work in the
 * background — the new analysis lands on /api/analysis/latest when ready.
 *
 * Callable from the HTTP route /api/analysis/refresh AND from the qa chat
 * turn hook when Ally returns triggerRefresh=true.
 */
export async function refreshCanvas1Analysis(
  userId: string,
): Promise<{ analysisId: number; status: string }> {
  const sts = await db
    .select()
    .from(statements)
    .where(and(eq(statements.userId, userId), eq(statements.status, "extracted")));
  if (sts.length === 0) throw new Error("no_statements");

  const prompt = await getActivePrompt("analysis");
  if (!prompt) throw new Error("no_active_analysis_prompt");

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .limit(1);

  const [created] = await db
    .insert(analyses)
    .values({
      userId,
      status: "analysing",
      promptVersionId: prompt.id,
      sourceStatementIds: sts.map((s) => s.id) as unknown as object,
    })
    .returning();

  void (async () => {
    try {
      const { result, usage } = await analyseStatements({
        systemPrompt: prompt.content,
        model: prompt.model,
        statements: sts.map((s) => ({ filename: s.filename, extraction: s.extractionResult })),
        conversationProfile: conv?.profile ?? null,
        flaggedIssues: conv?.flaggedIssues ?? [],
      });
      await db
        .update(analyses)
        .set({
          status: "done",
          result: result as unknown as object,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          completedAt: new Date(),
        })
        .where(eq(analyses.id, created.id));

      await persistAnalysisClaims(created.id, result);

      await db
        .update(subSteps)
        .set({
          contentJson: { analysisId: created.id } as unknown as object,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(subSteps.userId, userId),
            eq(subSteps.canvasKey, "picture"),
            isNull(subSteps.supersededAt),
          ),
        );
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown_error";
      console.error("[refreshCanvas1Analysis] failed:", err);
      await db
        .update(analyses)
        .set({ status: "failed", errorMessage: message, completedAt: new Date() })
        .where(eq(analyses.id, created.id));
    }
  })();

  return { analysisId: created.id, status: "analysing" };
}

// Persist Canvas 1 explain claims for an analyses row. Used by both /run +
// /refresh paths; the sub-step worker has its own (functionally-equivalent)
// copy. All three feed the same analysis_claims table with analysis_id set.
export async function persistAnalysisClaims(analysisId: number, result: unknown): Promise<void> {
  type Claim = {
    anchorId: string;
    label: string;
    body: string;
    evidenceRefs: Array<{ kind: string; ref: string }>;
    chartKind: string;
  };
  type Annotation = { kind: string; phrase: string; anchorId: string };
  const r = result as {
    explainClaims?: Claim[];
    lifeSnapshotAnnotations?: Annotation[];
    income?: { summaryAnnotations?: Annotation[] };
    spending?: { summaryAnnotations?: Annotation[] };
    savings?: { summaryAnnotations?: Annotation[] };
  };
  const claims = r.explainClaims ?? [];
  if (claims.length === 0) return;

  const phraseByAnchor = new Map<string, string>();
  for (const a of r.lifeSnapshotAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);
  for (const a of r.income?.summaryAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);
  for (const a of r.spending?.summaryAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);
  for (const a of r.savings?.summaryAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);

  await db.insert(analysisClaims).values(
    claims.map((c) => ({
      analysisId,
      kind: "explain" as const,
      anchorId: c.anchorId,
      label: phraseByAnchor.get(c.anchorId) ?? c.label,
      body: c.body,
      evidenceRefs: { refs: c.evidenceRefs, chartKind: c.chartKind } as unknown as object,
    })),
  );
}
