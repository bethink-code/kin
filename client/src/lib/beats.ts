// The universal four-beat rhythm. Every canvas follows this shape.
// See Scratch/ally_architecture_spec.md §3 for the full treatment.

import type { CanvasKey } from "./canvasCopy";

export const BEAT_ORDER = ["gather", "analyse", "discuss", "live"] as const;
export type Beat = (typeof BEAT_ORDER)[number];

export type BeatStatus =
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
  canvasKey: CanvasKey;
  beat: Beat;
  instance: number;
  status: BeatStatus;
  driver: Driver;
  contentJson: unknown;
  attachmentsJson: unknown;
  errorMessage: string | null;
  predecessorId: number | null;
  startedAt: string | Date;
  agreedAt: string | Date | null;
};

// Who drives a beat depends on canvas × beat. The architecture spec §3 lays it
// out; this is the single source of truth so PaneHeader, FootBar, and the
// server orchestrator all agree.
export function driverForBeat(canvas: CanvasKey, beat: Beat): Driver {
  if (beat === "gather") {
    // Canvas 1 Gather and Canvas 4 Gather are user-facing (person drives).
    // Canvas 2/3 Gather are invisible pulls (ally drives, but the beat auto-
    // completes so nothing renders).
    if (canvas === "picture" || canvas === "progress") return "person";
    return "ally";
  }
  if (beat === "analyse") return "ally";
  if (beat === "discuss") return "both";
  // live has no driver — beat just IS
  return "both";
}

// Relative position of a beat against the sub-step the user is viewing.
// Drives the stepper visuals in the foot bar and the stage cards in the
// canvas menu.
export type BeatRelation = "past" | "current" | "future";

export function beatRelation(current: Beat, target: Beat): BeatRelation {
  const ci = BEAT_ORDER.indexOf(current);
  const ti = BEAT_ORDER.indexOf(target);
  if (ti < ci) return "past";
  if (ti > ci) return "future";
  return "current";
}

// Helpers for gating the foot bar mode (Waiting / Deciding / WorkingTogether /
// Recovery). See FootBar.tsx for the full matrix.
export function isAnalyseInProgress(sub: { beat: Beat; status: BeatStatus }): boolean {
  return sub.beat === "analyse" && sub.status === "in_progress";
}

export function isHitProblem(sub: { beat: Beat; status: BeatStatus; errorMessage: string | null }): boolean {
  return isAnalyseInProgress(sub) && sub.errorMessage !== null;
}

export function isDiscussInProgress(sub: { beat: Beat; status: BeatStatus }): boolean {
  return sub.beat === "discuss" && sub.status === "in_progress";
}
