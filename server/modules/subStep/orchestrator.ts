import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import {
  subSteps,
  users,
  analyses,
  analysisDrafts,
  conversations,
  statements as statementsTable,
  type SubStep,
} from "@shared/schema";

// ============================================================================
// Sub-step orchestrator — the universal step state machine.
// See Scratch/ally_architecture_spec.md §3 and the Slice 1 plan.
//
// Responsibilities:
//   - Return the user's currently active sub-step (creating it lazily if the
//     user is legacy — never had a sub_steps row).
//   - Advance a sub-step to the next step.
//   - Agree a Discuss step → create Live instance.
//   - Reopen a Live step → create new Discuss instance (predecessor-chained).
//
// Slice 1 scope: Phase 1 (picture) only. Phase 2 still runs on the legacy
// `analysis_drafts` path and does NOT touch sub_steps yet.
// ============================================================================

type Phase = "picture" | "analysis" | "plan" | "progress";
type Step = "gather" | "draft" | "discuss" | "live";
type Status = "not_started" | "in_progress" | "agreed" | "superseded" | "paused";

// --- Reading ---------------------------------------------------------------

/**
 * Returns the user's currently active sub-step. If they have no sub-steps yet
 * (legacy user), derives their current position from the Phase 1 legacy
 * tables and inserts the corresponding row.
 *
 * "Active" = the most recent non-superseded, non-agreed-and-closed row on the
 * user's current canvas. Agreed-but-still-Live rows count as active.
 */
export async function getCurrentSubStep(userId: string): Promise<SubStep> {
  const existing = await currentForUser(userId);
  if (existing) return existing;
  return await lazyBackfill(userId);
}

async function currentForUser(userId: string): Promise<SubStep | null> {
  const rows = await db
    .select()
    .from(subSteps)
    .where(and(eq(subSteps.userId, userId), isNull(subSteps.supersededAt)))
    .orderBy(desc(subSteps.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

// --- Lazy backfill from legacy Phase 1 state ------------------------------

/**
 * First-time derivation of the user's current sub-step from legacy data.
 * Covers Phase 1 AND Phase 2 — decides which canvas + step the user is
 * currently on based on the most-advanced legacy signal.
 *
 * Phase 2 takes precedence over Phase 1 once they've agreed their picture
 * (conversations.status=complete). The user's forward-facing sub-step is in
 * Phase 2 from that point onwards.
 */
async function lazyBackfill(userId: string): Promise<SubStep> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error(`User not found: ${userId}`);

  const stmts = await db
    .select()
    .from(statementsTable)
    .where(eq(statementsTable.userId, userId));

  const [latestAnalysis] = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.userId, userId), eq(analyses.status, "done")))
    .orderBy(desc(analyses.createdAt))
    .limit(1);

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .limit(1);

  const [latestDraft] = await db
    .select()
    .from(analysisDrafts)
    .where(and(eq(analysisDrafts.userId, userId), isNull(analysisDrafts.supersededAt)))
    .orderBy(desc(analysisDrafts.createdAt))
    .limit(1);

  const derived = deriveCurrentFromLegacy({
    hasStatements: stmts.length > 0,
    hasBuildCompletedAt: !!user.buildCompletedAt,
    latestAnalysisId: latestAnalysis?.id ?? null,
    conversationStatus: conv?.status ?? null,
    statementIds: stmts.map((s) => s.id),
    latestDraftId: latestDraft?.id ?? null,
    latestDraftStatus: latestDraft?.status ?? null,
  });

  const [created] = await db
    .insert(subSteps)
    .values({
      userId,
      phaseKey: derived.canvas,
      step: derived.step,
      instance: 1,
      status: derived.status,
      driver: derived.driver,
      contentJson: derived.contentJson as unknown as object,
    })
    .returning();
  return created;
}

function deriveCurrentFromLegacy(input: {
  hasStatements: boolean;
  hasBuildCompletedAt: boolean;
  latestAnalysisId: number | null;
  conversationStatus: string | null;
  statementIds: number[];
  latestDraftId: number | null;
  latestDraftStatus: string | null;
}): {
  canvas: Phase;
  step: Step;
  status: Status;
  driver: "person" | "ally" | "both";
  contentJson: unknown;
} {
  // Phase 2 precedence: once they've agreed their picture, they're on Phase 2.
  if (input.conversationStatus === "complete") {
    // Map existing analysis_draft status into a Phase 2 step.
    if (input.latestDraftStatus === "agreed") {
      return {
        canvas: "analysis",
        step: "live",
        status: "in_progress",
        driver: "both",
        contentJson: { draftId: input.latestDraftId, analysisId: input.latestAnalysisId },
      };
    }
    if (input.latestDraftStatus === "ready") {
      return {
        canvas: "analysis",
        step: "discuss",
        status: "in_progress",
        driver: "both",
        contentJson: { draftId: input.latestDraftId, analysisId: input.latestAnalysisId },
      };
    }
    if (input.latestDraftStatus === "thinking" || input.latestDraftStatus === "failed") {
      return {
        canvas: "analysis",
        step: "draft",
        status: "in_progress",
        driver: "ally",
        contentJson: { draftId: input.latestDraftId, analysisId: input.latestAnalysisId },
      };
    }
    // conv.complete but no draft yet — Phase 2 hasn't started. Land on Analyse
    // so the orchestrator's work-kickoff hook creates the draft.
    return {
      canvas: "analysis",
      step: "draft",
      status: "in_progress",
      driver: "ally",
      contentJson: { analysisId: input.latestAnalysisId },
    };
  }

  // Fall back to Phase 1.
  if (!input.hasStatements) {
    return {
      canvas: "picture",
      step: "gather",
      status: "not_started",
      driver: "person",
      contentJson: { statementIds: [] },
    };
  }
  if (!input.hasBuildCompletedAt) {
    return {
      canvas: "picture",
      step: "gather",
      status: "in_progress",
      driver: "person",
      contentJson: { statementIds: input.statementIds },
    };
  }
  if (input.latestAnalysisId === null) {
    return {
      canvas: "picture",
      step: "draft",
      status: "in_progress",
      driver: "ally",
      contentJson: {},
    };
  }
  // Phase 1 Discuss — conversation active (conv.status !== complete).
  return {
    canvas: "picture",
    step: "discuss",
    status: "in_progress",
    driver: "both",
    contentJson: { analysisId: input.latestAnalysisId },
  };
}

