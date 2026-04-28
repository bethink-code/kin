import { Router } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  analysisDrafts,
  analysisClaims,
  analysisConversations,
  analyses,
  conversations,
  statements as statementsTable,
  type AnalysisDraft,
  type Statement,
} from "@shared/schema";
import { isAuthenticated } from "../auth";
import { audit } from "../auditLog";
import { getActivePrompt } from "../modules/prompts/getPrompt";
import { buildAnalysisDraft } from "../modules/analysisDraft/build";
import { refreshCanvas2Draft } from "../modules/analysisDraft/refresh";

const router = Router();
router.use(isAuthenticated);

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

async function getCurrentDraft(userId: string): Promise<AnalysisDraft | null> {
  const [row] = await db
    .select()
    .from(analysisDrafts)
    .where(and(eq(analysisDrafts.userId, userId), isNull(analysisDrafts.supersededAt)))
    .orderBy(desc(analysisDrafts.createdAt))
    .limit(1);
  return row ?? null;
}

// POST /api/analysis-draft/generate — idempotent
router.post("/api/analysis-draft/generate", async (req, res) => {
  const user = req.user as { id: string };

  const existing = await getCurrentDraft(user.id);
  if (existing && existing.status !== "failed") {
    return res.json(existing);
  }

  const [c1Conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.userId, user.id), eq(conversations.status, "complete")))
    .orderBy(desc(conversations.completedAt))
    .limit(1);
  if (!c1Conversation) return res.status(400).json({ error: "canvas_1_not_agreed" });

  const [c1Analysis] = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.userId, user.id), eq(analyses.status, "done")))
    .orderBy(desc(analyses.createdAt))
    .limit(1);
  if (!c1Analysis) return res.status(400).json({ error: "no_analysis" });

  const userStatements = await db
    .select()
    .from(statementsTable)
    .where(eq(statementsTable.userId, user.id));

  const [factsPrompt, prosePrompt, panelsPrompt] = await Promise.all([
    getActivePrompt("analysis_facts"),
    getActivePrompt("analysis_prose"),
    getActivePrompt("analysis_panels"),
  ]);
  if (!factsPrompt || !prosePrompt || !panelsPrompt) {
    return res.status(500).json({ error: "no_active_prompts" });
  }

  const [created] = await db
    .insert(analysisDrafts)
    .values({
      userId: user.id,
      sourceConversationId: c1Conversation.id,
      sourceAnalysisId: c1Analysis.id,
      status: "thinking",
    })
    .returning();

  audit({
    req,
    action: "analysis_draft.generate.start",
    resourceType: "analysis_draft",
    resourceId: String(created.id),
  });

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

    const [finished] = await db
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
      .where(and(eq(analysisDrafts.id, created.id), eq(analysisDrafts.userId, user.id)))
      .returning();

    // Claim rows — explain + note references inline in prose/panels.
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
    // Notes raised in facts but not inline-annotated — still captured so Notes mode sees them.
    const inlinedAnchorIds = new Set(
      out.claims.filter((c) => c.kind === "note").map((c) => c.anchorId),
    );
    const unreferencedNotes = out.notes.filter((n) => !inlinedAnchorIds.has(n.anchorId));
    if (unreferencedNotes.length > 0) {
      await db.insert(analysisClaims).values(
        unreferencedNotes.map((n) => ({
          draftId: created.id,
          kind: "note" as const,
          anchorId: n.anchorId,
          label: n.label,
          category: n.category,
          body: n.body,
          evidenceRefs: n.evidenceRefs as unknown as object,
        })),
      );
    }

    audit({
      req,
      action: "analysis_draft.generate.success",
      resourceType: "analysis_draft",
      resourceId: String(created.id),
      detail: { usage: out.usage },
    });
    res.json(finished);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[analysis_draft.generate] build failed:", err);
    await db
      .update(analysisDrafts)
      .set({ status: "failed", errorMessage: message })
      .where(and(eq(analysisDrafts.id, created.id), eq(analysisDrafts.userId, user.id)));
    audit({
      req,
      action: "analysis_draft.generate.failure",
      resourceType: "analysis_draft",
      resourceId: String(created.id),
      outcome: "failure",
      detail: { message },
    });
    res.status(500).json({ error: "generate_failed", message });
  }
});

