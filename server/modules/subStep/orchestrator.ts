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
// Sub-step orchestrator — the universal beat state machine.
// See Scratch/ally_architecture_spec.md §3 and the Slice 1 plan.
//
// Responsibilities:
//   - Return the user's currently active sub-step (creating it lazily if the
//     user is legacy — never had a sub_steps row).
//   - Advance a sub-step to the next beat.
//   - Agree a Discuss beat → create Live instance.
//   - Reopen a Live beat → create new Discuss instance (predecessor-chained).
//
// Slice 1 scope: Canvas 1 (picture) only. Canvas 2 still runs on the legacy
// `analysis_drafts` path and does NOT touch sub_steps yet.
// ============================================================================

type Canvas = "picture" | "analysis" | "plan" | "progress";
type Beat = "gather" | "analyse" | "discuss" | "live";
type Status = "not_started" | "in_progress" | "agreed" | "superseded" | "paused";

// --- Reading ---------------------------------------------------------------

/**
 * Returns the user's currently active sub-step. If they have no sub-steps yet
 * (legacy user), derives their current position from the Canvas 1 legacy
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

// --- Lazy backfill from legacy Canvas 1 state ------------------------------

/**
 * First-time derivation of the user's current sub-step from legacy data.
 * Covers Canvas 1 AND Canvas 2 — decides which canvas + beat the user is
 * currently on based on the most-advanced legacy signal.
 *
 * Canvas 2 takes precedence over Canvas 1 once they've agreed their picture
 * (conversations.status=complete). The user's forward-facing sub-step is in
 * Canvas 2 from that point onwards.
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
      canvasKey: derived.canvas,
      beat: derived.beat,
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
  canvas: Canvas;
  beat: Beat;
  status: Status;
  driver: "person" | "ally" | "both";
  contentJson: unknown;
} {
  // Canvas 2 precedence: once they've agreed their picture, they're on Canvas 2.
  if (input.conversationStatus === "complete") {
    // Map existing analysis_draft status into a Canvas 2 beat.
    if (input.latestDraftStatus === "agreed") {
      return {
        canvas: "analysis",
        beat: "live",
        status: "in_progress",
        driver: "both",
        contentJson: { draftId: input.latestDraftId, analysisId: input.latestAnalysisId },
      };
    }
    if (input.latestDraftStatus === "ready") {
      return {
        canvas: "analysis",
        beat: "discuss",
        status: "in_progress",
        driver: "both",
        contentJson: { draftId: input.latestDraftId, analysisId: input.latestAnalysisId },
      };
    }
    if (input.latestDraftStatus === "thinking" || input.latestDraftStatus === "failed") {
      return {
        canvas: "analysis",
        beat: "analyse",
        status: "in_progress",
        driver: "ally",
        contentJson: { draftId: input.latestDraftId, analysisId: input.latestAnalysisId },
      };
    }
    // conv.complete but no draft yet — Canvas 2 hasn't started. Land on Analyse
    // so the orchestrator's work-kickoff hook creates the draft.
    return {
      canvas: "analysis",
      beat: "analyse",
      status: "in_progress",
      driver: "ally",
      contentJson: { analysisId: input.latestAnalysisId },
    };
  }

  // Fall back to Canvas 1.
  if (!input.hasStatements) {
    return {
      canvas: "picture",
      beat: "gather",
      status: "not_started",
      driver: "person",
      contentJson: { statementIds: [] },
    };
  }
  if (!input.hasBuildCompletedAt) {
    return {
      canvas: "picture",
      beat: "gather",
      status: "in_progress",
      driver: "person",
      contentJson: { statementIds: input.statementIds },
    };
  }
  if (input.latestAnalysisId === null) {
    return {
      canvas: "picture",
      beat: "analyse",
      status: "in_progress",
      driver: "ally",
      contentJson: {},
    };
  }
  // Canvas 1 Discuss — conversation active (conv.status !== complete).
  return {
    canvas: "picture",
    beat: "discuss",
    status: "in_progress",
    driver: "both",
    contentJson: { analysisId: input.latestAnalysisId },
  };
}

// --- State transitions ----------------------------------------------------

/**
 * Advance out of the current beat. Used when:
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

  const nextBeat = nextBeatAfter(current.beat as Beat);
  if (!nextBeat) throw new Error(`no beat after ${current.beat}`);

  // Close the current beat (agreed).
  await db
    .update(subSteps)
    .set({ status: "agreed", agreedAt: new Date(), updatedAt: new Date() })
    .where(eq(subSteps.id, current.id));

  const [created] = await db
    .insert(subSteps)
    .values({
      userId,
      canvasKey: current.canvasKey,
      beat: nextBeat,
      instance: current.instance,
      status: "in_progress",
      driver: driverForBeat(current.canvasKey as Canvas, nextBeat),
      contentJson: (options.contentJson ?? current.contentJson ?? null) as unknown as object,
      predecessorId: current.id,
    })
    .returning();
  return created;
}

/**
 * End a Discuss beat: mark it agreed, create the Live instance. The ceremonial
 * close of the whole rhythm.
 */
export async function agreeSubStep(userId: string, currentId: number): Promise<SubStep> {
  const [current] = await db
    .select()
    .from(subSteps)
    .where(and(eq(subSteps.id, currentId), eq(subSteps.userId, userId)))
    .limit(1);
  if (!current) throw new Error("sub-step not found");
  if (current.beat !== "discuss") throw new Error("can only agree a discuss beat");

  await db
    .update(subSteps)
    .set({ status: "agreed", agreedAt: new Date(), updatedAt: new Date() })
    .where(eq(subSteps.id, current.id));

  const [live] = await db
    .insert(subSteps)
    .values({
      userId,
      canvasKey: current.canvasKey,
      beat: "live",
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
 * Reopen a Live beat: supersede the current Live, create a new Discuss
 * instance (instance+1). Downstream canvas cascade is deferred to Slice 2.
 */
export async function reopenSubStep(userId: string, currentId: number): Promise<SubStep> {
  const [current] = await db
    .select()
    .from(subSteps)
    .where(and(eq(subSteps.id, currentId), eq(subSteps.userId, userId)))
    .limit(1);
  if (!current) throw new Error("sub-step not found");
  if (current.beat !== "live") throw new Error("can only reopen a live beat");

  await db
    .update(subSteps)
    .set({ status: "superseded", supersededAt: new Date(), updatedAt: new Date() })
    .where(eq(subSteps.id, current.id));

  const [discuss] = await db
    .insert(subSteps)
    .values({
      userId,
      canvasKey: current.canvasKey,
      beat: "discuss",
      instance: current.instance + 1,
      status: "in_progress",
      driver: "both",
      contentJson: current.contentJson as unknown as object,
      predecessorId: current.id,
    })
    .returning();
  return discuss;
}

// --- Ally-at-work state transitions (Analyse beat only) -------------------

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

function nextBeatAfter(beat: Beat): Beat | null {
  if (beat === "gather") return "analyse";
  if (beat === "analyse") return "discuss";
  if (beat === "discuss") return "live";
  return null;
}

function driverForBeat(canvas: Canvas, beat: Beat): "person" | "ally" | "both" {
  if (beat === "gather") return canvas === "picture" || canvas === "progress" ? "person" : "ally";
  if (beat === "analyse") return "ally";
  return "both";
}
