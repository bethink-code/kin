import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  conversations,
  conversationMessages,
  analyses,
  statements as statementsTable,
  type ConversationMessage,
  type Statement,
} from "@shared/schema";
import { isAuthenticated } from "../auth";
import { audit } from "../auditLog";
import { getActivePrompt } from "../modules/prompts/getPrompt";
import { runAndPersistTurn } from "../modules/qa/persistTurn";
import { emptyProfile, type QaProfile } from "../modules/qa/schema";
import type { StatementSummary, QaPhase } from "../modules/qa/chat";
import { onStateChange } from "../modules/stateChange";
import { isStale } from "../modules/stateChange/messages";

// Derive the user's current QA phase from state. Must match how the client
// renders the sub-step so prompts stay in sync with what the user sees.
function derivePhase(
  buildCompletedAt: Date | string | null,
  analysisResult: unknown,
): QaPhase {
  if (!buildCompletedAt) return "bring_it_in";
  if (!analysisResult) return "analysing";
  return "first_take_gaps";
}

type ExtractionShape = {
  bankName?: string | null;
  statementPeriodStart?: string | null;
  statementPeriodEnd?: string | null;
  transactions?: unknown[];
};

function summariseStatements(rows: Statement[]): StatementSummary[] {
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

// Extracted statement detail for the qa chat. Filters to only statements
// that have an extraction result (no point sending nulls). Drops the
// summary fields and just passes the verbatim extraction so Ally can
// enumerate transactions on demand.
function detailsFor(rows: Statement[]) {
  return rows
    .filter((s) => s.status === "extracted" && s.extractionResult != null)
    .map((s) => ({ filename: s.filename, extraction: s.extractionResult }));
}

const router = Router();
router.use(isAuthenticated);

const messageBodySchema = z.object({
  content: z.string().min(1).max(5000),
});

// Sliding window for raw history. Older turns are dropped from the replay but stay in
// the DB for display. The running profile (on conversations.profile) is the long-term
// memory across the whole conversation; raw older turns become redundant once their
// facts are captured there.
//
// Trimmed from 12 → 6: with Haiku 4.5 the smaller window meaningfully cuts
// per-turn latency without losing context, since the profile is the durable
// memory and older raw turns mostly add noise.
const MAX_HISTORY_MESSAGES = 6;

router.get("/api/qa/conversation", async (req, res) => {
  const user = req.user as { id: string; firstName: string | null; email: string; buildCompletedAt: Date | string | null };
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, user.id))
    .limit(1);

  if (!conversation) {
    return res.json({ conversation: null, messages: [] });
  }

  // Detect a phase transition that needs a fresh Ally opener. We use analysisIdAtStart
  // as a pointer — "the analysis this conversation has been greeted against". When the
  // user's current latest analysis id differs, either the analysis just completed OR
  // was re-run, and we need to insert a fresh "okay, I've read your picture" message.
  const [latestAnalysis] = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.userId, user.id), eq(analyses.status, "done")))
    .orderBy(desc(analyses.createdAt))
    .limit(1);

  const currentPhase = derivePhase(user.buildCompletedAt, latestAnalysis?.result);
  const needsTransitionOpener =
    currentPhase === "first_take_gaps" &&
    latestAnalysis?.id !== undefined &&
    latestAnalysis.id !== conversation.analysisIdAtStart;

  if (needsTransitionOpener && latestAnalysis?.result) {
    const prompt = await getActivePrompt("qa");
    if (prompt) {
      const userStatements = await db
        .select()
        .from(statementsTable)
        .where(eq(statementsTable.userId, user.id));
      const runningProfile = (conversation.profile as QaProfile | null) ?? emptyProfile();
      const runningFlags = (conversation.flaggedIssues as string[] | null) ?? [];

      try {
        // Empty history = Ally greets fresh against the new phase, untainted by
        // earlier bring-it-in messages. The profile carries forward the memory.
        await runAndPersistTurn({
          conversationId: conversation.id,
          userId: user.id,
          prompt,
          user: { firstName: user.firstName, email: user.email },
          phase: currentPhase,
          analysis: latestAnalysis.result,
          statements: summariseStatements(userStatements),
          statementDetails: detailsFor(userStatements),
          profile: runningProfile,
          flaggedIssues: runningFlags,
          history: [],
          historyTruncated: false,
          latestUser: null,
          isTransition: true,
        });
        // Update the pointer so we don't regenerate on subsequent GETs.
        await db
          .update(conversations)
          .set({ analysisIdAtStart: latestAnalysis.id, updatedAt: new Date() })
          .where(eq(conversations.id, conversation.id));
        audit({
          req,
          action: "qa.phase_transition_opener",
          resourceType: "conversation",
          resourceId: String(conversation.id),
          detail: { phase: currentPhase, analysisId: latestAnalysis.id },
        });
      } catch (err) {
        console.error("[qa.conversation] transition opener failed:", err);
        // Soft-fail: return what we have, the user can retry by sending a message.
      }
    }
  }

  // Re-opener: if the chat is active and the latest message is older than the
  // staleness threshold, post a "welcome back" turn before responding so the
  // user lands back into context. Mutually exclusive with the transition
  // opener above — that path inserts a fresh message, so this staleness
  // check returns false on the same request.
  const [latestMsg] = await db
    .select({ createdAt: conversationMessages.createdAt })
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversation.id))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(1);
  if (
    conversation.status === "active" &&
    isStale(latestMsg?.createdAt ?? null)
  ) {
    await onStateChange({
      userId: user.id,
      trigger: "session_resumed",
      canvas: "picture",
      payload: { canvas: "picture", beat: "discuss" },
    });
  }

  const [refreshed] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversation.id))
    .limit(1);
  const messages = await loadMessages(conversation.id);
  res.json({ conversation: refreshed ?? conversation, messages });
});

