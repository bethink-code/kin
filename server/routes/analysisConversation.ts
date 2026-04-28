import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  analysisDrafts,
  analysisClaims,
  analysisConversations,
  analysisConversationMessages,
} from "@shared/schema";
import { isAuthenticated } from "../auth";
import { audit } from "../auditLog";
import { getActivePrompt } from "../modules/prompts/getPrompt";
import { runAnalysisChatTurn } from "../modules/analysisDraft/chat";
import { refreshCanvas2Draft } from "../modules/analysisDraft/refresh";
import type {
  AnalysisFacts,
  AnalysisProse,
  AnalysisPanels,
} from "../modules/analysisDraft/schema";
import { onStateChange } from "../modules/stateChange";
import { isStale } from "../modules/stateChange/messages";

const router = Router();
router.use(isAuthenticated);

const MAX_HISTORY_MESSAGES = 16;

// GET /api/analysis-conversation — latest refining conversation + messages
router.get("/api/analysis-conversation", async (req, res) => {
  const user = req.user as { id: string };
  const [conv] = await db
    .select()
    .from(analysisConversations)
    .where(eq(analysisConversations.userId, user.id))
    .orderBy(desc(analysisConversations.startedAt))
    .limit(1);
  if (!conv) return res.json({ conversation: null, messages: [] });

  // Re-opener: if the chat is active and the latest message has gone cold,
  // post a "welcome back" turn before responding.
  const [latestMsg] = await db
    .select({ createdAt: analysisConversationMessages.createdAt })
    .from(analysisConversationMessages)
    .where(eq(analysisConversationMessages.analysisConversationId, conv.id))
    .orderBy(desc(analysisConversationMessages.createdAt))
    .limit(1);
  if (conv.status === "active" && isStale(latestMsg?.createdAt ?? null)) {
    await onStateChange({
      userId: user.id,
      trigger: "session_resumed",
      canvas: "analysis",
      payload: { canvas: "analysis", step: "discuss" },
    });
  }

  const messages = await loadMessages(conv.id);
  res.json({ conversation: conv, messages });
});

// POST /api/analysis-conversation/start — begin refining thread for the current ready draft
router.post("/api/analysis-conversation/start", async (req, res) => {
  const user = req.user as { id: string };

  const [draft] = await db
    .select()
    .from(analysisDrafts)
    .where(and(eq(analysisDrafts.userId, user.id), eq(analysisDrafts.status, "ready")))
    .orderBy(desc(analysisDrafts.createdAt))
    .limit(1);
  if (!draft) return res.status(400).json({ error: "no_ready_draft" });

  const [existing] = await db
    .select()
    .from(analysisConversations)
    .where(
      and(
        eq(analysisConversations.userId, user.id),
        eq(analysisConversations.draftId, draft.id),
      ),
    )
    .limit(1);
  if (existing) {
    const messages = await loadMessages(existing.id);
    return res.json({ conversation: existing, messages });
  }

  const [created] = await db
    .insert(analysisConversations)
    .values({
      userId: user.id,
      draftId: draft.id,
      status: "active",
      profile: {} as unknown as object,
    })
    .returning();

  // Deterministic opener per PRD §6.3 — "Here it is. Have a read."
  const [opener] = await db
    .insert(analysisConversationMessages)
    .values({
      analysisConversationId: created.id,
      role: "assistant",
      content:
        "Here it is. Have a read — take your time.\n\nIf anything's off, tell me and I'll fix it. When it lands right, tap \"This is me\".",
      isTransition: true,
    })
    .returning();

  audit({
    req,
    action: "analysis_conversation.start",
    resourceType: "analysis_conversation",
    resourceId: String(created.id),
  });

  res.json({ conversation: created, messages: [opener] });
});

const messageBodySchema = z.object({
  content: z.string().min(1).max(5000),
});