// GET /api/analysis-draft/current
router.get("/api/analysis-draft/current", async (req, res) => {
  const user = req.user as { id: string };
  const draft = await getCurrentDraft(user.id);
  res.json(draft ?? null);
});

// GET /api/analysis-draft/:id — user's own drafts only (history / past view)
router.get("/api/analysis-draft/:id", async (req, res) => {
  const user = req.user as { id: string };
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  const [row] = await db
    .select()
    .from(analysisDrafts)
    .where(and(eq(analysisDrafts.id, id), eq(analysisDrafts.userId, user.id)))
    .limit(1);
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json(row);
});

// POST /api/analysis-draft/:id/agree
router.post("/api/analysis-draft/:id/agree", async (req, res) => {
  const user = req.user as { id: string };
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });

  const [row] = await db
    .select()
    .from(analysisDrafts)
    .where(and(eq(analysisDrafts.id, id), eq(analysisDrafts.userId, user.id)))
    .limit(1);
  if (!row) return res.status(404).json({ error: "not_found" });
  if (row.status !== "ready") {
    return res.status(400).json({ error: "not_ready", status: row.status });
  }

  const [agreed] = await db
    .update(analysisDrafts)
    .set({ status: "agreed", agreedAt: new Date() })
    .where(and(eq(analysisDrafts.id, id), eq(analysisDrafts.userId, user.id)))
    .returning();

  await db
    .update(analysisConversations)
    .set({ status: "complete", completedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(analysisConversations.userId, user.id),
        eq(analysisConversations.draftId, id),
        eq(analysisConversations.status, "active"),
      ),
    );

  audit({
    req,
    action: "analysis_draft.agree",
    resourceType: "analysis_draft",
    resourceId: String(id),
  });
  res.json(agreed);
});

// POST /api/analysis-draft/:id/reopen — supersede current, client calls /generate next
router.post("/api/analysis-draft/:id/reopen", async (req, res) => {
  const user = req.user as { id: string };
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });

  const [row] = await db
    .select()
    .from(analysisDrafts)
    .where(and(eq(analysisDrafts.id, id), eq(analysisDrafts.userId, user.id)))
    .limit(1);
  if (!row) return res.status(404).json({ error: "not_found" });
  if (row.status !== "ready" && row.status !== "agreed") {
    return res.status(400).json({ error: "not_reopenable", status: row.status });
  }

  await db
    .update(analysisDrafts)
    .set({ status: "superseded", supersededAt: new Date() })
    .where(and(eq(analysisDrafts.id, id), eq(analysisDrafts.userId, user.id)));

  audit({
    req,
    action: "analysis_draft.reopen",
    resourceType: "analysis_draft",
    resourceId: String(id),
  });
  res.json({ ok: true });
});

// POST /api/analysis-draft/refresh — regenerate the Phase 2 draft using
// the latest conversation profile + analysis chat notes. Used by:
//   1. Manual "Refresh" button on the analysis artefact pane
//   2. Auto-trigger from analysis_chat when action=request_regenerate
//
// Inserts a NEW analysis_drafts row, runs the 3-call pipeline in the
// background. Old draft marked superseded. Client polls
// /api/analysis-draft/current to see the new draft when it lands.
router.post("/api/analysis-draft/refresh", async (req, res) => {
  const user = req.user as { id: string };
  try {
    const result = await refreshCanvas2Draft(user.id);
    audit({
      req,
      action: "analysis_draft.refresh.start",
      resourceType: "analysis_draft",
      resourceId: String(result.draftId),
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(400).json({ error: "refresh_failed", message });
  }
});

// GET /api/analysis-draft/:id/claims
router.get("/api/analysis-draft/:id/claims", async (req, res) => {
  const user = req.user as { id: string };
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });

  // Ownership check first — do not leak draft existence via claims endpoint.
  const [draft] = await db
    .select()
    .from(analysisDrafts)
    .where(and(eq(analysisDrafts.id, id), eq(analysisDrafts.userId, user.id)))
    .limit(1);
  if (!draft) return res.status(404).json({ error: "not_found" });

  const rows = await db
    .select()
    .from(analysisClaims)
    .where(eq(analysisClaims.draftId, id));
  res.json(rows);
});

export default router;
