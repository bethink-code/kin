import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  conversations,
  conversationMessages,
  type Conversation,
  type ConversationMessage,
  type SystemPrompt,
} from "@shared/schema";
import { runQaTurn, type StatementSummary, type StatementDetail, type QaPhase } from "./chat";
import { mergeFlaggedIssues, mergeProfile } from "./mergeProfile";
import type { QaProfile } from "./schema";
import { onStateChange } from "../stateChange";
import { refreshCanvas1Analysis } from "../analysis/refresh";

type RunAndPersistInput = {
  conversationId: number;
  userId: string;
  prompt: SystemPrompt;
  user: { firstName: string | null; email: string };
  phase: QaPhase;
  analysis: unknown | null;
  statements: StatementSummary[];
  statementDetails?: StatementDetail[];
  profile: QaProfile;
  flaggedIssues: string[];
  history: Array<{ role: "user" | "assistant"; content: string }>;
  historyTruncated: boolean;
  // null = opening turn, no user input yet
  latestUser: string | null;
  // Set true when this turn is Ally orienting the user into a new step
  // (conversation start, phase transition). Rendered distinctly in the UI.
  isTransition?: boolean;
};

type RunAndPersistOutput = {
  conversation: Conversation;
  assistantMessage: ConversationMessage;
};

// One turn: call Claude, persist assistant message, merge profile + flags, update conversation row.
// Throws if the Claude call fails — caller handles user-facing error + audit.
export async function runAndPersistTurn(input: RunAndPersistInput): Promise<RunAndPersistOutput> {
  const { result, usage } = await runQaTurn({
    systemPrompt: input.prompt.content,
    model: input.prompt.model,
    user: input.user,
    phase: input.phase,
    analysis: input.analysis,
    statements: input.statements,
    statementDetails: input.statementDetails,
    profile: input.profile,
    flaggedIssues: input.flaggedIssues,
    history: input.history,
    historyTruncated: input.historyTruncated,
    latestUser: input.latestUser,
  });

  const [assistantMessage] = await db
    .insert(conversationMessages)
    .values({
      conversationId: input.conversationId,
      role: "assistant",
      content: result.reply,
      profileUpdates: result.profileUpdates as unknown as object,
      status: result.status,
      isTransition: input.isTransition ?? false,
      promptVersionId: input.prompt.id,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
    })
    .returning();

  const mergedProfile = mergeProfile(input.profile, result.profileUpdates);
  const mergedFlags = mergeFlaggedIssues(input.flaggedIssues, result.newFlaggedIssues);
  const newStatus = result.status === "complete" ? "complete" : "active";

  const [conversation] = await db
    .update(conversations)
    .set({
      profile: mergedProfile as unknown as object,
      flaggedIssues: mergedFlags as unknown as object,
      status: newStatus,
      updatedAt: new Date(),
      completedAt: newStatus === "complete" ? new Date() : null,
    })
    .where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, input.userId)))
    .returning();

  // Polarity flip: each turn's newly-established facts also land in the
  // record. Compute deltas against the prior profile so we only write what
  // genuinely changed; corrections and goals (arrays) emit one note per new
  // entry; non-empty strings emit one note when the merged value differs.
  const deltas = diffProfile(input.profile, mergedProfile);
  const newFlags = mergedFlags.filter((f) => !input.flaggedIssues.includes(f));
  if (Object.keys(deltas).length > 0 || newFlags.length > 0) {
    onStateChange({
      userId: input.userId,
      trigger: "chat_turn_taken",
      canvas: "picture",
      payload: {
        canvas: "picture",
        deltas,
        newFlaggedIssues: newFlags,
        // record_notes.source_message_id has an FK to sub_step_messages, but
        // qa chat still writes to the legacy conversation_messages table.
        // Pass null on the FK and stash the legacy id in attributes for
        // traceability until the chat moves to sub_step_messages.
        sourceMessageId: null,
        legacyConversationMessageId: assistantMessage.id,
        sourceSubStepId: null,
      },
    }).catch(() => {});
  }

  // Auto-refresh hook: when Ally judges that the user has just made a
  // substantive correction the rendered analysis depends on, kick off a fresh
  // Canvas 1 analyse pass with the merged profile + flags as context. Fire-
  // and-forget — the new analysis lands on /api/analysis/latest when ready
  // and the client picks it up via its existing polling.
  if (result.triggerRefresh) {
    refreshCanvas1Analysis(input.userId).catch((err) => {
      console.warn("[runAndPersistTurn] auto-refresh failed:", err);
    });
  }

  return { conversation, assistantMessage };
}

// Field-by-field delta. For string fields we emit { before, after, kind:"fact" }
// when the merged value is non-empty AND differs from the prior. For
// corrections/goals (arrays) we emit one entry per genuinely new item, keyed
// by a synthetic field so each becomes its own note.
function diffProfile(prior: QaProfile, merged: QaProfile) {
  const out: Record<string, { before: unknown; after: unknown; kind: "fact" | "preference" | "concern" | "intention" }> = {};
  const stringFields: Array<keyof QaProfile> = [
    "otherAccounts",
    "incomeContext",
    "debt",
    "medicalCover",
    "lifeCover",
    "incomeProtection",
    "retirement",
    "tax",
    "property",
    "lifeContext",
    "will",
  ];
  for (const f of stringFields) {
    const before = prior[f] as string;
    const after = merged[f] as string;
    if (typeof after === "string" && after.trim().length > 0 && after !== before) {
      out[f] = { before: before ?? null, after, kind: "fact" };
    }
  }
  // Corrections and goals: dedup against prior, then emit one record per new
  // item using a stable suffix so multiple new entries in one turn each get
  // their own note.
  const newCorrections = merged.corrections.filter((c) => !prior.corrections.includes(c));
  newCorrections.forEach((c, i) => {
    out[`corrections_${i}`] = { before: null, after: c, kind: "concern" };
  });
  const newGoals = merged.goals.filter((g) => !prior.goals.includes(g));
  newGoals.forEach((g, i) => {
    out[`goals_${i}`] = { before: null, after: g, kind: "intention" };
  });
  return out;
}
