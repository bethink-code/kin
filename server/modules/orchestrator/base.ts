// Base orchestrator implementation.
//
// Concrete orchestrators (PictureGatherOrchestrator, PictureDraftOrchestrator,
// etc.) extend this. Common machinery — state load/save, status-transition
// guards, audit history, retry tokens — lives here once and is inherited.
//
// Phase A scope: this base class defines the shape and the persistence
// contract. Concrete orchestrators are built one at a time in subsequent
// PRs. PictureDraftOrchestrator is the first one (Phase A reference impl).

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { subSteps } from "@shared/schema";
import {
  type OrchestratorState,
  type OrchestratorStatus,
  newOrchestratorState,
  transitionStatus,
  setExpectedDuration,
} from "./state";
import type {
  ChatTurn,
  ChatTurnResult,
  Orchestrator,
  OrchestratorMeta,
  PhaseHandoff,
  UiAction,
  UiActionResult,
} from "./types";

// --- State persistence -----------------------------------------------------
//
// State lives on `sub_steps` for now — there's already a row per (user,
// phase, step, instance) and extending it is the lightest schema move.
// The orchestrator state goes in a dedicated `orchestrator_state` jsonb
// column on sub_steps (added in the migration that ships with Phase A's
// PR; not yet present, scope-wise).
//
// While that column doesn't exist yet, this module reads/writes a virtual
// "state" computed from existing sub_steps fields — see hydrateState() and
// persistState() below. The migration is a thin replacement.

export abstract class BaseOrchestrator implements Orchestrator {
  abstract readonly meta: OrchestratorMeta;
  readonly userId: string;
  readonly subStepId: number;

  constructor(userId: string, subStepId: number) {
    this.userId = userId;
    this.subStepId = subStepId;
  }

  // --- KNOWING ---

  async getState(): Promise<OrchestratorState> {
    const [row] = await db
      .select()
      .from(subSteps)
      .where(and(eq(subSteps.id, this.subStepId), eq(subSteps.userId, this.userId)));
    if (!row) throw new Error(`sub_step ${this.subStepId} not found for user ${this.userId}`);

    // TODO Phase A migration: read state from sub_steps.orchestrator_state jsonb.
    // For now, hydrate from existing columns so this module is testable
    // before the migration ships.
    return this.hydrateState(row);
  }

  async canDo(action: UiAction): Promise<boolean> {
    const state = await this.getState();
    return this.isActionAllowed(state, action);
  }

  // --- DOING (concrete orchestrators override these) -------------------------

  abstract run(): Promise<void>;
  abstract onChatTurn(turn: ChatTurn): Promise<ChatTurnResult>;
  abstract onUiAction(action: UiAction): Promise<UiActionResult>;

  // --- BRIDGING --------------------------------------------------------------

  abstract handoffTo(next: PhaseHandoff): Promise<OrchestratorState>;

  // --- Helpers shared by concrete orchestrators ------------------------------

  /**
   * Wrap a state-mutating block in load + transition + persist + audit.
   * Concrete orchestrators use this whenever they advance status — keeps
   * audit history honest and persistence atomic.
   */
  protected async transitionTo(
    next: OrchestratorStatus,
    message: string,
    event: string,
  ): Promise<OrchestratorState> {
    const current = await this.getState();
    const updated = transitionStatus(current, next, message, event);
    await this.persistState(updated);
    return updated;
  }

  /**
   * Set the orchestrator's ETA from historical durations. Concrete
   * orchestrators call this when entering `working` status. Default
   * implementation reads from analyses / analysis_drafts completedAt -
   * createdAt across this user (or cohort fallback).
   *
   * Override per orchestrator if the duration model is different
   * (e.g. plan-step durations don't have priors yet).
   */
  protected async setExpectedDurationFromHistory(): Promise<void> {
    const seconds = await this.computeHistoricalP50();
    if (seconds == null) return;
    const current = await this.getState();
    await this.persistState(setExpectedDuration(current, seconds));
  }

