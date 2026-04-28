// ============================================================================
// Ally bookend message templates + posting helper.
//
// Per the bookend rhythm rule: every step has an opener (first entry), a
// re-opener (returning after break), and eventually a closer (validation
// confirmation). This file owns the openers + re-openers as deterministic
// strings; closers wait for the agreement-gate / checklist module.
//
// Templates here are inline pending the architecture-spec move into
// `systemPrompts` (keys: picture_*_opener, picture_*_reopener, etc.). The
// shape is stable so the swap is local.
// ============================================================================

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  conversations,
  conversationMessages,
  analysisConversations,
  analysisConversationMessages,
} from "@shared/schema";

type Phase = "picture" | "analysis" | "plan" | "progress";

// --- Templates -------------------------------------------------------------

export const OPENERS: Partial<Record<`${Phase}_${string}`, string>> = {
  picture_live:
    "Done. That's your picture, agreed. I'll be here if anything changes — just shout.",
  analysis_live:
    "Agreed. That's your analysis on the record. I'm here if you want to come back to it.",
  picture_discuss_redo:
    "Okay — pulling this back open. What's changed?",
  analysis_discuss_redo:
    "Pulling this back open. Tell me what we need to look at again.",
};

export const REOPENERS: Partial<Record<`${Phase}_${string}`, string>> = {
  picture_discuss:
    "Welcome back. We were in the middle of going through your picture — want to keep going from where we left off, or is there something else on your mind?",
  analysis_discuss:
    "Welcome back. We were going through your analysis together — want to pick up where we left off?",
};

// Topic starters — Ally's opening turn when the user clicks "Talk about
// this" on an open checklist item. Templates are deliberately one short
// open question; we want the chat to do the heavy lifting from there.
export const TOPIC_STARTERS: Record<string, string> = {
  retirement:
    "Let's talk about retirement. Have you got anything in place — an RA, a pension at work, anything you're putting away for later?",
  debt:
    "Let's talk about debt. Anything I should know about? Loans, credit cards, store accounts, money owed to family — whatever's on the books.",
  lifeCover:
    "Let's talk about life cover. The honest question is: if you weren't here tomorrow, would the people who depend on you be okay? What's in place?",
  medicalCover:
    "Let's talk about medical aid. Have you got hospital cover or full medical aid sorted? Or is that one of the things on the to-do list?",
  incomeProtection:
    "Let's talk about income protection. If you couldn't work for a few months — illness, injury — what would happen to the money coming in?",
  incomeContext:
    "Let's talk about income. The statements show what's coming in, but I want the texture — is it steady, lumpy, do you depend on one source or several?",
  otherAccounts:
    "Let's talk about your other accounts. Anything I'm not seeing in the statements — savings, investments, business accounts, crypto, anything held offshore?",
  tax:
    "Let's talk about tax. Are you on PAYE, provisional, both? Anything that needs sorting out for SARS at the moment?",
  property:
    "Let's talk about property. Do you own where you live, rent, have a bond, rental properties? Whatever's relevant.",
  lifeContext:
    "Let's talk about who's in your life. Partner, dependants, anyone who counts on what you bring in — paint me the picture.",
  will:
    "Let's talk about wills and estate. Have you got a will in place? Up to date? It's the question nobody likes asking but it matters.",
  goals:
    "Let's talk about what you actually want. Big or small, near or far — what would make next year, or the next ten years, feel like a win?",
};

// --- Posting helper --------------------------------------------------------

/**
 * Post an Ally turn into the conversation that backs the given canvas's chat.
 * Routing:
 *   picture  → conversations / conversation_messages (single row per user)
 *   analysis → analysis_conversations / analysis_conversation_messages (latest)
 *
 * Returns the inserted message id, or null if no conversation exists yet
 * (e.g. user hasn't reached Discuss on that canvas — caller can no-op).
 *
 * `isTransition` marks the message for the client to render distinctly.
 */
export async function postAllyMessage(input: {
  userId: string;
  canvas: Phase;
  content: string;
  isTransition?: boolean;
}): Promise<number | null> {
  if (input.canvas === "picture") {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, input.userId))
      .limit(1);
    if (!conv) return null;
    const [msg] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conv.id,
        role: "assistant",
        content: input.content,
        isTransition: input.isTransition ?? true,
      })
      .returning();
    return msg.id;
  }
  if (input.canvas === "analysis") {
    const [conv] = await db
      .select()
      .from(analysisConversations)
      .where(eq(analysisConversations.userId, input.userId))
      .orderBy(desc(analysisConversations.startedAt))
      .limit(1);
    if (!conv) return null;
    const [msg] = await db
      .insert(analysisConversationMessages)
      .values({
        analysisConversationId: conv.id,
        role: "assistant",
        content: input.content,
        isTransition: input.isTransition ?? true,
      })
      .returning();
    return msg.id;
  }
  // plan / progress not built yet
  return null;
}

/**
 * Returns the timestamp of the most recent message in the canvas's chat, or
 * null if there is no conversation / no messages yet. Used by the re-opener
 * trigger to decide if the chat has gone cold.
 */
export async function latestMessageAt(
  userId: string,
  canvas: Phase,
): Promise<Date | null> {
  if (canvas === "picture") {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .limit(1);
    if (!conv) return null;
    const [msg] = await db
      .select({ createdAt: conversationMessages.createdAt })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conv.id))
      .orderBy(desc(conversationMessages.createdAt))
      .limit(1);
    return msg?.createdAt ?? null;
  }
  if (canvas === "analysis") {
    const [conv] = await db
      .select()
      .from(analysisConversations)
      .where(eq(analysisConversations.userId, userId))
      .orderBy(desc(analysisConversations.startedAt))
      .limit(1);
    if (!conv) return null;
    const [msg] = await db
      .select({ createdAt: analysisConversationMessages.createdAt })
      .from(analysisConversationMessages)
      .where(eq(analysisConversationMessages.analysisConversationId, conv.id))
      .orderBy(desc(analysisConversationMessages.createdAt))
      .limit(1);
    return msg?.createdAt ?? null;
  }
  return null;
}

// Threshold for "this chat has gone cold". Chosen at 4 hours: short enough
// that a same-day return doesn't get a re-opener (continuity), long enough
// that an overnight or next-day return does. Will likely move into
// admin-tweakable config; inlined here pending that work.
export const STALE_AFTER_MS = 4 * 60 * 60 * 1000;

export function isStale(latest: Date | null): boolean {
  if (!latest) return false;
  return Date.now() - new Date(latest).getTime() > STALE_AFTER_MS;
}
