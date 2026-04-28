// End-to-end walkthrough — drives the system as a real user would, hitting
// real Anthropic endpoints. Mirrors each route handler so the same module
// chain executes (orchestrator + onStateChange + workers).
//
// Steps:
//   1. Pre-flight: confirm reset state, statements present
//   2. Phase 1 Gather: lazy-backfill sub-step, advance with gather_advanced
//   3. Phase 1 Analyse: real analyseStatements call → analyse_completed
//   4. Phase 1 Discuss: /qa/start opener, three real chat turns → chat_turn_taken
//   5. Phase 1 Agree: agreeSubStep + discuss_agreed → Live opener +
//      Phase 2 startup + meta-synthesis trigger
//   6. Phase 2 Analyse: real buildAnalysisDraft → analyse_completed
//   7. Phase 2 Discuss: /analysis-conversation/start opener, two real
//      chat turns → chat_turn_taken (analysis canvas)
//   8. Phase 2 Agree: agreeSubStep on analysis discuss → discuss_agreed
//   9. Phase 1 Reopen: reopenSubStep on Phase 1 Live → live_reopened
//  10. Session resumed: backdate latest msg, run isStale check + dispatch
//  11. Final state dump
//
// Run: doppler run -- npx tsx scripts/e2e-walkthrough.ts <userId>

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../server/db";
import {
  users,
  statements as statementsTable,
  conversations,
  conversationMessages,
  analyses,
  analysisDrafts,
  analysisClaims,
  analysisConversations,
  analysisConversationMessages,
  subSteps,
  recordNotes,
  recordSynthesisJobs,
  type Statement,
} from "../shared/schema";
import { onStateChange } from "../server/modules/stateChange";
import { isStale } from "../server/modules/stateChange/messages";
import { listNotes } from "../server/modules/record";
import {
  getCurrentSubStep,
  agreeSubStep,
  reopenSubStep,
  advanceSubStep,
  markAnalyseError,
} from "../server/modules/subStep/orchestrator";
import { getActivePrompt } from "../server/modules/prompts/getPrompt";
import { analyseStatements } from "../server/modules/analysis/analyse";
import { buildAnalysisDraft } from "../server/modules/analysisDraft/build";
import { runAndPersistTurn } from "../server/modules/qa/persistTurn";
import { runAnalysisChatTurn } from "../server/modules/analysisDraft/chat";
import { emptyProfile, type QaProfile } from "../server/modules/qa/schema";
import type {
  AnalysisFacts,
  AnalysisProse,
  AnalysisPanels,
} from "../server/modules/analysisDraft/schema";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: tsx scripts/e2e-walkthrough.ts <userId>");
  process.exit(1);
}

function step(name: string) {
  console.log(`\n========== ${name} ==========`);
}
function log(msg: string) {
  console.log(`  ${msg}`);
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
      status: s.status,
      bankName: r?.bankName ?? null,
      periodStart: r?.statementPeriodStart ?? null,
      periodEnd: r?.statementPeriodEnd ?? null,
      transactionCount: Array.isArray(r?.transactions) ? r.transactions.length : null,
    };
  });
}

