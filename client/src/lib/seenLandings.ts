// Per-(canvas, beat, instance) tracking of which landing cards the user has
// dismissed. Stored in localStorage so refreshes don't re-show the
// interstitial — but the FIRST arrival into each new beat instance does.
//
// Rule: a landing card auto-fires on initial render if the user's current
// (canvas, beat, instance) tuple isn't in the seen set. CTA → transition →
// onDone marks it as seen. From then on, refreshes go straight to content.
// Server-driven beat changes (Gather → Analyse, Discuss → Live, reopen)
// produce a new tuple → fresh landing.

import type { Beat } from "./beats";
import type { CanvasKey } from "./canvasCopy";

const STORAGE_KEY = "ally:seenLandings";

type LandingKey = `${CanvasKey}:${Beat}:${number}`;

export function landingKey(canvas: CanvasKey, beat: Beat, instance: number): LandingKey {
  return `${canvas}:${beat}:${instance}` as LandingKey;
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

export function hasSeenLanding(canvas: CanvasKey, beat: Beat, instance: number): boolean {
  return readAll().has(landingKey(canvas, beat, instance));
}

export function markLandingSeen(canvas: CanvasKey, beat: Beat, instance: number): void {
  const all = readAll();
  all.add(landingKey(canvas, beat, instance));
  writeAll(all);
}

export function hasEverSeenALanding(): boolean {
  return readAll().size > 0;
}