router.post("/api/qa/start", async (req, res) => {
  const user = req.user as { id: string; firstName: string | null; email: string };

  const [existing] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, user.id))
    .limit(1);

  // If a conversation already exists AND has at least one message, return it as-is.
  // If it exists but is empty (prior attempt failed mid-flight), self-heal by regenerating the opener below.
  if (existing) {
    const existingMessages = await loadMessages(existing.id);
    if (existingMessages.length > 0) {
      return res.json({ conversation: existing, messages: existingMessages });
    }
  }

  // Analysis is optional — during bring-it-in it doesn't exist yet.
  const [latestAnalysis] = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.userId, user.id), eq(analyses.status, "done")))
    .orderBy(desc(analyses.createdAt))
    .limit(1);

  // Statements are always sent — Ally needs them in every phase.
  const userStatements = await db
    .select()
    .from(statementsTable)
    .where(eq(statementsTable.userId, user.id));

  const phase = derivePhase(user.buildCompletedAt as Date | string | null, latestAnalysis?.result);
  const promptKey = phase === "first_take_gaps" ? "qa" : "qa_bring_it_in";
  const prompt = await getActivePrompt(promptKey);
  if (!prompt) {
    return res.status(500).json({ error: "no_active_qa_prompt", detail: { promptKey } });
  }

  const profile = emptyProfile();
  const created = existing
    ? existing
    : (
        await db
          .insert(conversations)
          .values({
            userId: user.id,
            status: "active",
            profile: profile as unknown as object,
            flaggedIssues: [] as unknown as object,
            analysisIdAtStart: latestAnalysis?.id ?? null,
          })
          .returning()
      )[0];

  audit({
    req,
    action: existing ? "qa.conversation_restart_opener" : "qa.conversation_start",
    resourceType: "conversation",
    resourceId: String(created.id),
    detail: { analysisId: latestAnalysis?.id ?? null },
  });

  try {
    const { conversation, assistantMessage } = await runAndPersistTurn({
      conversationId: created.id,
      userId: user.id,
      prompt,
      user: { firstName: user.firstName, email: user.email },
      phase,
      analysis: latestAnalysis?.result ?? null,
      statements: summariseStatements(userStatements),
      statementDetails: detailsFor(userStatements),
      profile,
      flaggedIssues: [],
      history: [],
      historyTruncated: false,
      latestUser: null,
      isTransition: true,
    });
    res.json({ conversation, messages: [assistantMessage] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[qa.start] Claude call failed:", err);
    audit({
      req,
      action: "qa.conversation_start_failed",
      resourceType: "conversation",
      resourceId: String(created.id),
      outcome: "failure",
      detail: { message },
    });
    res.status(500).json({ error: "qa_start_failed", message });
  }
});

