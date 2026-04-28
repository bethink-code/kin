// ============================================================================
// State-change module — single entry point for cross-cutting work that fires
// when a user's state shifts. Called from route handlers and background
// workers in place of bespoke inline writes.
//
// Responsibilities:
//   - Decide which handlers run for a given state-change kind.
//   - Run them isolated (one handler's failure must not block others).
//   - Never throw to the caller — the originating user-facing action must
//     never break because a downstream record write failed.
//
// Why a single module: writes to the record (long-term brain) come from many
// places — chat turns, analyse completions, agree clicks, reopen, etc. Without
// a central spine, each call site reinvents the same "write a note + maybe
// trigger synthesis" plumbing. With it, adding a new effect (e.g. tip
// generation, segment summary) is one new handler entry, not a sweep across
// every route.
// ============================================================================

import * as handlers from "./handlers";

export type StateChangeKind =
  | "chat_turn_taken"
  | "analyse_completed"
  | "discuss_agreed"
  | "live_reopened"
  | "gather_advanced"
  | "session_resumed"
  | "topic_initiated"
  // Open-ended: callers may pass new kinds; unknown kinds run no handlers
  // (logged for visibility) so feature work can roll forward without a
  // corresponding handler being registered first.
  | (string & {});

export type PhaseKey = "picture" | "analysis" | "plan" | "progress";

export type StateChangeContext = {
  userId: string;
  trigger: StateChangeKind;
  subStepId?: number | null;
  canvas?: PhaseKey;
  // Free-form payload; each handler reads what it cares about. Typed as
  // unknown deliberately — the handler narrows.
  payload?: unknown;
};

type Handler = (ctx: StateChangeContext) => Promise<void>;

// Map of trigger → handlers. Order matters: notes get written first, then
// derived effects (synthesis triggers, tip refresh).
const REGISTRY: Record<string, Handler[]> = {
  chat_turn_taken: [handlers.writeNotesFromTurn],
  analyse_completed: [handlers.writeAnalyseSynthesisNote],
  discuss_agreed: [
    handlers.writeAgreementDecision,
    handlers.triggerSynthesisAfterAgree,
    handlers.postAgreedOpener,
  ],
  live_reopened: [handlers.writeReopenDecision, handlers.postReopenOpener],
  gather_advanced: [handlers.writeAdvanceMarker],
  session_resumed: [handlers.postSessionReopener],
  topic_initiated: [handlers.postTopicStarter],
};

/**
 * Fire all handlers registered for a state-change kind. Returns once every
 * handler has run (or failed in isolation). Never throws — failures are
 * logged so the caller's user-facing path never breaks.
 *
 * Callers can either await this (e.g. when subsequent steps depend on writes
 * having landed) or fire-and-forget with `.catch(noop)` for true background
 * dispatch. Either way, the runner contract is the same.
 */
export async function onStateChange(ctx: StateChangeContext): Promise<void> {
  const list = REGISTRY[ctx.trigger];
  if (!list || list.length === 0) {
    // Unknown trigger — log once and move on. New kinds can be added without
    // breaking the call site that fires them first.
    console.warn(`[stateChange] no handlers for trigger: ${ctx.trigger}`);
    return;
  }
  await Promise.all(
    list.map(async (h) => {
      try {
        await h(ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown_error";
        console.error(
          `[stateChange] ${ctx.trigger} handler failed:`,
          h.name || "anonymous",
          message,
        );
      }
    }),
  );
}
