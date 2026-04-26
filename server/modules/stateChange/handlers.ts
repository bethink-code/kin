// ============================================================================
// State-change handlers — one function per effect. Each handler must:
//   - Be idempotent enough that re-running on the same context is safe (or
//     loud about it). Append-only writes are inherently safe.
//   - Read narrowly from ctx.payload via type guards; never assume shape.
//   - Throw on real failures so the runner can catch + log.
// ============================================================================

import { eq } from "drizzle-orm";
import { db } from "../../db";
import { subSteps } from "@shared/schema";
import { writeNote, triggerMetaSynthesis } from "../record";
import { deriveChecklist } from "../checklist";
import { OPENERS, REOPENERS, TOPIC_STARTERS, postAllyMessage } from "./messages";
import type { StateChangeContext } from "./index";

// ---------------------------------------------------------------------------
// chat_turn_taken — the polarity flip. The chat pipelines (qa for Canvas 1,
// analysisDraft/chat for Canvas 2) used to write only to the legacy stores
// (conversations.profile / analysisClaims). Going forward they also dispatch
// here so each turn's new facts land canonically in record_notes.
//
// Two payload shapes supported (one per canvas):
//
//   Canvas 1 (qa):
//     { canvas: "picture",
//       deltas: { profileFieldKey: { before, after, kind: "fact" | "preference" }... },
//       newFlaggedIssues: string[],
//       sourceMessageId: number,
//       sourceSubStepId: number | null }
//
//   Canvas 2 (analysisDraft chat):
//     { canvas: "analysis",
//       noteUpdates: [{ category, label, body, evidenceRefs }...],
//       sourceMessageId: number,
//       sourceSubStepId: number | null }
//
// Each delta / noteUpdate becomes one record_note. The originating message id
// goes onto sourceMessageId so we can trace any note back to its turn.
// ---------------------------------------------------------------------------

type ChatTurnPayloadCanvas1 = {
  canvas: "picture";
  deltas: Record<
    string,
    { before: unknown; after: unknown; kind: "fact" | "preference" | "concern" | "intention" }
  >;
  newFlaggedIssues?: string[];
  sourceMessageId?: number | null;
  // The legacy chat tables aren't FK-linked to record_notes.source_message_id
  // (that targets sub_step_messages). Until chat moves into sub_step_messages,
  // the legacy message id rides in attributes for traceability.
  legacyConversationMessageId?: number | null;
  sourceSubStepId?: number | null;
};

type ChatTurnPayloadCanvas2 = {
  canvas: "analysis";
  noteUpdates: Array<{
    category: string;
    label: string;
    body: string;
    evidenceRefs?: unknown;
  }>;
  sourceMessageId?: number | null;
  legacyConversationMessageId?: number | null;
  sourceSubStepId?: number | null;
};

