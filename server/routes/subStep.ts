import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  subSteps,
  subStepMessages,
  analyses,
  analysisDrafts,
  analysisClaims,
  analysisConversations,
  statements as statementsTable,
  conversations,
  type SubStep,
  type Statement,
} from "@shared/schema";
import { isAuthenticated } from "../auth";
import { audit } from "../auditLog";
import { getActivePrompt } from "../modules/prompts/getPrompt";
import { analyseStatements } from "../modules/analysis/analyse";
import { buildAnalysisDraft } from "../modules/analysisDraft/build";
import type { QaProfile } from "../modules/qa/schema";
import {
  getCurrentSubStep,
  advanceSubStep,
  agreeSubStep,
  reopenSubStep,
  markAnalyseError,
  clearAnalyseError,
} from "../modules/subStep/orchestrator";
import { onStateChange } from "../modules/stateChange";
import { deriveChecklist } from "../modules/checklist";
import { writeNote } from "../modules/record";

const router = Router();
router.use(isAuthenticated);

// GET /api/sub-step/current — returns active sub-step + its messages.
// Kicks off Ally-at-work if this is the first fetch of a freshly-created
// Analyse sub-step (lazy-backfill for legacy users).
router.get("/api/sub-step/current", async (req, res) => {
  const user = req.user as { id: string };
  try {
    const sub = await getCurrentSubStep(user.id);
    const messages = await loadMessages(sub.id);
    void maybeKickoffAnalyse(user.id, sub);
    res.json({ subStep: sub, messages });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "sub_step_load_failed", message });
  }
});

// POST /api/sub-step/:id/advance — person closes Gather ("That's all my docs")
// or Analyse auto-closes on completion. Creates next beat instance.
router.post("/api/sub-step/:id/advance", async (req, res) => {
  const user = req.user as { id: string };
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });

  try {
    const [prior] = await db
      .select()
      .from(subSteps)
      .where(and(eq(subSteps.id, id), eq(subSteps.userId, user.id)))
      .limit(1);

    const next = await advanceSubStep(user.id, id);
    audit({
      req,
      action: "sub_step.advance",
      resourceType: "sub_step",
      resourceId: String(next.id),
      detail: { from: id, toBeat: next.beat },
    });

    // State-change dispatch: only the user-driven Gather→Analyse advance is a
    // meaningful "decision" event; the worker-driven Analyse→Discuss is logged
    // separately as analyse_completed.
    if (prior?.beat === "gather") {
      const content = (prior.contentJson ?? {}) as { statementIds?: number[] };
      onStateChange({
        userId: user.id,
        trigger: "gather_advanced",
        subStepId: prior.id,
        canvas: prior.canvasKey as "picture" | "analysis",
        payload: {
          canvas: prior.canvasKey,
          statementCount: Array.isArray(content.statementIds) ? content.statementIds.length : null,
        },
      }).catch(() => {});
    }

    void maybeKickoffAnalyse(user.id, next);
    res.json(next);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "advance_failed", message });
  }
});

// GET /api/sub-step/:id/checklist — agreement-gate items for this beat.
// Returns { canvas, beat, items: [...], agreementReady }.
router.get("/api/sub-step/:id/checklist", async (req, res) => {
  const user = req.user as { id: string };
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  const [sub] = await db
    .select()
    .from(subSteps)
    .where(and(eq(subSteps.id, id), eq(subSteps.userId, user.id)))
    .limit(1);
  if (!sub) return res.status(404).json({ error: "not_found" });
  try {
    const checklist = await deriveChecklist(user.id, sub);
    res.json(checklist);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "checklist_failed", message });
  }
});

// POST /api/sub-step/:id/skip — mark a checklist item as skipped with a
// reason. Writes a kind="skipped_gap" note to the record so the checklist
// derivation reflects the skip on next read.
const skipBodySchema = z.object({
  itemKey: z.string().min(1),
  itemLabel: z.string().min(1),
  // Reason is optional — the user may skip without giving one. We record the
  // absence so the audit trail still shows the explicit choice.
  reason: z.string().max(500).optional(),
});
router.post("/api/sub-step/:id/skip", async (req, res) => {
  const user = req.user as { id: string };
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  const parsed = skipBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  const [sub] = await db
    .select()
    .from(subSteps)
    .where(and(eq(subSteps.id, id), eq(subSteps.userId, user.id)))
    .limit(1);
  if (!sub) return res.status(404).json({ error: "not_found" });

  const reason = parsed.data.reason?.trim() || null;
  await writeNote({
    userId: user.id,
    kind: "skipped_gap",
    category: parsed.data.itemKey,
    label: `Skipped: ${parsed.data.itemLabel}`,
    body: reason,
    sourceKind: "user_stated",
    sourceCanvas: sub.canvasKey,
    sourceSubStepId: sub.id,
    attributes: { skippedWithoutReason: reason === null } as unknown as object,
  });
  audit({
    req,
    action: "sub_step.checklist_skip",
    resourceType: "sub_step",
    resourceId: String(id),
    detail: { itemKey: parsed.data.itemKey, reason: reason ?? "(none given)" },
  });
  res.json({ ok: true });
});

