import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  record,
  recordSegments,
  recordNotes,
  recordNoteSegments,
  recordSynthesisJobs,
  conversations,
  analysisDrafts,
  analysisClaims,
  type Record as RecordRow,
  type RecordSegment,
  type RecordNote,
} from "@shared/schema";

// ============================================================================
// The record module — server-side helpers for the long-term record of
// conversation. Surface-facing name = "Notes". Internally the entity hierarchy
// is record → segments → notes (m:n via record_note_segments).
//
// Public surface:
//   ensureRecord(userId)          → returns the user's record row, creating
//                                   on first access and lazy-backfilling from
//                                   legacy stores.
//   writeNote(input)              → append a new note (and link to segments).
//   superseseNote(...)            → mark old note superseded, link to new.
//   writeSegmentSummary(...)      → upsert a segment's summaryJson.
//   ensureSegment(...)            → idempotent segment creation.
//   triggerMetaSynthesis(...)     → multi-trigger callable. Logs a job row.
//                                   Stub for now; the actual synthesis prompt
//                                   call is wired in a follow-up.
//
// Every call is tenant-scoped — userId is non-negotiable on every helper.
// ============================================================================

export type WriteNoteInput = {
  userId: string;
  category?: string | null;
  tags?: string[];
  kind: string; // fact | decision | skipped_gap | flag | summary | observation | preference | concern | intention
  label: string;
  body?: string | null;
  evidenceRefs?: unknown;
  attributes?: unknown;
  confidence?: number | null;
  sourceKind?: "ally_generated" | "user_stated" | "system_inferred" | "admin_set" | "imported";
  sourcePhase?: string | null;
  sourceSubStepId?: number | null;
  sourceMessageId?: number | null;
  segmentIds?: number[]; // optional explicit linkage
};

export type EnsureSegmentInput = {
  userId: string;
  kind: string; // sub_step | canvas | topic | meta | temporal | session | milestone | life_event
  label: string;
  description?: string | null;
  parentSegmentId?: number | null;
  phaseKey?: string | null;
  subStepId?: number | null;
  topicKey?: string | null;
  attributes?: unknown;
};

// ---------------------------------------------------------------------------
// Record root + lazy backfill
// ---------------------------------------------------------------------------

export async function ensureRecord(userId: string): Promise<RecordRow> {
  const [existing] = await db
    .select()
    .from(record)
    .where(eq(record.userId, userId))
    .limit(1);

  if (existing) {
    // Idempotent guard: re-run the backfill only if it never completed (e.g.
    // the record was created but a partial failure stopped notes from
    // landing). The flag is set only after a successful run, so retries are
    // safe and one-shot.
    const attrs = (existing.attributes ?? {}) as { migratedFromLegacy?: boolean };
    if (!attrs.migratedFromLegacy) {
      await lazyBackfillFromLegacy(userId, existing.id);
      await db
        .update(record)
        .set({
          attributes: { ...attrs, migratedFromLegacy: true } as unknown as object,
          updatedAt: new Date(),
        })
        .where(eq(record.id, existing.id));
    }
    return existing;
  }

  // First-time creation. Materialise from legacy stores so the user's existing
  // history is visible from day one, then mark the migration done.
  const [created] = await db
    .insert(record)
    .values({ userId })
    .returning();
  await lazyBackfillFromLegacy(userId, created.id);
  await db
    .update(record)
    .set({
      attributes: { migratedFromLegacy: true } as unknown as object,
      updatedAt: new Date(),
    })
    .where(eq(record.id, created.id));
  return created;
}

