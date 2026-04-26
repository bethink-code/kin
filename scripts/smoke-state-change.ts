// Smoke test for the state-change module — exercises every registered kind
// against a real user, with synthetic payloads that don't require Anthropic
// calls. Verifies record_notes get written and bookend messages land in the
// correct conversation tables.
//
// Run: doppler run -- npx tsx scripts/smoke-state-change.ts <userId>
//
// Expects state to be reset first (see reset-user-state.ts).

import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../server/db";
import {
  users,
  statements,
  conversations,
  conversationMessages,
  analyses,
  analysisDrafts,
  analysisConversations,
  analysisConversationMessages,
  subSteps,
  record,
  recordNotes,
  recordSynthesisJobs,
} from "../shared/schema";
import { onStateChange } from "../server/modules/stateChange";
import { ensureRecord, listNotes } from "../server/modules/record";
import {
  agreeSubStep,
  reopenSubStep,
  advanceSubStep,
  getCurrentSubStep,
} from "../server/modules/subStep/orchestrator";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: tsx scripts/smoke-state-change.ts <userId>");
  process.exit(1);
}

function step(name: string) {
  console.log(`\n=== ${name} ===`);
}

async function noteCount(): Promise<number> {
  const rows = await listNotes({ userId, limit: 500 });
  return rows.length;
}

async function picMsgCount(): Promise<number> {
  const [conv] = await db.select().from(conversations).where(eq(conversations.userId, userId)).limit(1);
  if (!conv) return 0;
  const r = await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conv.id));
  return r.length;
}

async function anaMsgCount(): Promise<number> {
  const [conv] = await db
    .select()
    .from(analysisConversations)
    .where(eq(analysisConversations.userId, userId))
    .orderBy(desc(analysisConversations.startedAt))
    .limit(1);
  if (!conv) return 0;
  const r = await db
    .select()
    .from(analysisConversationMessages)
    .where(eq(analysisConversationMessages.analysisConversationId, conv.id));
  return r.length;
}

