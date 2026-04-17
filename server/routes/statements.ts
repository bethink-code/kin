import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { statements } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { isAuthenticated } from "../auth";
import { audit } from "../auditLog";
import { getActivePrompt } from "../modules/prompts/getPrompt";
import { extractStatement } from "../modules/extraction/extract";

const router = Router();
router.use(isAuthenticated);

const uploadSchema = z.object({
  filename: z.string().min(1),
  pdfBase64: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().optional(),
  contentHash: z.string().length(64),
});

router.post("/api/statements/upload", async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }

  const user = req.user as { id: string };

  // Dedupe — if this user has already uploaded this exact PDF, short-circuit.
  const [existing] = await db
    .select()
    .from(statements)
    .where(and(eq(statements.userId, user.id), eq(statements.contentHash, parsed.data.contentHash)))
    .limit(1);
  if (existing) {
    audit({
      req,
      action: "statement.upload_duplicate",
      resourceType: "statement",
      resourceId: String(existing.id),
    });
    return res.status(200).json({ ...existing, wasDuplicate: true });
  }

  const prompt = await getActivePrompt("extraction");
  if (!prompt) {
    return res.status(500).json({ error: "no_active_extraction_prompt" });
  }

  const [created] = await db
    .insert(statements)
    .values({
      userId: user.id,
      filename: parsed.data.filename,
      sizeBytes: parsed.data.sizeBytes,
      contentHash: parsed.data.contentHash,
      status: "extracting",
      promptVersionId: prompt.id,
    })
    .returning();

  audit({ req, action: "statement.upload_start", resourceType: "statement", resourceId: String(created.id) });

  try {
    const { result, usage } = await extractStatement({
      pdfBase64: parsed.data.pdfBase64,
      systemPrompt: prompt.content,
      model: prompt.model,
    });

    const [finished] = await db
      .update(statements)
      .set({
        status: "extracted",
        extractionResult: result as unknown as object,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        completedAt: new Date(),
      })
      .where(eq(statements.id, created.id))
      .returning();

    audit({
      req,
      action: "statement.extraction_success",
      resourceType: "statement",
      resourceId: String(created.id),
      detail: { usage },
    });

    res.json(finished);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    await db
      .update(statements)
      .set({ status: "failed", extractionError: message, completedAt: new Date() })
      .where(eq(statements.id, created.id));

    audit({
      req,
      action: "statement.extraction_failure",
      resourceType: "statement",
      resourceId: String(created.id),
      outcome: "failure",
      detail: { message },
    });

    res.status(500).json({ error: "extraction_failed", message });
  }
});

router.get("/api/statements", async (req, res) => {
  const user = req.user as { id: string };
  const rows = await db
    .select()
    .from(statements)
    .where(eq(statements.userId, user.id))
    .orderBy(desc(statements.createdAt));
  res.json(rows);
});

router.get("/api/statements/:id", async (req, res) => {
  const user = req.user as { id: string };
  const id = Number(req.params.id);
  const [row] = await db
    .select()
    .from(statements)
    .where(and(eq(statements.id, id), eq(statements.userId, user.id)));
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json(row);
});

export default router;