export async function writeNotesFromTurn(ctx: StateChangeContext): Promise<void> {
  const p = ctx.payload as ChatTurnPayloadCanvas1 | ChatTurnPayloadCanvas2 | undefined;
  if (!p || typeof p !== "object") return;

  if (p.canvas === "picture") {
    // One note per non-empty delta. Stringy fields = "fact". Goals + concerns
    // pass kind explicitly via the delta shape.
    for (const [field, change] of Object.entries(p.deltas ?? {})) {
      if (change.after == null || change.after === "") continue;
      const body = typeof change.after === "string" ? change.after : JSON.stringify(change.after);
      // Array fields (corrections / goals) come keyed as `goals_N` /
      // `corrections_N` so each entry gets its own delta. Strip the suffix
      // for the canonical category. For all fields the label is the entry
      // text (truncated) — the category already carries the topic, so a
      // generic "Retirement" label would just duplicate it.
      const arrayMatch = field.match(/^(goals|corrections)_\d+$/);
      const category = arrayMatch ? arrayMatch[1] : field;
      const label = body.length > 80 ? body.slice(0, 77) + "..." : body;
      await writeNote({
        userId: ctx.userId,
        kind: change.kind,
        category,
        label,
        body,
        sourceKind: "ally_generated",
        sourceCanvas: "picture",
        sourceSubStepId: p.sourceSubStepId ?? ctx.subStepId ?? null,
        sourceMessageId: p.sourceMessageId ?? null,
        attributes: {
          previousValue: change.before ?? null,
          legacyConversationMessageId: p.legacyConversationMessageId ?? null,
        } as unknown as object,
      });
    }
    for (const flag of p.newFlaggedIssues ?? []) {
      if (!flag) continue;
      await writeNote({
        userId: ctx.userId,
        kind: "flag",
        label: flag.length > 80 ? flag.slice(0, 77) + "..." : flag,
        body: flag,
        sourceKind: "ally_generated",
        sourceCanvas: "picture",
        sourceSubStepId: p.sourceSubStepId ?? ctx.subStepId ?? null,
        sourceMessageId: p.sourceMessageId ?? null,
        attributes: {
          legacyConversationMessageId: p.legacyConversationMessageId ?? null,
        } as unknown as object,
      });
    }
    return;
  }

  if (p.canvas === "analysis") {
    for (const n of p.noteUpdates ?? []) {
      if (!n.label || !n.body) continue;
      await writeNote({
        userId: ctx.userId,
        kind: "fact",
        category: n.category,
        label: n.label,
        body: n.body,
        evidenceRefs: n.evidenceRefs,
        sourceKind: "ally_generated",
        sourceCanvas: "analysis",
        sourceSubStepId: p.sourceSubStepId ?? ctx.subStepId ?? null,
        sourceMessageId: p.sourceMessageId ?? null,
        attributes: {
          legacyConversationMessageId: p.legacyConversationMessageId ?? null,
        } as unknown as object,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// analyse_completed — Ally finished an Analyse beat. Write a "synthesis"
// observation summarising what was produced, and trigger meta-synthesis so
// the brain rolls up the new chunk.
//
// Payload:
//   { canvas, summary?: string, claimsCount?: number,
//     analysisId?: number, draftId?: number }
// ---------------------------------------------------------------------------

type AnalyseCompletedPayload = {
  canvas: "picture" | "analysis";
  summary?: string;
  claimsCount?: number;
  analysisId?: number;
  draftId?: number;
};

export async function writeAnalyseSynthesisNote(ctx: StateChangeContext): Promise<void> {
  const p = (ctx.payload ?? {}) as AnalyseCompletedPayload;
  const canvas = p.canvas ?? ctx.canvas ?? "picture";
  const label =
    canvas === "picture"
      ? "First-take story written"
      : "Analysis written";
  const body =
    p.summary ??
    (p.claimsCount != null
      ? `${p.claimsCount} insights captured.`
      : "Synthesis pass completed.");
  await writeNote({
    userId: ctx.userId,
    kind: "observation",
    category: "summary",
    label,
    body,
    sourceKind: "ally_generated",
    sourceCanvas: canvas,
    sourceSubStepId: ctx.subStepId ?? null,
    attributes: {
      analysisId: p.analysisId ?? null,
      draftId: p.draftId ?? null,
    } as unknown as object,
  });
}

// ---------------------------------------------------------------------------
// discuss_agreed — the ceremonial close of a Discuss beat. Write a decision
// note marking the agreement and queue meta-synthesis so the brain catches
// up with the newly-stable state.
// ---------------------------------------------------------------------------

type AgreePayload = {
  canvas: "picture" | "analysis";
  summary?: string;
  analysisId?: number;
  draftId?: number;
};

export async function writeAgreementDecision(ctx: StateChangeContext): Promise<void> {
  const p = (ctx.payload ?? {}) as AgreePayload;
  const canvas = p.canvas ?? ctx.canvas ?? "picture";
  const label =
    canvas === "picture"
      ? "Agreed: this is my picture"
      : "Agreed: this analysis is right";
  await writeNote({
    userId: ctx.userId,
    kind: "decision",
    category: "decision",
    label,
    body: p.summary ?? null,
    sourceKind: "user_stated",
    sourceCanvas: canvas,
    sourceSubStepId: ctx.subStepId ?? null,
    attributes: {
      analysisId: p.analysisId ?? null,
      draftId: p.draftId ?? null,
    } as unknown as object,
  });
}

export async function triggerSynthesisAfterAgree(ctx: StateChangeContext): Promise<void> {
  await triggerMetaSynthesis(ctx.userId, "discuss_agreed", {
    subStepId: ctx.subStepId ?? null,
    canvas: ctx.canvas ?? null,
  });
}

// ---------------------------------------------------------------------------
// live_reopened — user pulled an agreed thing back into Discuss. Append-only
// audit note so the record shows the reopen as a real event (no overwrite).
// ---------------------------------------------------------------------------

type ReopenPayload = {
  canvas: "picture" | "analysis";
  reason?: string;
};

export async function writeReopenDecision(ctx: StateChangeContext): Promise<void> {
  const p = (ctx.payload ?? {}) as ReopenPayload;
  const canvas = p.canvas ?? ctx.canvas ?? "picture";
  const label =
    canvas === "picture"
      ? "Reopened: picture pulled back into discussion"
      : "Reopened: analysis pulled back into discussion";
  await writeNote({
    userId: ctx.userId,
    kind: "decision",
    category: "decision",
    label,
    body: p.reason ?? null,
    sourceKind: "user_stated",
    sourceCanvas: canvas,
    sourceSubStepId: ctx.subStepId ?? null,
  });
}

// ---------------------------------------------------------------------------
// gather_advanced — user said "that's all my docs" and Ally is moving into
// Analyse. Lightweight marker note so the record has a clear hand-off point.
// ---------------------------------------------------------------------------

type AdvancePayload = {
  canvas: "picture" | "analysis";
  statementCount?: number;
};

export async function writeAdvanceMarker(ctx: StateChangeContext): Promise<void> {
  const p = (ctx.payload ?? {}) as AdvancePayload;
  const canvas = p.canvas ?? ctx.canvas ?? "picture";
  if (canvas !== "picture") return; // Only the picture gather is user-driven
  await writeNote({
    userId: ctx.userId,
    kind: "decision",
    category: "decision",
    label: "Said that's all my docs",
    body:
      p.statementCount != null
        ? `Closed Gather with ${p.statementCount} statement${p.statementCount === 1 ? "" : "s"}.`
        : null,
    sourceKind: "user_stated",
    sourceCanvas: "picture",
    sourceSubStepId: ctx.subStepId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Bookend openers — post a transition Ally turn into the canvas's chat when
// the user crosses into a new beat. Closers wait for the agreement-gate /
// checklist module (closer = checklist confirmation, not generic wrap-up).
//
// Today's coverage:
//   discuss_agreed  → Live opener ("done, agreed, here if you need me")
//   live_reopened   → Re-Discuss opener ("pulling this back open, what changed?")
//
// Existing openers in qa.ts and analysisConversation.ts (Discuss-on-arrival)
// are NOT moved yet — they work, and centralising them is a follow-up.
// ---------------------------------------------------------------------------

export async function postAgreedOpener(ctx: StateChangeContext): Promise<void> {
  const canvas = (ctx.canvas ?? "picture") as "picture" | "analysis";
  // Real closer: read the checklist for the discuss sub-step that just closed,
  // build a substantive recap (covered + skipped items), then the Live opener.
  // Falls back to the deterministic Live opener if checklist derivation fails
  // or the sub-step can't be loaded.
  const recap = await buildAgreementRecap(ctx);
  const opener = OPENERS[`${canvas}_live`];
  const content = recap ? `${recap}\n\n${opener ?? ""}`.trim() : opener;
  if (!content) return;
  await postAllyMessage({ userId: ctx.userId, canvas, content });
}

async function buildAgreementRecap(ctx: StateChangeContext): Promise<string | null> {
  if (!ctx.subStepId) return null;
  try {
    const [sub] = await db.select().from(subSteps).where(eq(subSteps.id, ctx.subStepId)).limit(1);
    if (!sub) return null;
    const checklist = await deriveChecklist(ctx.userId, sub);
    const covered = checklist.items.filter((i) => i.status === "covered");
    const skipped = checklist.items.filter((i) => i.status === "skipped");
    if (covered.length === 0 && skipped.length === 0) return null;

    const parts: string[] = [];
    if (covered.length > 0) {
      const list = covered.map((i) => i.label.toLowerCase()).join(", ");
      parts.push(`We covered ${list}.`);
    }
    if (skipped.length > 0) {
      const list = skipped
        .map((i) => `${i.label.toLowerCase()}${i.reason ? ` (${i.reason})` : ""}`)
        .join("; ");
      parts.push(`You parked ${list} for now — they're noted as skipped, not gone.`);
    }
    return parts.join(" ");
  } catch (err) {
    console.warn("[buildAgreementRecap] fell back to deterministic opener:", err);
    return null;
  }
}

export async function postReopenOpener(ctx: StateChangeContext): Promise<void> {
  const canvas = (ctx.canvas ?? "picture") as "picture" | "analysis";
  const content = OPENERS[`${canvas}_discuss_redo`];
  if (!content) return;
  await postAllyMessage({ userId: ctx.userId, canvas, content });
}

// ---------------------------------------------------------------------------
// session_resumed — fired when the user returns to an in-progress chat that
// has gone cold (latest message > STALE_AFTER_MS old). Re-orients with
// context. Idempotent by virtue of the staleness check at the call site:
// once the re-opener lands, the latest-message timestamp is fresh, so
// subsequent GETs in the same session won't re-fire.
// ---------------------------------------------------------------------------

export async function postSessionReopener(ctx: StateChangeContext): Promise<void> {
  const canvas = (ctx.canvas ?? "picture") as "picture" | "analysis";
  // Only Discuss has an active two-way chat worth re-opening. Live is
  // semi-idle; Gather/Analyse have no chat surface.
  const beat = ((ctx.payload as { beat?: string } | undefined)?.beat ?? "discuss");
  if (beat !== "discuss") return;
  const content = REOPENERS[`${canvas}_${beat}`];
  if (!content) return;
  await postAllyMessage({ userId: ctx.userId, canvas, content });
}

// ---------------------------------------------------------------------------
// topic_initiated — fired when the user clicks "Talk about this" on an open
// checklist item in the agreement gate. Posts an Ally turn that opens the
// topic so the user lands back in chat with a clear question waiting.
//
// Payload: { canvas, itemKey, itemLabel? }
// ---------------------------------------------------------------------------

type TopicInitiatedPayload = {
  canvas: "picture" | "analysis";
  itemKey: string;
  itemLabel?: string;
};

export async function postTopicStarter(ctx: StateChangeContext): Promise<void> {
  const p = (ctx.payload ?? {}) as TopicInitiatedPayload;
  const canvas = p.canvas ?? (ctx.canvas as "picture" | "analysis") ?? "picture";
  const template = TOPIC_STARTERS[p.itemKey];
  const content =
    template ??
    `Let's talk about ${p.itemLabel ?? p.itemKey}. Tell me what's there — or what isn't.`;
  await postAllyMessage({ userId: ctx.userId, canvas, content });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humaniseField(field: string): string {
  // Convert qaProfile field names into UI-friendly labels.
  const map: Record<string, string> = {
    otherAccounts: "Other accounts",
    incomeContext: "Income",
    debt: "Debt",
    medicalCover: "Medical cover",
    lifeCover: "Life cover",
    incomeProtection: "Income protection",
    retirement: "Retirement",
    tax: "Tax",
    property: "Property",
    lifeContext: "Life context",
    will: "Will",
    corrections: "Correction",
    goals: "Goal",
  };
  return map[field] ?? field.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}
