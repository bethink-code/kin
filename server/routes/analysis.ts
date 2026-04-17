import { Router } from "express";
import { db } from "../db";
import { analyses, statements } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { isAuthenticated } from "../auth";
import { audit } from "../auditLog";
import { getActivePrompt } from "../modules/prompts/getPrompt";
import { analyseStatements } from "../modules/analysis/analyse";

const router = Router();
router.use(isAuthenticated);

router.get("/api/analysis/latest", async (req, res) => {
  const user = req.user as { id: string };
  const [row] = await db
    .select()
    .from(analyses)
    .where(eq(analyses.userId, user.id))
    .orderBy(desc(analyses.createdAt))
    .limit(1);
  res.json(row ?? null);
});

router.post("/api/analysis/run", async (req, res) => {
  const user = req.user as { id: string };

  const sts = await db
    .select()
    .from(statements)
    .where(and(eq(statements.userId, user.id), eq(statements.status, "extracted")));

  if (sts.length === 0) {
    return res.status(400).json({ error: "no_statements" });
  }

  const prompt = await getActivePrompt("analysis");
  if (!prompt) {
    return res.status(500).json({ error: "no_active_analysis_prompt" });
  }

  const [created] = await db
    .insert(analyses)
    .values({
      userId: user.id,
      status: "analysing",
      promptVersionId: prompt.id,
      sourceStatementIds: sts.map((s) => s.id) as unknown as object,
    })
    .returning();

  audit({ req, action: "analysis.start", resourceType: "analysis", resourceId: String(created.id) });

  try {
    const { result, usage } = await analyseStatements({
      systemPrompt: prompt.content,
      model: prompt.model,
      statements: sts.map((s) => ({ filename: s.filename, extraction: s.extractionResult })),
    });

    const [finished] = await db
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
      .where(eq(analyses.id, created.id))
      .returning();

    audit({
      req,
      action: "analysis.success",
      resourceType: "analysis",
      resourceId: String(created.id),
      detail: { usage },
    });
    res.json(finished);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    await db
      .update(analyses)
      .set({ status: "failed", errorMessage: message, completedAt: new Date() })
      .where(eq(analyses.id, created.id));
    audit({
      req,
      action: "analysis.failure",
      resourceType: "analysis",
      resourceId: String(created.id),
      outcome: "failure",
      detail: { message },
    });
    res.status(500).json({ error: "analysis_failed", message });
  }
});

export default router;