async function lazyBackfillFromLegacy(userId: string, recordId: number): Promise<void> {
  // Phase 1 conversation profile → notes
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .limit(1);
  if (conv) {
    const profile = (conv.profile ?? {}) as Record_<string, unknown>;
    for (const [key, value] of Object.entries(profile)) {
      if (!value || (typeof value === "string" && value.trim() === "")) continue;
      await db.insert(recordNotes).values({
        recordId,
        userId,
        category: key,
        kind: "fact",
        label: humanise(key),
        body: typeof value === "string" ? value : JSON.stringify(value),
        sourceKind: "ally_generated",
        sourcePhase: "picture",
        attributes: { migratedFrom: "conversations.profile" } as unknown as object,
      });
    }
    const flags = (conv.flaggedIssues ?? []) as unknown[];
    for (const flag of flags) {
      const text = typeof flag === "string" ? flag : JSON.stringify(flag);
      await db.insert(recordNotes).values({
        recordId,
        userId,
        kind: "flag",
        label: text.slice(0, 80),
        body: text,
        sourceKind: "ally_generated",
        sourcePhase: "picture",
        attributes: { migratedFrom: "conversations.flaggedIssues" } as unknown as object,
      });
    }
  }

  // Phase 2 claims (kind=note) → notes; kind=explain → notes with kind=observation.
  const [draft] = await db
    .select()
    .from(analysisDrafts)
    .where(and(eq(analysisDrafts.userId, userId), isNull(analysisDrafts.supersededAt)))
    .orderBy(desc(analysisDrafts.createdAt))
    .limit(1);
  if (draft) {
    const claims = await db
      .select()
      .from(analysisClaims)
      .where(eq(analysisClaims.draftId, draft.id));
    for (const c of claims) {
      await db.insert(recordNotes).values({
        recordId,
        userId,
        category: c.category ?? null,
        kind: c.kind === "note" ? "fact" : "observation",
        label: c.label,
        body: c.body,
        evidenceRefs: c.evidenceRefs,
        sourceKind: "ally_generated",
        sourcePhase: "analysis",
        attributes: { migratedFrom: "analysis_claims", anchorId: c.anchorId } as unknown as object,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Note writes
// ---------------------------------------------------------------------------

export async function writeNote(input: WriteNoteInput): Promise<RecordNote> {
  const root = await ensureRecord(input.userId);
  const [note] = await db
    .insert(recordNotes)
    .values({
      recordId: root.id,
      userId: input.userId,
      category: input.category ?? null,
      tags: input.tags as unknown as object,
      kind: input.kind,
      label: input.label,
      body: input.body ?? null,
      evidenceRefs: input.evidenceRefs as unknown as object,
      attributes: input.attributes as unknown as object,
      confidence: input.confidence != null ? String(input.confidence) : null,
      sourceKind: input.sourceKind ?? "ally_generated",
      sourcePhase: input.sourcePhase ?? null,
      sourceSubStepId: input.sourceSubStepId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
    })
    .returning();
  if (input.segmentIds && input.segmentIds.length > 0) {
    await db.insert(recordNoteSegments).values(
      input.segmentIds.map((segmentId) => ({ noteId: note.id, segmentId })),
    );
  }
  return note;
}

export async function supersedeNote(
  userId: string,
  oldNoteId: number,
  replacement: WriteNoteInput,
): Promise<RecordNote> {
  const replacementNote = await writeNote(replacement);
  await db
    .update(recordNotes)
    .set({
      status: "superseded",
      supersededAt: new Date(),
      supersededBy: replacementNote.id,
      updatedAt: new Date(),
    })
    .where(and(eq(recordNotes.id, oldNoteId), eq(recordNotes.userId, userId)));
  return replacementNote;
}

export async function softDeleteNote(userId: string, noteId: number): Promise<void> {
  // POPIA flag: status flip; UI suppresses; data is preserved until a separate
  // hard-delete compliance pass runs.
  await db
    .update(recordNotes)
    .set({ status: "deletion_pending", updatedAt: new Date() })
    .where(and(eq(recordNotes.id, noteId), eq(recordNotes.userId, userId)));
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

/**
 * Idempotent segment ensure. For sub_step + canvas kinds, uniqueness is keyed
 * on the provenance fields. For topic/temporal, uniqueness is keyed on the
 * label. Mostly used by the orchestrator on sub-step transitions.
 */
export async function ensureSegment(input: EnsureSegmentInput): Promise<RecordSegment> {
  const root = await ensureRecord(input.userId);

  const existing = await db
    .select()
    .from(recordSegments)
    .where(
      and(
        eq(recordSegments.userId, input.userId),
        eq(recordSegments.kind, input.kind),
        input.subStepId != null
          ? eq(recordSegments.subStepId, input.subStepId)
          : input.phaseKey != null
            ? and(eq(recordSegments.phaseKey, input.phaseKey), isNull(recordSegments.subStepId))
            : input.topicKey != null
              ? eq(recordSegments.topicKey, input.topicKey)
              : eq(recordSegments.label, input.label),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0];

  const [created] = await db
    .insert(recordSegments)
    .values({
      recordId: root.id,
      userId: input.userId,
      kind: input.kind,
      parentSegmentId: input.parentSegmentId ?? null,
      label: input.label,
      description: input.description ?? null,
      phaseKey: input.phaseKey ?? null,
      subStepId: input.subStepId ?? null,
      topicKey: input.topicKey ?? null,
      attributes: input.attributes as unknown as object,
    })
    .returning();
  return created;
}

export async function writeSegmentSummary(
  userId: string,
  segmentId: number,
  summary: unknown,
): Promise<void> {
  await db
    .update(recordSegments)
    .set({ summaryJson: summary as unknown as object, updatedAt: new Date() })
    .where(and(eq(recordSegments.id, segmentId), eq(recordSegments.userId, userId)));
}

// ---------------------------------------------------------------------------
// Reads — scoped, segment-aware
// ---------------------------------------------------------------------------

export type ListNotesFilter = {
  userId: string;
  segmentId?: number;
  category?: string;
  kind?: string;
  includeDeletionPending?: boolean;
  limit?: number;
};

export async function listNotes(filter: ListNotesFilter): Promise<RecordNote[]> {
  await ensureRecord(filter.userId);

  // Default: exclude deletion_pending and superseded (the user's "current view").
  const statusClause = filter.includeDeletionPending
    ? or(eq(recordNotes.status, "active"), eq(recordNotes.status, "declined"))
    : eq(recordNotes.status, "active");

  if (filter.segmentId != null) {
    const rows = await db
      .select({ note: recordNotes })
      .from(recordNoteSegments)
      .innerJoin(recordNotes, eq(recordNotes.id, recordNoteSegments.noteId))
      .where(
        and(
          eq(recordNoteSegments.segmentId, filter.segmentId),
          eq(recordNotes.userId, filter.userId),
          statusClause,
          filter.category ? eq(recordNotes.category, filter.category) : undefined,
          filter.kind ? eq(recordNotes.kind, filter.kind) : undefined,
        ),
      )
      .orderBy(desc(recordNotes.establishedAt))
      .limit(filter.limit ?? 200);
    return rows.map((r) => r.note);
  }

  return db
    .select()
    .from(recordNotes)
    .where(
      and(
        eq(recordNotes.userId, filter.userId),
        statusClause,
        filter.category ? eq(recordNotes.category, filter.category) : undefined,
        filter.kind ? eq(recordNotes.kind, filter.kind) : undefined,
      ),
    )
    .orderBy(desc(recordNotes.establishedAt))
    .limit(filter.limit ?? 200);
}

export async function listSegments(userId: string): Promise<RecordSegment[]> {
  await ensureRecord(userId);
  return db
    .select()
    .from(recordSegments)
    .where(eq(recordSegments.userId, userId))
    .orderBy(asc(recordSegments.startedAt));
}

// ---------------------------------------------------------------------------
// Meta-synthesis trigger — pluggable, multi-hook callable
// ---------------------------------------------------------------------------

export type SynthesisTrigger = "discuss_agreed" | "reopen" | "scheduled" | "manual" | "post_summary";

/**
 * Logs a synthesis job and (in this slice) stubs the actual work. Wiring the
 * synthesis prompt + worker is a follow-up; the entry point is in place so
 * any state-change hook can call this and we can iterate the trigger set
 * without touching the call sites.
 */
export async function triggerMetaSynthesis(
  userId: string,
  trigger: SynthesisTrigger,
  context?: unknown,
): Promise<void> {
  await ensureRecord(userId);
  await db
    .insert(recordSynthesisJobs)
    .values({
      userId,
      triggerKind: trigger,
      contextJson: context as unknown as object,
      status: "pending",
    });
  // TODO(record): kick off the actual synthesis worker here. Stubbed in this
  // slice — schema and entry point are real, the job stays "pending" until
  // the worker is wired.
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

type Record_<K extends string, V> = { [k in K]: V };

function humanise(key: string): string {
  const spaced = key.replace(/[_-]/g, " ").trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