// POST /api/analysis-conversation/message
router.post("/api/analysis-conversation/message", async (req, res) => {
  const user = req.user as { id: string };
  const parsed = messageBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_input", detail: parsed.error.flatten() });
  }

  const [conv] = await db
    .select()
    .from(analysisConversations)
    .where(
      and(
        eq(analysisConversations.userId, user.id),
        eq(analysisConversations.status, "active"),
      ),
    )
    .orderBy(desc(analysisConversations.startedAt))
    .limit(1);
  if (!conv) return res.status(404).json({ error: "no_active_conversation" });

  const [draft] = await db
    .select()
    .from(analysisDrafts)
    .where(and(eq(analysisDrafts.id, conv.draftId), eq(analysisDrafts.userId, user.id)))
    .limit(1);
  if (!draft || (draft.status !== "ready" && draft.status !== "agreed")) {
    return res.status(400).json({ error: "draft_not_available", status: draft?.status });
  }

  const prompt = await getActivePrompt("analysis_chat");
  if (!prompt) return res.status(500).json({ error: "no_active_analysis_chat_prompt" });

  const [userMsg] = await db
    .insert(analysisConversationMessages)
    .values({
      analysisConversationId: conv.id,
      role: "user",
      content: parsed.data.content,
    })
    .returning();

  audit({
    req,
    action: "analysis_conversation.message_send",
    resourceType: "analysis_conversation",
    resourceId: String(conv.id),
  });

  const allMessages = await loadMessages(conv.id);
  const priorHistory = allMessages
    .filter((m) => m.id !== userMsg.id)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const history = priorHistory.slice(-MAX_HISTORY_MESSAGES);

  const noteRows = await db
    .select()
    .from(analysisClaims)
    .where(and(eq(analysisClaims.draftId, draft.id), eq(analysisClaims.kind, "note")));
  const notes = noteRows.map((n) => ({
    category: n.category ?? "other",
    label: n.label,
    body: n.body ?? "",
    // TODO (Part 6): track actual established-at per note once analysis_notes table exists.
    establishedAt: "",
  }));

  try {
    const { turn, usage } = await runAnalysisChatTurn({
      systemPrompt: prompt.content,
      model: prompt.model,
      draft: {
        id: draft.id,
        status: draft.status,
        facts: draft.facts as AnalysisFacts,
        prose: draft.prose as AnalysisProse,
        panels: draft.panels as AnalysisPanels,
      },
      notes,
      history,
      latestUser: parsed.data.content,
    });

    const [assistantMsg] = await db
      .insert(analysisConversationMessages)
      .values({
        analysisConversationId: conv.id,
        role: "assistant",
        content: turn.reply,
        status: turn.action === "mark_complete" ? "complete" : null,
        promptVersionId: prompt.id,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
      })
      .returning();

    // Append new Record-of-Advice entries (append-only — prior versions preserved).
    if (turn.noteUpdates.length > 0) {
      await db.insert(analysisClaims).values(
        turn.noteUpdates.map((n, idx) => ({
          draftId: draft.id,
          kind: "note" as const,
          anchorId: `note_turn_${assistantMsg.id}_${idx}`,
          label: n.label,
          category: n.category,
          body: n.body,
          evidenceRefs: { refs: n.evidenceRefs } as unknown as object,
        })),
      );
      // Polarity flip: each note also lands canonically in the record.
      // Note: source_message_id FK targets sub_step_messages, but this chat
      // writes to analysis_conversation_messages. Stash the legacy id in
      // attributes until the chat moves to sub_step_messages.
      onStateChange({
        userId: user.id,
        trigger: "chat_turn_taken",
        canvas: "analysis",
        payload: {
          canvas: "analysis",
          noteUpdates: turn.noteUpdates,
          sourceMessageId: null,
          legacyConversationMessageId: assistantMsg.id,
          sourceSubStepId: null,
        },
      }).catch(() => {});
    }

    if (turn.action === "request_regenerate") {
      // Fire the actual rebuild in the background. refreshCanvas2Draft
      // supersedes the current draft itself, so we don't need to do that
      // separately here. The client picks up the new draft via its existing
      // /api/analysis-draft/current polling.
      refreshCanvas2Draft(user.id).catch((err) => {
        console.warn("[analysis_conversation] auto-refresh failed:", err);
      });
      audit({
        req,
        action: "analysis_draft.regenerate_requested",
        resourceType: "analysis_draft",
        resourceId: String(draft.id),
        detail: { reason: turn.regenerateReason },
      });
    } else if (turn.action === "mark_complete") {
      // Agreement hint — final commitment is still via the explicit /agree button.
      audit({
        req,
        action: "analysis_conversation.agreement_hint",
        resourceType: "analysis_conversation",
        resourceId: String(conv.id),
      });
    }

    await db
      .update(analysisConversations)
      .set({ updatedAt: new Date() })
      .where(eq(analysisConversations.id, conv.id));
    const [updatedConv] = await db
      .select()
      .from(analysisConversations)
      .where(eq(analysisConversations.id, conv.id))
      .limit(1);

    res.json({
      conversation: updatedConv,
      userMessage: userMsg,
      assistantMessage: assistantMsg,
      action: turn.action,
      regenerateReason: turn.regenerateReason ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[analysis_conversation.message] Claude call failed:", err);
    audit({
      req,
      action: "analysis_conversation.message_failed",
      resourceType: "analysis_conversation",
      resourceId: String(conv.id),
      outcome: "failure",
      detail: { message },
    });
    res.status(500).json({ error: "message_failed", message });
  }
});

async function loadMessages(conversationId: number) {
  return db
    .select()
    .from(analysisConversationMessages)
    .where(eq(analysisConversationMessages.analysisConversationId, conversationId))
    .orderBy(
      asc(analysisConversationMessages.createdAt),
      asc(analysisConversationMessages.id),
    );
}

export default router;