// POST /api/sub-step/:id/discuss-topic — user clicked "Talk about this" on
// an open checklist item. Dispatches topic_initiated which posts an Ally
// turn opening that topic so the user lands back in chat with a question
// waiting.
const discussTopicSchema = z.object({
  itemKey: z.string().min(1),
  itemLabel: z.string().optional(),
});
router.post("/api/sub-step/:id/discuss-topic", async (req, res) => {
  const user = req.user as { id: string };
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  const parsed = discussTopicSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }
  const [sub] = await db
    .select()
    .from(subSteps)
    .where(and(eq(subSteps.id, id), eq(subSteps.userId, user.id)))
    .limit(1);
  if (!sub) return res.status(404).json({ error: "not_found" });

  await onStateChange({
    userId: user.id,
    trigger: "topic_initiated",
    subStepId: sub.id,
    canvas: sub.canvasKey as "picture" | "analysis",
    payload: {
      canvas: sub.canvasKey,
      itemKey: parsed.data.itemKey,
      itemLabel: parsed.data.itemLabel,
    },
  });
  audit({
    req,
    action: "sub_step.checklist_topic_initiated",
    resourceType: "sub_step",
    resourceId: String(id),
    detail: { itemKey: parsed.data.itemKey },
  });
  res.json({ ok: true });
});

// POST /api/sub-step/:id/agree — Discuss → Live
router.post("/api/sub-step/:id/agree", async (req, res) => {
  const user = req.user as { id: string };
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });

  try {
    const live = await agreeSubStep(user.id, id);
    // Legacy side-effects for continuity with old code paths.
    if (live.canvasKey === "picture") {
      await db
        .update(conversations)
        .set({ status: "complete", completedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(conversations.userId, user.id), eq(conversations.status, "active")));
    } else if (live.canvasKey === "analysis") {
      // Mirror agreement on the legacy analysis_drafts row so downstream
      // Explain/Notes surfaces still work against it.
      const content = (live.contentJson ?? {}) as { draftId?: number };
      if (content.draftId) {
        await db
          .update(analysisDrafts)
          .set({ status: "agreed", agreedAt: new Date() })
          .where(
            and(eq(analysisDrafts.id, content.draftId), eq(analysisDrafts.userId, user.id)),
          );
      }
    }
    audit({
      req,
      action: "sub_step.agree",
      resourceType: "sub_step",
      resourceId: String(id),
    });

    // State-change dispatch: write the agreement decision to the record and
    // queue meta-synthesis so the brain rolls up the now-stable canvas.
    {
      const content = (live.contentJson ?? {}) as { analysisId?: number; draftId?: number };
      onStateChange({
        userId: user.id,
        trigger: "discuss_agreed",
        subStepId: id,
        canvas: live.canvasKey as "picture" | "analysis",
        payload: {
          canvas: live.canvasKey,
          analysisId: content.analysisId ?? null,
          draftId: content.draftId ?? null,
        },
      }).catch(() => {});
    }

    // Canvas 1 Live → kick off Canvas 2 gather→analyse automatically.
    if (live.canvasKey === "picture") {
      await startCanvas2ForUser(user.id).catch((err) => {
        console.error("[sub_step.agree] startCanvas2 failed:", err);
      });
    }

    res.json(live);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "agree_failed", message });
  }
});