// --- State transitions ----------------------------------------------------

/**
 * Advance out of the current step. Used when:
 *   - Gather user clicks "That's all my docs"  → creates Analyse instance
 *   - Analyse finishes (called by the analyseStatements completion hook)
 *     → creates Discuss instance
 * Never called to close Discuss — that uses {@link agreeSubStep} instead.
 */
export async function advanceSubStep(
  userId: string,
  currentId: number,
  options: { contentJson?: unknown } = {},
): Promise<SubStep> {
  const [current] = await db
    .select()
    .from(subSteps)
    .where(and(eq(subSteps.id, currentId), eq(subSteps.userId, userId)))
    .limit(1);
  if (!current) throw new Error("sub-step not found");

  const nextStep = nextStepAfter(current.step as Step);
  if (!nextStep) throw new Error(`no step after ${current.step}`);

  // Close the current step (agreed).
  await db
    .update(subSteps)
    .set({ status: "agreed", agreedAt: new Date(), updatedAt: new Date() })
    .where(eq(subSteps.id, current.id));

  const [created] = await db
    .insert(subSteps)
    .values({
      userId,
      phaseKey: current.phaseKey,
      step: nextStep,
      instance: current.instance,
      status: "in_progress",
      driver: driverForStep(current.phaseKey as Phase, nextStep),
      contentJson: (options.contentJson ?? current.contentJson ?? null) as unknown as object,
      predecessorId: current.id,
    })
    .returning();
  return created;
}

/**
 * End a Discuss step: mark it agreed, create the Live instance. The ceremonial
 * close of the whole rhythm.
 */
export async function agreeSubStep(userId: string, currentId: number): Promise<SubStep> {
  const [current] = await db
    .select()
    .from(subSteps)
    .where(and(eq(subSteps.id, currentId), eq(subSteps.userId, userId)))
    .limit(1);
  if (!current) throw new Error("sub-step not found");
  if (current.step !== "discuss") throw new Error("can only agree a discuss step");

  await db
    .update(subSteps)
    .set({ status: "agreed", agreedAt: new Date(), updatedAt: new Date() })
    .where(eq(subSteps.id, current.id));

  const [live] = await db
    .insert(subSteps)
    .values({
      userId,
      phaseKey: current.phaseKey,
      step: "live",
      instance: current.instance,
      status: "in_progress",
      driver: "both",
      contentJson: current.contentJson as unknown as object,
      predecessorId: current.id,
    })
    .returning();
  return live;
}

/**
 * Reopen a Live step: supersede the current Live, create a new Discuss
 * instance (instance+1). Downstream canvas cascade is deferred to Slice 2.
 */
export async function reopenSubStep(userId: string, currentId: number): Promise<SubStep> {
  const [current] = await db
    .select()
    .from(subSteps)
    .where(and(eq(subSteps.id, currentId), eq(subSteps.userId, userId)))
    .limit(1);
  if (!current) throw new Error("sub-step not found");
  if (current.step !== "live") throw new Error("can only reopen a live step");

  await db
    .update(subSteps)
    .set({ status: "superseded", supersededAt: new Date(), updatedAt: new Date() })
    .where(eq(subSteps.id, current.id));

  const [discuss] = await db
    .insert(subSteps)
    .values({
      userId,
      phaseKey: current.phaseKey,
      step: "discuss",
      instance: current.instance + 1,
      status: "in_progress",
      driver: "both",
      contentJson: current.contentJson as unknown as object,
      predecessorId: current.id,
    })
    .returning();
  return discuss;
}

// --- Ally-at-work state transitions (Analyse step only) -------------------

export async function markAnalyseError(
  userId: string,
  subStepId: number,
  errorMessage: string,
): Promise<void> {
  await db
    .update(subSteps)
    .set({ errorMessage, updatedAt: new Date() })
    .where(and(eq(subSteps.id, subStepId), eq(subSteps.userId, userId)));
}

export async function clearAnalyseError(userId: string, subStepId: number): Promise<void> {
  await db
    .update(subSteps)
    .set({ errorMessage: null, updatedAt: new Date() })
    .where(and(eq(subSteps.id, subStepId), eq(subSteps.userId, userId)));
}

// --- Utilities -------------------------------------------------------------

function nextStepAfter(step: Step): Step | null {
  if (step === "gather") return "draft";
  if (step === "draft") return "discuss";
  if (step === "discuss") return "live";
  return null;
}

function driverForStep(canvas: Phase, step: Step): "person" | "ally" | "both" {
  if (step === "gather") return canvas === "picture" || canvas === "progress" ? "person" : "ally";
  if (step === "draft") return "ally";
  return "both";
}
