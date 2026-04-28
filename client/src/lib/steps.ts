// The universal four-step rhythm. Every phase follows this shape.
// See Scratch/ally_architecture_spec.md §3 for the full treatment.

import type { PhaseKey } from "./canvasCopy";

export const STEP_ORDER = ["gather", "draft", "discuss", "live"] as const;
export type Step = (typeof STEP_ORDER)[number];

export type StepStatus =
  | "not_started"
  | "in_progress"
  | "agreed"
  | "superseded"
  | "paused";

export type Driver = "person" | "ally" | "both";

// Shape returned by GET /api/sub-step/current on the client. Lightweight — the
// route projects only what the UI needs, not the full jsonb payload columns.
export type SubStepLite = {
  id: number;
  phaseKey: PhaseKey;
  step: Step;
  instance: number;
  status: StepStatus;
  driver: Driver;
  contentJson: unknown;
  attachmentsJson: unknown;
  errorMessage: string | null;
  predecessorId: number | null;
  startedAt: string | Date;
  agreedAt: string | Date | null;
};

// Who drives a step depends on phase × step. The architecture spec §3 lays it
// out; this is the single source of truth so PaneHeader, FootBar, and the
// server orchestrator all agree.
export function driverForStep(phase: PhaseKey, step: Step): Driver {
  if (step === "gather") {
    // Phase 1 Gather and Phase 4 Gather are user-facing (person drives).
    // Phase 2/3 Gather are invisible pulls (ally drives, but the step auto-
    // completes so nothing renders).
    if (phase === "picture" || phase === "progress") return "person";
    return "ally";
  }
  if (step === "draft") return "ally";
  if (step === "discuss") return "both";
  // live has no driver — step just IS
  return "both";
}

// Relative position of a step against the sub-step the user is viewing.
// Drives the stepper visuals in the foot bar and the stage cards in the
// phase menu.
export type StepRelation = "past" | "current" | "future";

export function stepRelation(current: Step, target: Step): StepRelation {
  const ci = STEP_ORDER.indexOf(current);
  const ti = STEP_ORDER.indexOf(target);
  if (ti < ci) return "past";
  if (ti > ci) return "future";
  return "current";
}

// Helpers for gating the foot bar mode (Waiting / Deciding / WorkingTogether /
// Recovery). See FootBar.tsx for the full matrix.
export function isDraftInProgress(sub: { step: Step; status: StepStatus }): boolean {
  return sub.step === "draft" && sub.status === "in_progress";
}

export function isHitProblem(sub: { step: Step; status: StepStatus; errorMessage: string | null }): boolean {
  return isDraftInProgress(sub) && sub.errorMessage !== null;
}

export function isDiscussInProgress(sub: { step: Step; status: StepStatus }): boolean {
  return sub.step === "discuss" && sub.status === "in_progress";
}
