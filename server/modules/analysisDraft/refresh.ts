import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import {
  analysisDrafts,
  analysisClaims,
  analyses,
  conversations,
  statements as statementsTable,
  type Statement,
} from "@shared/schema";
import { getActivePrompt } from "../prompts/getPrompt";
import { buildAnalysisDraft } from "./build";

type ExtractionShape = {
  bankName?: string | null;
  statementPeriodStart?: string | null;
  statementPeriodEnd?: string | null;
  transactions?: unknown[];
};

function summariseStatements(rows: Statement[]) {
  return rows.map((s) => {
    const r = (s.extractionResult as ExtractionShape | null) ?? null;
    return {
      filename: s.filename,
      bankName: r?.bankName ?? null,
      periodStart: r?.statementPeriodStart ?? null,
      periodEnd: r?.statementPeriodEnd ?? null,
      transactionCount: Array.isArray(r?.transactions) ? r.transactions.length : null,
    };
  });
}

/**
 * Kick off a fresh Canvas 2 (analysis-draft) build for `userId`. Inserts an
 * in-progress `analysis_drafts` row, supersedes the prior current draft,
 * returns immediately, and runs the 3-call pipeline in the background.
 *
 * Callable from the HTTP route /api/analysis-draft/refresh AND from the
 * analysis_chat turn hook when Ally returns action=request_regenerate.
 */
export async function refreshCanvas2Draft(
  userId: string,
): Promise<{ draftId: number; status: string }> {
  const [c1Conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  if (!c1Conversation) throw new Error("no_conversation");

  const [c1Analysis] = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.userId, userId), eq(analyses.status, "done")))
    .orderBy(desc(analyses.createdAt))
    .limit(1);
  if (!c1Analysis) throw new Error("no_analysis");

  const userStatements = await db
    .select()
    .from(statementsTable)
    .where(eq(statementsTable.userId, userId));

  const [factsPrompt, prosePrompt, panelsPrompt] = await Promise.all([
    getActivePrompt("analysis_facts"),
    getActivePrompt("analysis_prose"),
    getActivePrompt("analysis_panels"),
  ]);
  if (!factsPrompt || !prosePrompt || !panelsPrompt) {
    throw new Error("no_active_prompts");
  }

  await db
    .update(analysisDrafts)
    .set({ status: "superseded", supersededAt: new Date() })
    .where(
      and(
        eq(analysisDrafts.userId, userId),
        isNull(analysisDrafts.supersededAt),
      ),
    );

  const [created] = await db
    .insert(analysisDrafts)
    .values({
      userId,
      sourceConversationId: c1Conversation.id,
      sourceAnalysisId: c1Analysis.id,
      status: "thinking",
    })
    .returning();

  void (async () => {
    try {
      const out = await buildAnalysisDraft({
        prompts: {
          facts: { id: factsPrompt.id, content: factsPrompt.content, model: factsPrompt.model },
          prose: { id: prosePrompt.id, content: prosePrompt.content, model: prosePrompt.model },
          panels: { id: panelsPrompt.id, content: panelsPrompt.content, model: panelsPrompt.model },
        },
        firstTakeAnalysis: c1Analysis.result,
        conversationProfile: c1Conversation.profile,
        flaggedIssues: c1Conversation.flaggedIssues ?? [],
        statementSummaries: summariseStatements(userStatements),
      });

      await db
        .update(analysisDrafts)
        .set({
          status: "ready",
          facts: out.facts as unknown as object,
          prose: out.prose as unknown as object,
          panels: out.panels as unknown as object,
          inputTokens: out.usage.inputTokens,
          outputTokens: out.usage.outputTokens,
          cacheReadTokens: out.usage.cacheReadTokens,
          cacheCreationTokens: out.usage.cacheCreationTokens,
          promptVersionIds: out.promptVersionIds as unknown as object,
          generatedAt: new Date(),
        })
        .where(eq(analysisDrafts.id, created.id));

      if (out.claims.length > 0) {
        await db.insert(analysisClaims).values(
          out.claims.map((c) => ({
            draftId: created.id,
            kind: c.kind,
            anchorId: c.anchorId,
            label: c.label,
            category: c.category,
            body: c.body,
            evidenceRefs: c.evidenceRefs as unknown as object,
          })),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown_error";
      console.error("[refreshCanvas2Draft] build failed:", err);
      await db
        .update(analysisDrafts)
        .set({ status: "failed", errorMessage: message })
        .where(eq(analysisDrafts.id, created.id));
    }
  })();

  return { draftId: created.id, status: "thinking" };
}