router.post("/api/qa/message", async (req, res) => {
  const user = req.user as { id: string; firstName: string | null; email: string };

  const parsed = messageBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, user.id))
    .limit(1);

  if (!conversation) {
    return res.status(404).json({ error: "no_conversation" });
  }
  if (conversation.status === "complete") {
    return res.status(400).json({ error: "conversation_complete" });
  }

  // Re-read latest analysis each turn — may be null during bring-it-in, present once analysis runs.
  const [latestAnalysis] = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.userId, user.id), eq(analyses.status, "done")))
    .orderBy(desc(analyses.createdAt))
    .limit(1);

  // Statements also re-read each turn — a new upload mid-chat should be visible to Ally.
  const userStatements = await db
    .select()
    .from(statementsTable)
    .where(eq(statementsTable.userId, user.id));

  const phase = derivePhase(user.buildCompletedAt as Date | string | null, latestAnalysis?.result);
  const promptKey = phase === "first_take_gaps" ? "qa" : "qa_bring_it_in";
  const prompt = await getActivePrompt(promptKey);
  if (!prompt) {
    return res.status(500).json({ error: "no_active_qa_prompt", detail: { promptKey } });
  }

  // Persist user message first so it survives a failed AI call.
  const [userMsg] = await db
    .insert(conversationMessages)
    .values({
      conversationId: conversation.id,
      role: "user",
      content: parsed.data.content,
    })
    .returning();

  audit({
    req,
    action: "qa.message_send",
    resourceType: "conversation",
    resourceId: String(conversation.id),
  });

  const priorMessages = await loadMessages(conversation.id);
  const fullHistory = priorMessages
    .filter((m) => m.id !== userMsg.id)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  // Trim to a sliding window. Older turns stay in the DB but aren't replayed to Claude —
  // the profile holds the structured memory.
  const historyForModel = fullHistory.slice(-MAX_HISTORY_MESSAGES);
  const historyTruncated = fullHistory.length > historyForModel.length;

  const runningProfile = (conversation.profile as QaProfile | null) ?? emptyProfile();
  const runningFlags = (conversation.flaggedIssues as string[] | null) ?? [];

  try {
    const { conversation: updated, assistantMessage } = await runAndPersistTurn({
      conversationId: conversation.id,
      userId: user.id,
      prompt,
      user: { firstName: user.firstName, email: user.email },
      phase,
      analysis: latestAnalysis?.result ?? null,
      statements: summariseStatements(userStatements),
      statementDetails: detailsFor(userStatements),
      profile: runningProfile,
      flaggedIssues: runningFlags,
      history: historyForModel,
      historyTruncated,
      latestUser: parsed.data.content,
    });

    if (updated.status === "complete") {
      audit({
        req,
        action: "qa.conversation_complete",
        resourceType: "conversation",
        resourceId: String(conversation.id),
      });
    }

    res.json({ conversation: updated, userMessage: userMsg, assistantMessage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[qa.message] Claude call failed:", err);
    audit({
      req,
      action: "qa.message_failed",
      resourceType: "conversation",
      resourceId: String(conversation.id),
      outcome: "failure",
      detail: { message },
    });
    res.status(500).json({ error: "qa_message_failed", message });
  }
});

router.post("/api/qa/pause", async (req, res) => {
  const user = req.user as { id: string };
  const [updated] = await db
    .update(conversations)
    .set({ status: "paused", updatedAt: new Date() })
    .where(and(eq(conversations.userId, user.id), eq(conversations.status, "active")))
    .returning();

  if (!updated) {
    return res.status(404).json({ error: "no_active_conversation" });
  }
  audit({
    req,
    action: "qa.conversation_pause",
    resourceType: "conversation",
    resourceId: String(updated.id),
  });
  res.json(updated);
});

router.post("/api/qa/complete", async (req, res) => {
  const user = req.user as { id: string };
  const [updated] = await db
    .update(conversations)
    .set({ status: "complete", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(conversations.userId, user.id))
    .returning();

  if (!updated) {
    return res.status(404).json({ error: "no_conversation" });
  }
  audit({
    req,
    action: "qa.conversation_complete",
    resourceType: "conversation",
    resourceId: String(updated.id),
    detail: { source: "manual" },
  });
  res.json(updated);
});

async function loadMessages(conversationId: number): Promise<ConversationMessage[]> {
  return db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id));
}

export default router;