  protected async computeHistoricalP50(): Promise<number | null> {
    // TODO Phase A: query analyses / analysis_drafts for this user's prior
    // runs at this (phase, step). Fall back to cohort median if user has none.
    // For now stubbed; concrete orchestrators can override with hardcoded
    // priors per step kind.
    return null;
  }

  // --- Persistence (provisional, replaced by migration) ----------------------

  protected hydrateState(row: typeof subSteps.$inferSelect): OrchestratorState {
    // TODO replace with: row.orchestratorState (jsonb) once the migration ships.
    // Bridge: synthesise OrchestratorState from existing sub_steps fields so
    // we can stand the orchestrator up incrementally without blocking on the
    // schema change.
    const initial = newOrchestratorState({
      phase: row.phaseKey as OrchestratorState["phase"],
      step: row.step as OrchestratorState["step"],
      instance: row.instance,
    });

    // Map sub_step.status (the legacy field) onto orchestrator status.
    const mapped = mapLegacyStatus(row.status, !!row.errorMessage);
    return {
      ...initial,
      status: mapped,
      message: row.errorMessage ?? defaultMessageFor(mapped, row.phaseKey, row.step),
      startedAt: row.updatedAt,
      failure: row.errorMessage
        ? {
            kind: "legacy_error",
            recoverable: true,
            message: row.errorMessage,
          }
        : null,
    };
  }

  protected async persistState(state: OrchestratorState): Promise<void> {
    // TODO replace with: db.update(subSteps).set({ orchestratorState: state }).
    // Bridge: write back the legacy sub_steps fields so the rest of the app
    // continues to work. Once the migration ships and concrete orchestrators
    // are migrated, the legacy bridge goes away.
    const legacyStatus = mapToLegacyStatus(state.status);
    await db
      .update(subSteps)
      .set({
        status: legacyStatus,
        errorMessage: state.failure?.message ?? null,
        updatedAt: new Date(),
        agreedAt: state.status === "done" ? state.startedAt ?? new Date() : null,
      })
      .where(and(eq(subSteps.id, this.subStepId), isNull(subSteps.supersededAt)));
  }

  protected isActionAllowed(state: OrchestratorState, action: UiAction): boolean {
    // Default: most actions are valid in idle/done; failed allows retry;
    // working blocks new actions. Concrete orchestrators override for
    // step-specific rules (e.g. cannot agree a draft that hasn't completed).
    switch (action.kind) {
      case "cta_click":
        return state.status !== "working" && state.status !== "recovering";
      case "agree":
        return state.status === "done";
      case "reopen":
        return state.status === "done";
      case "retry":
        return state.status === "failed";
      case "navigate_back":
        return true;
    }
  }
}

// --- Legacy status bridge --------------------------------------------------
//
// Existing sub_steps.status values: not_started | in_progress | agreed |
// superseded | paused. Map onto OrchestratorStatus for the bridge period.
// Once the orchestrator_state column ships, this module shrinks.

function mapLegacyStatus(
  legacy: string,
  hasError: boolean,
): OrchestratorStatus {
  if (hasError) return "failed";
  switch (legacy) {
    case "in_progress":
      return "working";
    case "agreed":
      return "done";
    case "paused":
      return "waiting";
    case "superseded":
      return "done";
    case "not_started":
    default:
      return "idle";
  }
}

function mapToLegacyStatus(o: OrchestratorStatus): string {
  switch (o) {
    case "working":
    case "recovering":
      return "in_progress";
    case "done":
      return "agreed";
    case "waiting":
    case "blocked":
      return "paused";
    case "failed":
      return "in_progress"; // legacy has no `failed`; signalled via errorMessage
    case "idle":
    default:
      return "not_started";
  }
}

function defaultMessageFor(
  status: OrchestratorStatus,
  phase: string,
  step: string,
): string {
  // Concrete orchestrators provide better messages; this is a fallback for
  // the bridge period. Most paths will replace with a step-specific string.
  if (status === "working") return `Working on ${phase} ${step}…`;
  if (status === "waiting") return "Waiting on you.";
  if (status === "blocked") return "Can't proceed yet.";
  if (status === "done") return "Done.";
  if (status === "failed") return "Hit a snag.";
  if (status === "recovering") return "Trying again.";
  return "Ready.";
}
