// Reset a user's per-user state for smoke testing — KEEPS statements + the
// users row itself, drops everything else. Idempotent.
//
// Run: doppler run -- npx tsx scripts/reset-user-state.ts <userId>

import { eq, inArray, or } from "drizzle-orm";
import { db } from "../server/db";
import {
  users,
  conversations,
  conversationMessages,
  analyses,
  analysisDrafts,
  analysisClaims,
  analysisConversations,
  analysisConversationMessages,
  subSteps,
  subStepMessages,
  record,
  recordSegments,
  recordNotes,
  recordNoteSegments,
  recordNoteRelations,
  recordSynthesisJobs,
} from "../shared/schema";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: tsx scripts/reset-user-state.ts <userId>");
  process.exit(1);
}

async function main() {
  console.log(`[reset] target user: ${userId}`);

  // Pre-fetch dependent ids for tables that don't carry user_id directly.
  const convIds = (
    await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.userId, userId))
  ).map((r) => r.id);

  const draftIds = (
    await db.select({ id: analysisDrafts.id }).from(analysisDrafts).where(eq(analysisDrafts.userId, userId))
  ).map((r) => r.id);

  const aconvIds = (
    await db
      .select({ id: analysisConversations.id })
      .from(analysisConversations)
      .where(eq(analysisConversations.userId, userId))
  ).map((r) => r.id);

  const subIds = (
    await db.select({ id: subSteps.id }).from(subSteps).where(eq(subSteps.userId, userId))
  ).map((r) => r.id);

  const noteIds = (
    await db.select({ id: recordNotes.id }).from(recordNotes).where(eq(recordNotes.userId, userId))
  ).map((r) => r.id);

  // Delete in FK-safe order (children first, then parents).
  // 1. Record join/relation tables
  if (noteIds.length > 0) {
    await db.delete(recordNoteSegments).where(inArray(recordNoteSegments.noteId, noteIds));
    await db
      .delete(recordNoteRelations)
      .where(or(inArray(recordNoteRelations.fromNoteId, noteIds), inArray(recordNoteRelations.toNoteId, noteIds)));
  }
  // 2. record_notes (refs sub_steps + sub_step_messages — must precede those)
  await db.delete(recordNotes).where(eq(recordNotes.userId, userId));
  // 3. record_segments (refs sub_steps)
  await db.delete(recordSegments).where(eq(recordSegments.userId, userId));
  // 4. record_synthesis_jobs (refs users only)
  await db.delete(recordSynthesisJobs).where(eq(recordSynthesisJobs.userId, userId));
  // 5. record root
  await db.delete(record).where(eq(record.userId, userId));

  // 6. sub_step_messages (children of sub_steps; also refed by record_notes — already gone)
  if (subIds.length > 0) {
    await db.delete(subStepMessages).where(inArray(subStepMessages.subStepId, subIds));
  }
  // 7. sub_steps
  await db.delete(subSteps).where(eq(subSteps.userId, userId));

  // 8. analysis_conversation_messages (refs analysis_conversations + analysis_drafts)
  if (aconvIds.length > 0) {
    await db
      .delete(analysisConversationMessages)
      .where(inArray(analysisConversationMessages.analysisConversationId, aconvIds));
  }
  // 9. analysis_conversations (refs analysis_drafts via draftId)
  await db.delete(analysisConversations).where(eq(analysisConversations.userId, userId));

  // 10. analysis_claims (refs analysis_drafts)
  if (draftIds.length > 0) {
    await db.delete(analysisClaims).where(inArray(analysisClaims.draftId, draftIds));
  }
  // 11. analysis_drafts (refs conversations + analyses)
  await db.delete(analysisDrafts).where(eq(analysisDrafts.userId, userId));

  // 12. conversation_messages (refs conversations)
  if (convIds.length > 0) {
    await db.delete(conversationMessages).where(inArray(conversationMessages.conversationId, convIds));
  }
  // 13. conversations (refs analyses via analysisIdAtStart) — null the ref
  //     before delete since analyses follow.
  await db.delete(conversations).where(eq(conversations.userId, userId));

  // 14. analyses
  await db.delete(analyses).where(eq(analyses.userId, userId));

  // Reset gather completion flag so flow restarts at Gather.
  await db.update(users).set({ buildCompletedAt: null }).where(eq(users.id, userId));

  console.log(`[reset] done — kept statements + users row, cleared everything else`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[reset] failed:", err);
  process.exit(1);
});