async function main() {
  // --- Pre-flight ----------------------------------------------------------
  step("Pre-flight");
  const stmts = await db.select().from(statements).where(eq(statements.userId, userId));
  console.log(`statements: ${stmts.length}`);
  if (stmts.length === 0) throw new Error("no statements for user — reset went too far");

  // --- Lazy backfill: ensureRecord creates the record row + sets the
  //     migratedFromLegacy flag (no legacy data to backfill, so 0 notes).
  step("ensureRecord (lazy backfill, idempotent guard)");
  const rec1 = await ensureRecord(userId);
  const attrs1 = (rec1.attributes ?? {}) as { migratedFromLegacy?: boolean };
  console.log(`record.id=${rec1.id} migratedFromLegacy=${attrs1.migratedFromLegacy}`);

  // Second call — should NOT re-backfill (flag already set).
  const rec2 = await ensureRecord(userId);
  if (rec1.id !== rec2.id) throw new Error("ensureRecord created two records");
  console.log(`re-call same record id ${rec2.id} ✓`);

  // --- chat_turn_taken (Canvas 1) ----------------------------------------
  step("chat_turn_taken (Canvas 1 picture)");
  const before1 = await noteCount();
  await onStateChange({
    userId,
    trigger: "chat_turn_taken",
    canvas: "picture",
    payload: {
      canvas: "picture",
      deltas: {
        retirement: { before: "", after: "RA at Old Mutual, R2k pm", kind: "fact" },
        debt: { before: "", after: "R45k bond, R8k credit card", kind: "fact" },
        goals_0: { before: null, after: "Retire by 60", kind: "intention" },
      },
      newFlaggedIssues: ["Bond is 60% of monthly take-home — heavy"],
      sourceMessageId: null,
      sourceSubStepId: null,
    },
  });
  const after1 = await noteCount();
  console.log(`notes: ${before1} → ${after1} (expected +4: retirement, debt, goal, flag)`);
  if (after1 - before1 !== 4) throw new Error(`expected +4 notes, got +${after1 - before1}`);

  // --- chat_turn_taken (Canvas 2) ----------------------------------------
  step("chat_turn_taken (Canvas 2 analysis)");
  const before2 = await noteCount();
  await onStateChange({
    userId,
    trigger: "chat_turn_taken",
    canvas: "analysis",
    payload: {
      canvas: "analysis",
      noteUpdates: [
        { category: "retirement", label: "RA insufficient", body: "R2k/m won't hit retirement target by 60.", evidenceRefs: [] },
        { category: "house", label: "Bond strain", body: "Bond costs 60% of net income — high risk if income drops.", evidenceRefs: [] },
      ],
      sourceMessageId: null,
      sourceSubStepId: null,
    },
  });
  const after2 = await noteCount();
  console.log(`notes: ${before2} → ${after2} (expected +2)`);
  if (after2 - before2 !== 2) throw new Error(`expected +2 notes, got +${after2 - before2}`);

  // --- analyse_completed --------------------------------------------------
  step("analyse_completed (picture)");
  const before3 = await noteCount();
  await onStateChange({
    userId,
    trigger: "analyse_completed",
    canvas: "picture",
    payload: { canvas: "picture", analysisId: 999, summary: "First-take story written from 9 statements." },
  });
  const after3 = await noteCount();
  console.log(`notes: ${before3} → ${after3} (expected +1: synthesis observation)`);
  if (after3 - before3 !== 1) throw new Error(`expected +1, got +${after3 - before3}`);

  // --- gather_advanced ---------------------------------------------------
  step("gather_advanced (picture)");
  const before4 = await noteCount();
  await onStateChange({
    userId,
    trigger: "gather_advanced",
    canvas: "picture",
    payload: { canvas: "picture", statementCount: 9 },
  });
  const after4 = await noteCount();
  console.log(`notes: ${before4} → ${after4} (expected +1: advance marker)`);
  if (after4 - before4 !== 1) throw new Error(`expected +1, got +${after4 - before4}`);

  // --- Build a Discuss sub-step + conversations so opener handlers can post.
  step("Seed Canvas 1 conversation + Discuss sub-step (so openers can post)");
  // Insert a fake analyses row so the conversation has something to point at.
  const [fakeAnalysis] = await db
    .insert(analyses)
    .values({ userId, status: "done", result: { fake: true } as object })
    .returning();
  const [conv] = await db
    .insert(conversations)
    .values({
      userId,
      status: "active",
      profile: {} as object,
      flaggedIssues: [] as object,
      analysisIdAtStart: fakeAnalysis.id,
    })
    .returning();
  // Seed a couple of opener messages so the chat isn't empty.
  await db.insert(conversationMessages).values({
    conversationId: conv.id,
    role: "assistant",
    content: "Welcome — let's talk about your picture.",
    isTransition: true,
  });
  await db
    .insert(conversationMessages)
    .values({ conversationId: conv.id, role: "user", content: "okay, sounds good" });
  console.log(`conversation seeded with 2 messages`);

  // Insert a Discuss sub-step to back the discuss_agreed call.
  const [discussSub] = await db
    .insert(subSteps)
    .values({
      userId,
      canvasKey: "picture",
      beat: "discuss",
      instance: 1,
      status: "in_progress",
      driver: "both",
      contentJson: { analysisId: fakeAnalysis.id } as object,
    })
    .returning();
  console.log(`discuss sub-step seeded id=${discussSub.id}`);

  // --- discuss_agreed: orchestrator + state change -----------------------
  step("discuss_agreed (picture) — agree + opener");
  const beforeMsg = await picMsgCount();
  const beforeNotes = await noteCount();
  const beforeJobs = (await db.select().from(recordSynthesisJobs).where(eq(recordSynthesisJobs.userId, userId))).length;

  const live = await agreeSubStep(userId, discussSub.id);
  await onStateChange({
    userId,
    trigger: "discuss_agreed",
    subStepId: discussSub.id,
    canvas: "picture",
    payload: { canvas: "picture", analysisId: fakeAnalysis.id },
  });
  const afterMsg = await picMsgCount();
  const afterNotes = await noteCount();
  const afterJobs = (await db.select().from(recordSynthesisJobs).where(eq(recordSynthesisJobs.userId, userId))).length;
  console.log(`live sub-step beat=${live.beat} status=${live.status}`);
  console.log(`messages: ${beforeMsg} → ${afterMsg} (expected +1: Live opener)`);
  console.log(`notes: ${beforeNotes} → ${afterNotes} (expected +1: agreement decision)`);
  console.log(`synthesis jobs: ${beforeJobs} → ${afterJobs} (expected +1)`);
  if (afterMsg - beforeMsg !== 1) throw new Error(`expected +1 msg, got +${afterMsg - beforeMsg}`);
  if (afterNotes - beforeNotes !== 1) throw new Error(`expected +1 note, got +${afterNotes - beforeNotes}`);
  if (afterJobs - beforeJobs !== 1) throw new Error(`expected +1 synthesis job, got +${afterJobs - beforeJobs}`);

  // --- live_reopened -----------------------------------------------------
  step("live_reopened (picture)");
  const beforeMsg2 = await picMsgCount();
  const beforeNotes2 = await noteCount();

  const newDiscuss = await reopenSubStep(userId, live.id);
  await onStateChange({
    userId,
    trigger: "live_reopened",
    subStepId: live.id,
    canvas: "picture",
    payload: { canvas: "picture" },
  });
  const afterMsg2 = await picMsgCount();
  const afterNotes2 = await noteCount();
  console.log(`new discuss sub-step beat=${newDiscuss.beat} instance=${newDiscuss.instance}`);
  console.log(`messages: ${beforeMsg2} → ${afterMsg2} (expected +1: Re-Discuss opener)`);
  console.log(`notes: ${beforeNotes2} → ${afterNotes2} (expected +1: reopen decision)`);
  if (afterMsg2 - beforeMsg2 !== 1) throw new Error(`expected +1 msg, got +${afterMsg2 - beforeMsg2}`);
  if (afterNotes2 - beforeNotes2 !== 1) throw new Error(`expected +1 note, got +${afterNotes2 - beforeNotes2}`);

  // --- session_resumed (re-opener) --------------------------------------
  step("session_resumed (picture discuss)");
  const beforeMsg3 = await picMsgCount();
  await onStateChange({
    userId,
    trigger: "session_resumed",
    canvas: "picture",
    payload: { canvas: "picture", beat: "discuss" },
  });
  const afterMsg3 = await picMsgCount();
  console.log(`messages: ${beforeMsg3} → ${afterMsg3} (expected +1: re-opener)`);
  if (afterMsg3 - beforeMsg3 !== 1) throw new Error(`expected +1 msg, got +${afterMsg3 - beforeMsg3}`);

  // --- Print final state -------------------------------------------------
  step("Final state");
  const allNotes = await listNotes({ userId, limit: 500 });
  console.log(`record_notes: ${allNotes.length}`);
  for (const n of allNotes) {
    const cat = n.category ? `[${n.category}]` : "";
    const can = n.sourceCanvas ? `(${n.sourceCanvas})` : "";
    console.log(`  ${n.kind.padEnd(11)} ${cat.padEnd(15)} ${n.label} ${can}`);
  }

  const picMsgs = await db
    .select({ role: conversationMessages.role, content: conversationMessages.content, isTransition: conversationMessages.isTransition })
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conv.id))
    .orderBy(asc(conversationMessages.createdAt));
  console.log(`\npicture conversation messages: ${picMsgs.length}`);
  for (const m of picMsgs) {
    const flag = m.isTransition ? "★" : " ";
    console.log(`  ${flag} ${m.role}: ${m.content.slice(0, 80)}${m.content.length > 80 ? "..." : ""}`);
  }

  console.log("\n[smoke] all assertions passed ✓");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n[smoke] FAILED:", err);
  process.exit(1);
});