// POST /api/sub-step/:id/reopen — Live → new Discuss instance
router.post("/api/sub-step/:id/reopen", async (req, res) => {
  const user = req.user as { id: string };
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });

  try {
    const discuss = await reopenSubStep(user.id, id);
    // Reopen the legacy conversation too, so the chat can accept new turns.
    await db
      .update(conversations)
      .set({ status: "active", completedAt: null, updatedAt: new Date() })
      .where(eq(conversations.userId, user.id));
    audit({
      req,
      action: "sub_step.reopen",
      resourceType: "sub_step",
      resourceId: String(id),
    });

    onStateChange({
      userId: user.id,
      trigger: "live_reopened",
      subStepId: id,
      canvas: discuss.canvasKey as "picture" | "analysis",
      payload: { canvas: discuss.canvasKey },
    }).catch(() => {});

    res.json(discuss);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.status(500).json({ error: "reopen_failed", message });
  }
});

// POST /api/sub-step/:id/retry — clears error on the Analyse beat, retries work
router.post("/api/sub-step/:id/retry", async (req, res) => {
  const user = req.user as { id: string };
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });

  await clearAnalyseError(user.id, id);
  audit({ req, action: "sub_step.retry", resourceType: "sub_step", resourceId: String(id) });

  // Pick up the refreshed sub-step and dispatch to the right worker.
  const [fresh] = await db.select().from(subSteps).where(eq(subSteps.id, id)).limit(1);
  if (fresh) void maybeKickoffAnalyse(user.id, fresh);
  res.json({ ok: true });
});

const messageBodySchema = z.object({
  content: z.string().min(1).max(5000),
});

// POST /api/sub-step/:id/message — chat turn against this sub-step
router.post("/api/sub-step/:id/message", async (req, res) => {
  const user = req.user as { id: string };
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  const parsed = messageBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }

  const [sub] = await db
    .select()
    .from(subSteps)
    .where(and(eq(subSteps.id, id), eq(subSteps.userId, user.id)))
    .limit(1);
  if (!sub) return res.status(404).json({ error: "not_found" });

  // Slice 1: only Canvas 1 Discuss is wired to the legacy qa chat path.
  if (sub.canvasKey !== "picture" || sub.beat !== "discuss") {
    return res.status(400).json({ error: "chat_not_supported_for_beat" });
  }

  // Persist user message against this sub-step's message log.
  const [userMsg] = await db
    .insert(subStepMessages)
    .values({ subStepId: sub.id, role: "user", content: parsed.data.content })
    .returning();

  // For Slice 1 we delegate the actual Claude call to the legacy qa chat pipeline
  // (runAndPersistTurn). That writes to conversation_messages — we mirror the
  // assistant reply into sub_step_messages after it lands. Full unification is
  // a Slice 2 cleanup once we've proven the new shell works.
  // TODO(Slice 2): call runAndPersistTurn here and mirror assistant reply.

  res.json({ subStep: sub, userMessage: userMsg });
});

async function loadMessages(subStepId: number) {
  return db
    .select()
    .from(subStepMessages)
    .where(eq(subStepMessages.subStepId, subStepId))
    .orderBy(asc(subStepMessages.createdAt), asc(subStepMessages.id));
}

// ---------------------------------------------------------------------------
// Background worker: Canvas 1 Analyse beat. Calls the legacy analyseStatements
// pipeline, stores the result on both `analyses` (legacy) and writes the
// analysis id back onto the sub-step's contentJson. On completion, advances to
// Discuss automatically.
// ---------------------------------------------------------------------------