async function main() {
  const t0 = Date.now();

  // ------------------------------------------------------------------------
  step("1. Pre-flight");
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error(`no user ${userId}`);
  const sts = await db.select().from(statementsTable).where(eq(statementsTable.userId, userId));
  const extractedSts = sts.filter((s) => s.status === "extracted");
  log(`user: ${user.firstName ?? "?"} (${user.email}) buildCompletedAt=${user.buildCompletedAt}`);
  log(`statements: ${sts.length} (${extractedSts.length} extracted)`);
  if (extractedSts.length === 0) throw new Error("no extracted statements");

  // ------------------------------------------------------------------------
  step("2. Phase 1 Gather → Analyse (gather_advanced)");
  // First call to getCurrentSubStep lazy-creates a Gather sub-step.
  const gather = await getCurrentSubStep(userId);
  log(`current sub-step: canvas=${gather.phaseKey} step=${gather.step} status=${gather.status}`);
  if (gather.step !== "gather") throw new Error(`expected gather, got ${gather.step}`);

  // Mirror the /sub-step/:id/advance route: capture prior, advance, dispatch
  // gather_advanced.
  const [prior] = await db.select().from(subSteps).where(eq(subSteps.id, gather.id)).limit(1);
  const analyse1 = await advanceSubStep(userId, gather.id);
  log(`advanced: ${prior!.step} → ${analyse1.step}`);
  await onStateChange({
    userId,
    trigger: "gather_advanced",
    subStepId: prior!.id,
    canvas: prior!.phaseKey as "picture",
    payload: {
      canvas: prior!.phaseKey,
      statementCount: ((prior!.contentJson ?? {}) as { statementIds?: number[] }).statementIds?.length ?? extractedSts.length,
    },
  });
  log("dispatched gather_advanced ✓");

  // Mark the user as build-complete (the /qa pipeline keys off this).
  await db.update(users).set({ buildCompletedAt: new Date() }).where(eq(users.id, userId));

  // ------------------------------------------------------------------------
  step("3. Phase 1 Analyse — real analyseStatements call (Anthropic)");
  const analysisPrompt = await getActivePrompt("analysis");
  if (!analysisPrompt) throw new Error("no active 'analysis' prompt");
  log(`using prompt id=${analysisPrompt.id} model=${analysisPrompt.model}`);

  const [analysisRow] = await db
    .insert(analyses)
    .values({
      userId,
      status: "analysing",
      promptVersionId: analysisPrompt.id,
      sourceStatementIds: extractedSts.map((s) => s.id) as unknown as object,
    })
    .returning();
  log(`inserted analyses row id=${analysisRow.id}`);

  const t1 = Date.now();
  const { result: analysisResult, usage: analysisUsage } = await analyseStatements({
    systemPrompt: analysisPrompt.content,
    model: analysisPrompt.model,
    statements: extractedSts.map((s) => ({ filename: s.filename, extraction: s.extractionResult })),
  });
  log(`analyseStatements done in ${(Date.now() - t1) / 1000}s — in=${analysisUsage.inputTokens} out=${analysisUsage.outputTokens}`);

  await db
    .update(analyses)
    .set({
      status: "done",
      result: analysisResult as unknown as object,
      inputTokens: analysisUsage.inputTokens,
      outputTokens: analysisUsage.outputTokens,
      cacheReadTokens: analysisUsage.cacheReadTokens,
      cacheCreationTokens: analysisUsage.cacheCreationTokens,
      completedAt: new Date(),
    })
    .where(eq(analyses.id, analysisRow.id));

  await db
    .update(subSteps)
    .set({ contentJson: { analysisId: analysisRow.id } as object, updatedAt: new Date() })
    .where(eq(subSteps.id, analyse1.id));

  // Dispatch analyse_completed (mirrors runPictureAnalyse).
  await onStateChange({
    userId,
    trigger: "analyse_completed",
    subStepId: analyse1.id,
    canvas: "picture",
    payload: { canvas: "picture", analysisId: analysisRow.id },
  });
  log("dispatched analyse_completed ✓");

  const discuss1 = await advanceSubStep(userId, analyse1.id, {
    contentJson: { analysisId: analysisRow.id },
  });
  log(`sub-step advanced: ${analyse1.step} → ${discuss1.step}`);

  // ------------------------------------------------------------------------
  step("4. Phase 1 Discuss — /qa/start + 3 chat turns");
  // Mirror /qa/start: insert conversation, run opener turn.
  const qaPrompt = await getActivePrompt("qa");
  if (!qaPrompt) throw new Error("no active qa prompt");

  const [c1Conv] = await db
    .insert(conversations)
    .values({
      userId,
      status: "active",
      profile: emptyProfile() as unknown as object,
      flaggedIssues: [] as unknown as object,
      analysisIdAtStart: analysisRow.id,
    })
    .returning();
  log(`conversation id=${c1Conv.id} created`);

  const stmtSummary = summariseStatements(extractedSts);
  await runAndPersistTurn({
    conversationId: c1Conv.id,
    userId,
    prompt: qaPrompt,
    user: { firstName: user.firstName, email: user.email },
    phase: "first_take_gaps",
    analysis: analysisResult,
    statements: stmtSummary,
    profile: emptyProfile(),
    flaggedIssues: [],
    history: [],
    historyTruncated: false,
    latestUser: null,
    isTransition: true,
  });
  log("Ally opener posted ✓");

  // Three real user turns. Each fires chat_turn_taken inside runAndPersistTurn.
  const userTurns = [
    "I've got an RA at Old Mutual, paying about R2k a month.",
    "My biggest worry is the bond — it's eating most of my take-home each month. I want to know if I'm overcommitted.",
    "I want to retire at 60 if possible. And I'd love to put my kid through varsity without debt.",
  ];

  for (const ut of userTurns) {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, c1Conv.id)).limit(1);
    const profileNow = (conv!.profile as QaProfile | null) ?? emptyProfile();
    const flagsNow = (conv!.flaggedIssues as string[] | null) ?? [];
    const priorMsgs = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, c1Conv.id))
      .orderBy(asc(conversationMessages.createdAt));
    await db
      .insert(conversationMessages)
      .values({ conversationId: c1Conv.id, role: "user", content: ut });
    const history = priorMsgs.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    log(`user: ${ut.slice(0, 60)}...`);
    const before = await currentNoteCount();
    const { assistantMessage } = await runAndPersistTurn({
      conversationId: c1Conv.id,
      userId,
      prompt: qaPrompt,
      user: { firstName: user.firstName, email: user.email },
      phase: "first_take_gaps",
      analysis: analysisResult,
      statements: stmtSummary,
      profile: profileNow,
      flaggedIssues: flagsNow,
      history,
      historyTruncated: false,
      latestUser: ut,
    });
    const after = await currentNoteCount();
    log(`ally: ${assistantMessage.content.slice(0, 80)}...`);
    log(`record_notes: ${before} → ${after} (Δ=${after - before})`);
  }

  // ------------------------------------------------------------------------
  step("5. Phase 1 Agree → discuss_agreed (Live opener + Phase 2 kickoff)");
  const beforeMsgs5 = await convMsgCount(c1Conv.id);
  const beforeNotes5 = await currentNoteCount();
  const beforeJobs5 = await synthesisJobCount();

  // Mirror /sub-step/:id/agree.
  const live1 = await agreeSubStep(userId, discuss1.id);
  log(`agreed → live sub-step id=${live1.id} step=${live1.step}`);

  // Legacy mirror: close the conversation.
  await db
    .update(conversations)
    .set({ status: "complete", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(conversations.id, c1Conv.id));

  await onStateChange({
    userId,
    trigger: "discuss_agreed",
    subStepId: discuss1.id,
    canvas: "picture",
    payload: { canvas: "picture", analysisId: analysisRow.id },
  });

  const afterMsgs5 = await convMsgCount(c1Conv.id);
  const afterNotes5 = await currentNoteCount();
  const afterJobs5 = await synthesisJobCount();
  log(`messages: ${beforeMsgs5} → ${afterMsgs5} (Δ=${afterMsgs5 - beforeMsgs5}, expect +1 Live opener)`);
  log(`notes: ${beforeNotes5} → ${afterNotes5} (Δ=${afterNotes5 - beforeNotes5}, expect +1 decision)`);
  log(`synthesis jobs: ${beforeJobs5} → ${afterJobs5} (expect +1)`);

  // ------------------------------------------------------------------------
  step("6. Phase 2 Analyse — real buildAnalysisDraft (3 Anthropic calls)");
  // Mirror startCanvas2ForUser.
  const [c2Gather] = await db
    .insert(subSteps)
    .values({
      userId,
      phaseKey: "analysis",
      step: "gather",
      instance: 1,
      status: "in_progress",
      driver: "ally",
      contentJson: {} as object,
    })
    .returning();
  const c2Analyse = await advanceSubStep(userId, c2Gather.id);
  log(`Phase 2 gather → analyse, sub-step id=${c2Analyse.id}`);

  const [factsP, proseP, panelsP] = await Promise.all([
    getActivePrompt("analysis_facts"),
    getActivePrompt("analysis_prose"),
    getActivePrompt("analysis_panels"),
  ]);
  if (!factsP || !proseP || !panelsP) throw new Error("missing analysis_* prompts");

  const [refreshedConv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.userId, userId), eq(conversations.status, "complete")))
    .orderBy(desc(conversations.completedAt))
    .limit(1);
  const c1Profile = refreshedConv!.profile;
  const c1Flags = (refreshedConv!.flaggedIssues ?? []) as string[];

  const [c2Draft] = await db
    .insert(analysisDrafts)
    .values({
      userId,
      sourceConversationId: c1Conv.id,
      sourceAnalysisId: analysisRow.id,
      status: "thinking",
    })
    .returning();
  log(`draft id=${c2Draft.id} thinking...`);

  const t2 = Date.now();
  const draftOut = await buildAnalysisDraft({
    prompts: {
      facts: { id: factsP.id, content: factsP.content, model: factsP.model },
      prose: { id: proseP.id, content: proseP.content, model: proseP.model },
      panels: { id: panelsP.id, content: panelsP.content, model: panelsP.model },
    },
    firstTakeAnalysis: analysisResult,
    conversationProfile: c1Profile,
    flaggedIssues: c1Flags,
    statementSummaries: summariseStatements(extractedSts).map((s) => ({
      filename: s.filename,
      bankName: s.bankName,
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      transactionCount: s.transactionCount,
    })),
  });
  log(`buildAnalysisDraft done in ${(Date.now() - t2) / 1000}s — claims=${draftOut.claims.length} notes=${draftOut.notes.length}`);

  await db
    .update(analysisDrafts)
    .set({
      status: "ready",
      facts: draftOut.facts as unknown as object,
      prose: draftOut.prose as unknown as object,
      panels: draftOut.panels as unknown as object,
      inputTokens: draftOut.usage.inputTokens,
      outputTokens: draftOut.usage.outputTokens,
      cacheReadTokens: draftOut.usage.cacheReadTokens,
      cacheCreationTokens: draftOut.usage.cacheCreationTokens,
      promptVersionIds: draftOut.promptVersionIds as unknown as object,
      generatedAt: new Date(),
    })
    .where(eq(analysisDrafts.id, c2Draft.id));

  if (draftOut.claims.length > 0) {
    await db.insert(analysisClaims).values(
      draftOut.claims.map((c) => ({
        draftId: c2Draft.id,
        kind: c.kind,
        anchorId: c.anchorId,
        label: c.label,
        category: c.category,
        body: c.body,
        evidenceRefs: c.evidenceRefs as unknown as object,
      })),
    );
  }

  await db
    .update(subSteps)
    .set({
      contentJson: { draftId: c2Draft.id, analysisId: analysisRow.id } as object,
      updatedAt: new Date(),
    })
    .where(eq(subSteps.id, c2Analyse.id));

  await onStateChange({
    userId,
    trigger: "analyse_completed",
    subStepId: c2Analyse.id,
    canvas: "analysis",
    payload: {
      canvas: "analysis",
      draftId: c2Draft.id,
      analysisId: analysisRow.id,
      claimsCount: draftOut.claims.length,
    },
  });
  log("dispatched analyse_completed (analysis) ✓");

  const c2Discuss = await advanceSubStep(userId, c2Analyse.id, {
    contentJson: { draftId: c2Draft.id, analysisId: analysisRow.id },
  });
  log(`Phase 2 advanced: ${c2Analyse.step} → ${c2Discuss.step}`);

  // ------------------------------------------------------------------------
  step("7. Phase 2 Discuss — start + 2 chat turns");
  const [c2Conv] = await db
    .insert(analysisConversations)
    .values({ userId, draftId: c2Draft.id, status: "active", profile: {} as object })
    .returning();
  await db.insert(analysisConversationMessages).values({
    analysisConversationId: c2Conv.id,
    role: "assistant",
    content:
      "Here it is. Have a read — take your time.\n\nIf anything's off, tell me and I'll fix it. When it lands right, tap \"This is me\".",
    isTransition: true,
  });
  log(`Phase 2 conv id=${c2Conv.id} created with opener`);

  const chatPrompt = await getActivePrompt("analysis_chat");
  if (!chatPrompt) throw new Error("no analysis_chat prompt");

  const c2UserTurns = [
    "Looks fair. One thing — my kid's varsity bill is closer to R80k a year, not R50k.",
    "Yeah, exactly that. Otherwise I'm happy with this.",
    // Explicit FAIS guardrail probe — must NOT be answered with "advice"
    // language. New prompt boundary should force "the plan" framing.
    "So where to from here? What's next?",
  ];

  for (const ut of c2UserTurns) {
    const [conv] = await db
      .select()
      .from(analysisConversations)
      .where(eq(analysisConversations.id, c2Conv.id))
      .limit(1);
    const allMsgs = await db
      .select()
      .from(analysisConversationMessages)
      .where(eq(analysisConversationMessages.analysisConversationId, c2Conv.id))
      .orderBy(asc(analysisConversationMessages.createdAt));
    const [userMsgRow] = await db
      .insert(analysisConversationMessages)
      .values({ analysisConversationId: c2Conv.id, role: "user", content: ut })
      .returning();

    const noteRows = await db
      .select()
      .from(analysisClaims)
      .where(and(eq(analysisClaims.draftId, c2Draft.id), eq(analysisClaims.kind, "note")));
    const notes = noteRows.map((n) => ({
      category: n.category ?? "other",
      label: n.label,
      body: n.body ?? "",
      establishedAt: "",
    }));

    log(`user: ${ut.slice(0, 60)}...`);
    const beforeN = await currentNoteCount();
    const { turn, usage } = await runAnalysisChatTurn({
      systemPrompt: chatPrompt.content,
      model: chatPrompt.model,
      draft: {
        id: c2Draft.id,
        status: "ready",
        facts: draftOut.facts as AnalysisFacts,
        prose: draftOut.prose as AnalysisProse,
        panels: draftOut.panels as AnalysisPanels,
      },
      notes,
      history: allMsgs.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      latestUser: ut,
    });

    const [assistantMsg] = await db
      .insert(analysisConversationMessages)
      .values({
        analysisConversationId: c2Conv.id,
        role: "assistant",
        content: turn.reply,
        status: turn.action === "mark_complete" ? "complete" : null,
        promptVersionId: chatPrompt.id,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
      })
      .returning();

    if (turn.noteUpdates.length > 0) {
      await db.insert(analysisClaims).values(
        turn.noteUpdates.map((n, idx) => ({
          draftId: c2Draft.id,
          kind: "note" as const,
          anchorId: `note_turn_${assistantMsg.id}_${idx}`,
          label: n.label,
          category: n.category,
          body: n.body,
          evidenceRefs: { refs: n.evidenceRefs } as unknown as object,
        })),
      );
      // Mirror the route handler dispatch.
      await onStateChange({
        userId,
        trigger: "chat_turn_taken",
        canvas: "analysis",
        payload: {
          canvas: "analysis",
          noteUpdates: turn.noteUpdates,
          sourceMessageId: null,
          legacyConversationMessageId: assistantMsg.id,
          sourceSubStepId: c2Discuss.id,
        },
      });
    }
    const afterN = await currentNoteCount();
    log(`ally: ${turn.reply.slice(0, 80)}... action=${turn.action} noteUpdates=${turn.noteUpdates.length}`);
    log(`record_notes: ${beforeN} → ${afterN} (Δ=${afterN - beforeN})`);
  }

  // ------------------------------------------------------------------------
  step("8. Phase 2 Agree → discuss_agreed");
  const beforeMsgs8 = await analysisMsgCount(c2Conv.id);
  const beforeNotes8 = await currentNoteCount();

  const c2Live = await agreeSubStep(userId, c2Discuss.id);
  await db
    .update(analysisDrafts)
    .set({ status: "agreed", agreedAt: new Date() })
    .where(eq(analysisDrafts.id, c2Draft.id));

  await onStateChange({
    userId,
    trigger: "discuss_agreed",
    subStepId: c2Discuss.id,
    canvas: "analysis",
    payload: { canvas: "analysis", analysisId: analysisRow.id, draftId: c2Draft.id },
  });

  const afterMsgs8 = await analysisMsgCount(c2Conv.id);
  const afterNotes8 = await currentNoteCount();
  log(`Phase 2 live id=${c2Live.id}`);
  log(`messages: ${beforeMsgs8} → ${afterMsgs8} (expect +1 Live opener for analysis)`);
  log(`notes: ${beforeNotes8} → ${afterNotes8} (expect +1 decision)`);

  // ------------------------------------------------------------------------
  step("9. Phase 1 Reopen — live_reopened");
  const beforeMsgs9 = await convMsgCount(c1Conv.id);

  // Reopen Phase 1 Live (live1.id).
  const c1ReDiscuss = await reopenSubStep(userId, live1.id);
  await db
    .update(conversations)
    .set({ status: "active", completedAt: null, updatedAt: new Date() })
    .where(eq(conversations.userId, userId));
  await onStateChange({
    userId,
    trigger: "live_reopened",
    subStepId: live1.id,
    canvas: "picture",
    payload: { canvas: "picture" },
  });
  const afterMsgs9 = await convMsgCount(c1Conv.id);
  log(`Phase 1 re-discuss id=${c1ReDiscuss.id} instance=${c1ReDiscuss.instance}`);
  log(`messages: ${beforeMsgs9} → ${afterMsgs9} (expect +1 re-discuss opener)`);

  // ------------------------------------------------------------------------
  step("10. session_resumed — staleness check + dispatch");
  // Backdate the Phase 1 conversation's latest message.
  await db
    .update(conversationMessages)
    .set({ createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000) }) // 5h ago
    .where(eq(conversationMessages.conversationId, c1Conv.id));
  const [latestMsg] = await db
    .select({ createdAt: conversationMessages.createdAt })
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, c1Conv.id))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(1);
  log(`latest message createdAt=${latestMsg.createdAt}, isStale=${isStale(latestMsg.createdAt)}`);
  if (!isStale(latestMsg.createdAt)) throw new Error("isStale should be true");

  const beforeMsgs10 = await convMsgCount(c1Conv.id);
  await onStateChange({
    userId,
    trigger: "session_resumed",
    canvas: "picture",
    payload: { canvas: "picture", step: "discuss" },
  });
  const afterMsgs10 = await convMsgCount(c1Conv.id);
  log(`messages: ${beforeMsgs10} → ${afterMsgs10} (expect +1 welcome-back)`);

  // ------------------------------------------------------------------------
  step("11. Final state");
  const allNotes = await listNotes({ userId, limit: 500 });
  log(`record_notes total: ${allNotes.length}`);
  console.log("");
  for (const n of allNotes) {
    const cat = n.category ? `[${n.category}]` : "";
    const can = n.sourcePhase ? `(${n.sourcePhase})` : "";
    console.log(`  ${n.kind.padEnd(11)} ${cat.padEnd(15)} ${n.label.slice(0, 70)} ${can}`);
  }

  console.log("\n--- Phase 1 conversation ---");
  const c1Msgs = await db
    .select({ role: conversationMessages.role, content: conversationMessages.content, isTransition: conversationMessages.isTransition })
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, c1Conv.id))
    .orderBy(asc(conversationMessages.createdAt));
  for (const m of c1Msgs) {
    const flag = m.isTransition ? "★" : " ";
    console.log(`  ${flag} ${m.role.padEnd(9)}: ${m.content.replace(/\n/g, " ").slice(0, 100)}${m.content.length > 100 ? "..." : ""}`);
  }

  console.log("\n--- Phase 2 conversation ---");
  const c2Msgs = await db
    .select({ role: analysisConversationMessages.role, content: analysisConversationMessages.content, isTransition: analysisConversationMessages.isTransition })
    .from(analysisConversationMessages)
    .where(eq(analysisConversationMessages.analysisConversationId, c2Conv.id))
    .orderBy(asc(analysisConversationMessages.createdAt));
  for (const m of c2Msgs) {
    const flag = m.isTransition ? "★" : " ";
    console.log(`  ${flag} ${m.role.padEnd(9)}: ${m.content.replace(/\n/g, " ").slice(0, 100)}${m.content.length > 100 ? "..." : ""}`);
  }

  console.log(`\n[e2e] complete in ${((Date.now() - t0) / 1000).toFixed(1)}s — all assertions passed ✓`);
  process.exit(0);
}

async function currentNoteCount(): Promise<number> {
  return (await listNotes({ userId, limit: 1000 })).length;
}
async function convMsgCount(convId: number): Promise<number> {
  const r = await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, convId));
  return r.length;
}
async function analysisMsgCount(convId: number): Promise<number> {
  const r = await db
    .select()
    .from(analysisConversationMessages)
    .where(eq(analysisConversationMessages.analysisConversationId, convId));
  return r.length;
}
async function synthesisJobCount(): Promise<number> {
  const r = await db.select().from(recordSynthesisJobs).where(eq(recordSynthesisJobs.userId, userId));
  return r.length;
}

main().catch((err) => {
  console.error("\n[e2e] FAILED:", err);
  process.exit(1);
});
