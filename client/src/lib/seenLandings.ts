// Per-(canvas, step, instance) tracking of which landing cards the user has
// dismissed. Stored in localStorage so refreshes don't re-show the
// interstitial — but the FIRST arrival into each new step instance does.
//
// Rule: a landing card auto-fires on initial render if the user's current
// (canvas, step, instance) tuple isn't in the seen set. CTA → transition →
// onDone marks it as seen. From then on, refreshes go straight to content.
// Server-driven step changes (Gather → Analyse, Discuss → Live, reopen)
// produce a new tuple → fresh landing.

import type { Step } from "./steps";
import type { PhaseKey } from "./canvasCopy";

const STORAGE_KEY = "ally:seenLandings";

type LandingKey = `${PhaseKey}:${Step}:${number}`;

export function landingKey(canvas: PhaseKey, step: Step, instance: number): LandingKey {
  return `${canvas}:${step}:${instance}` as LandingKey;
}

function readAll(): Set<LandingKey> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as LandingKey[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeAll(set: Set<LandingKey>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    /* localStorage unavailable — degrade gracefully, no persistence */
  }
}

export function hasSeenLanding(canvas: PhaseKey, step: Step, instance: number): boolean {
  return readAll().has(landingKey(canvas, step, instance));
}

export function markLandingSeen(canvas: PhaseKey, step: Step, instance: number): void {
  const all = readAll();
  all.add(landingKey(canvas, step, instance));
  writeAll(all);
}

export function hasEverSeenALanding(): boolean {
  return readAll().size > 0;
}