async function runPictureAnalyse(userId: string, subStepId: number): Promise<void> {
  const [sub] = await db.select().from(subSteps).where(eq(subSteps.id, subStepId)).limit(1);
  if (!sub || sub.beat !== "analyse" || sub.canvasKey !== "picture") return;

  const sts = await db
    .select()
    .from(statementsTable)
    .where(and(eq(statementsTable.userId, userId), eq(statementsTable.status, "extracted")));
  if (sts.length === 0) {
    await markAnalyseError(userId, subStepId, "no_statements");
    return;
  }

  const prompt = await getActivePrompt("analysis");
  if (!prompt) {
    await markAnalyseError(userId, subStepId, "no_active_analysis_prompt");
    return;
  }

  // Create the legacy analyses row up front so we can reference its id.
  const [analysis] = await db
    .insert(analyses)
    .values({
      userId,
      status: "analysing",
      promptVersionId: prompt.id,
      sourceStatementIds: sts.map((s) => s.id) as unknown as object,
    })
    .returning();

  try {
    const { result, usage } = await analyseStatements({
      systemPrompt: prompt.content,
      model: prompt.model,
      statements: sts.map((s) => ({ filename: s.filename, extraction: s.extractionResult })),
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
      .where(eq(analyses.id, analysis.id));

    // Record the analysis id on the sub-step and auto-advance into Discuss.
    await db
      .update(subSteps)
      .set({
        contentJson: { analysisId: analysis.id } as unknown as object,
        updatedAt: new Date(),
      })
      .where(eq(subSteps.id, subStepId));

    onStateChange({
      userId,
      trigger: "analyse_completed",
      subStepId,
      canvas: "picture",
      payload: { canvas: "picture", analysisId: analysis.id },
    }).catch(() => {});

    await advanceSubStep(userId, subStepId, {
      contentJson: { analysisId: analysis.id },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[runPictureAnalyse] failed:", err);
    await db
      .update(analyses)
      .set({ status: "failed", errorMessage: message, completedAt: new Date() })
      .where(eq(analyses.id, analysis.id));
    await markAnalyseError(userId, subStepId, message);
  }
}

// ---------------------------------------------------------------------------
// Canvas dispatch — fire the right Ally-at-work worker based on canvas × beat.
// Idempotent: if the Analyse sub-step already has content indicating in-flight
// or finished work, do nothing.
// ---------------------------------------------------------------------------

async function maybeKickoffAnalyse(userId: string, sub: SubStep): Promise<void> {
  if (sub.beat !== "analyse" || sub.status !== "in_progress" || sub.errorMessage) return;
  const content = (sub.contentJson ?? {}) as { analysisId?: number; draftId?: number };
  if (sub.canvasKey === "picture") {
    if (content.analysisId) return; // work already done
    // Atomic CAS claim: only one concurrent caller wins. Multiple parallel
    // GETs to /api/sub-step/current used to all fire runPictureAnalyse before
    // the first wrote analysisId back, creating duplicate analyses rows.
    const claimed = await tryClaimAnalyse(sub.id);
    if (!claimed) return;
    runPictureAnalyse(userId, sub.id).catch(async (err) => {
      console.error("[maybeKickoffAnalyse] picture failed:", err);
      await releaseAnalyseClaim(sub.id);
    });
    return;
  }
  if (sub.canvasKey === "analysis") {
    if (content.draftId) return; // work already done
    const claimed = await tryClaimAnalyse(sub.id);
    if (!claimed) return;
    runAnalysisAnalyse(userId, sub.id).catch(async (err) => {
      console.error("[maybeKickoffAnalyse] analysis failed:", err);
      await releaseAnalyseClaim(sub.id);
    });
    return;
  }
}

// CAS-style atomic claim using contentJson.analyseRunning. Only one caller
// gets a row back; others see 0 rows and bail.
async function tryClaimAnalyse(subStepId: number): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE sub_steps
    SET content_json = jsonb_set(
      coalesce(content_json, '{}'::jsonb),
      '{analyseRunning}',
      'true'::jsonb
    ),
    updated_at = NOW()
    WHERE id = ${subStepId}
      AND coalesce(content_json->>'analyseRunning', 'false') = 'false'
      AND content_json->>'analysisId' IS NULL
      AND content_json->>'draftId' IS NULL
    RETURNING id
  `);
  return (result.rowCount ?? 0) > 0;
}

async function releaseAnalyseClaim(subStepId: number): Promise<void> {
  await db.execute(sql`
    UPDATE sub_steps
    SET content_json = (content_json - 'analyseRunning'),
        updated_at = NOW()
    WHERE id = ${subStepId}
  `);
}

// Canvas 1 just reached Live; create the invisible Canvas 2 Gather and
// immediately advance into Analyse, kicking off the draft builder.
async function startCanvas2ForUser(userId: string): Promise<void> {
  // Idempotent: if the user already has a non-superseded Canvas 2 sub-step, skip.
  const [existing] = await db
    .select()
    .from(subSteps)
    .where(
      and(
        eq(subSteps.userId, userId),
        eq(subSteps.canvasKey, "analysis"),
        isNull(subSteps.supersededAt),
      ),
    )
    .limit(1);
  if (existing) return;

  const [gather] = await db
    .insert(subSteps)
    .values({
      userId,
      canvasKey: "analysis",
      beat: "gather",
      instance: 1,
      status: "in_progress",
      driver: "ally",
      contentJson: {} as unknown as object,
    })
    .returning();

  // Invisible pull — auto-advance to Analyse. This closes the gather as agreed
  // and creates the analyse sub-step; the worker then fires.
  const analyse = await advanceSubStep(userId, gather.id);
  runAnalysisAnalyse(userId, analyse.id).catch((err) =>
    console.error("[startCanvas2ForUser] runAnalysisAnalyse failed:", err),
  );
}

// ---------------------------------------------------------------------------
// Background worker: Canvas 2 Analyse beat. Calls buildAnalysisDraft (the
// facts → prose + panels pipeline) and persists to the legacy analysis_drafts
// table. The sub-step's contentJson gets { draftId, analysisId } once done.
// ---------------------------------------------------------------------------

async function runAnalysisAnalyse(userId: string, subStepId: number): Promise<void> {
  const [sub] = await db.select().from(subSteps).where(eq(subSteps.id, subStepId)).limit(1);
  if (!sub || sub.canvasKey !== "analysis" || sub.beat !== "analyse") return;

  const [factsPrompt, prosePrompt, panelsPrompt] = await Promise.all([
    getActivePrompt("analysis_facts"),
    getActivePrompt("analysis_prose"),
    getActivePrompt("analysis_panels"),
  ]);
  if (!factsPrompt || !prosePrompt || !panelsPrompt) {
    await markAnalyseError(userId, subStepId, "no_active_analysis_prompts");
    return;
  }

  // Canvas 1 inputs: latest agreed conversation + analysis + statements.
  const [c1Conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.userId, userId), eq(conversations.status, "complete")))
    .orderBy(desc(conversations.completedAt))
    .limit(1);
  if (!c1Conversation) {
    await markAnalyseError(userId, subStepId, "canvas_1_not_agreed");
    return;
  }
  const [c1Analysis] = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.userId, userId), eq(analyses.status, "done")))
    .orderBy(desc(analyses.createdAt))
    .limit(1);
  if (!c1Analysis) {
    await markAnalyseError(userId, subStepId, "no_canvas_1_analysis");
    return;
  }
  const userStatements: Statement[] = await db
    .select()
    .from(statementsTable)
    .where(eq(statementsTable.userId, userId));

  // Create the legacy analysis_drafts row up front so we can reference its id.
  const [draft] = await db
    .insert(analysisDrafts)
    .values({
      userId,
      sourceConversationId: c1Conversation.id,
      sourceAnalysisId: c1Analysis.id,
      status: "thinking",
    })
    .returning();

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
      .where(eq(analysisDrafts.id, draft.id));

    // Persist claims (explain + note annotations) into the legacy table.
    if (out.claims.length > 0) {
      await db.insert(analysisClaims).values(
        out.claims.map((c) => ({
          draftId: draft.id,
          kind: c.kind,
          anchorId: c.anchorId,
          label: c.label,
          category: c.category,
          body: c.body,
          evidenceRefs: c.evidenceRefs as unknown as object,
        })),
      );
    }
    const inlined = new Set(out.claims.filter((c) => c.kind === "note").map((c) => c.anchorId));
    const extraNotes = out.notes.filter((n) => !inlined.has(n.anchorId));
    if (extraNotes.length > 0) {
      await db.insert(analysisClaims).values(
        extraNotes.map((n) => ({
          draftId: draft.id,
          kind: "note" as const,
          anchorId: n.anchorId,
          label: n.label,
          category: n.category,
          body: n.body,
          evidenceRefs: n.evidenceRefs as unknown as object,
        })),
      );
    }

    // Point the sub-step at the draft and advance to Discuss.
    await db
      .update(subSteps)
      .set({
        contentJson: { draftId: draft.id, analysisId: c1Analysis.id } as unknown as object,
        updatedAt: new Date(),
      })
      .where(eq(subSteps.id, subStepId));

    onStateChange({
      userId,
      trigger: "analyse_completed",
      subStepId,
      canvas: "analysis",
      payload: {
        canvas: "analysis",
        draftId: draft.id,
        analysisId: c1Analysis.id,
        claimsCount: out.claims.length,
      },
    }).catch(() => {});

    await advanceSubStep(userId, subStepId, {
      contentJson: { draftId: draft.id, analysisId: c1Analysis.id },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[runAnalysisAnalyse] failed:", err);
    await db
      .update(analysisDrafts)
      .set({ status: "failed", errorMessage: message })
      .where(eq(analysisDrafts.id, draft.id));
    await markAnalyseError(userId, subStepId, message);
  }
}

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

export default router;

// Re-export the background workers so they can be triggered from other hooks.
export { runPictureAnalyse, runAnalysisAnalyse };
