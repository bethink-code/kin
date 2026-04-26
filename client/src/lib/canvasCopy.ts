// Single source of truth for canvas-level copy — pill labels, sentence verbs,
// card state captions, narration templates. Change copy here, not in components.

export type CanvasKey = "picture" | "analysis" | "plan" | "progress";

export const CANVAS_KEYS: CanvasKey[] = ["picture", "analysis", "plan", "progress"];

// The short label shown inside the pill itself ("your financial snapshot", etc.).
// Lowercase — it's mid-sentence. Never italicised.
export const CANVAS_PILL_LABEL: Record<CanvasKey, string> = {
  picture: "your financial snapshot",
  analysis: "our analysis",
  plan: "your plan",
  progress: "your progress",
};

// Verb phrase used in the top-bar sentence: "Hi {name}. We're {verb} {pill}".
export const CANVAS_SENTENCE_VERB: Record<CanvasKey, string> = {
  picture: "working on",
  analysis: "looking at",
  plan: "building",
  progress: "watching",
};

// Title-case label shown on the canvas cards in the megamenu (and in section headings).
export const CANVAS_CARD_TITLE: Record<CanvasKey, string> = {
  picture: "Your financial snapshot",
  analysis: "Our analysis",
  plan: "Your plan",
  progress: "Your progress",
};

// State of each canvas relative to the user's journey. `past` is new — a canvas
// the user has already agreed (e.g., Picture when they're in Analysis). `past`
// canvases are visitable read-only via the canvas menu.
export type CanvasCardState = "current" | "next" | "later" | "dormant" | "past";

export const CANVAS_STATE_CAPTION: Record<CanvasCardState, string> = {
  current: "Currently here",
  next: "Unlocks after baseline",
  later: "After analysis",
  dormant: "Lights up when you have a plan",
  past: "Agreed — visit any time",
};

// Returns the relative state of every canvas given (a) the canvas the user
// is currently *viewing* and (b) which canvases they've already agreed. Agreed
// canvases always show as `past` when not being viewed, regardless of linear
// order — this matters once the user can jump backwards via the menu.
export function canvasStates(
  viewing: CanvasKey,
  agreedCanvases: ReadonlySet<CanvasKey> = new Set(),
): Record<CanvasKey, CanvasCardState> {
  const order: CanvasKey[] = ["picture", "analysis", "plan", "progress"];
  // "Furthest reached" = the highest-index canvas that's either viewed or agreed.
  // Everything after it is still `next`/`later`/`dormant`.
  const viewIdx = order.indexOf(viewing);
  let furthestIdx = viewIdx;
  for (const k of agreedCanvases) {
    const i = order.indexOf(k);
    if (i > furthestIdx) furthestIdx = i;
  }
  return order.reduce(
    (acc, k, i) => {
      if (k === viewing) acc[k] = "current";
      else if (agreedCanvases.has(k)) acc[k] = "past";
      else if (i === furthestIdx + 1) acc[k] = "next";
      else if (k === "progress") acc[k] = "dormant";
      else acc[k] = "later";
      return acc;
    },
    {} as Record<CanvasKey, CanvasCardState>,
  );
}

// Short label for the canvas tab bar (under each tab title).
export const CANVAS_TAB_CAPTION: Record<CanvasCardState, string> = {
  current: "you're here",
  next: "next",
  later: "later",
  dormant: "dormant",
  past: "agreed",
};

// ============================================================================
// Universal four-beat rhythm per the architecture spec §3.
// Code uses the stable Beat keys (`gather | analyse | discuss | live`); UI
// labels are editorial per canvas — Gather in picture reads as "Upload docs",
// in analysis as a silent pull, etc. `BEAT_LABEL[canvas][beat]` is the single
// source of truth for beat UI copy going forward.
// ============================================================================

// Per-canvas label + description for each beat. Drives the FootBar stepper
// and the CanvasMenu stage cards. Empty string means the beat has no user-
// facing card for that canvas (e.g. invisible pull-Gather in analysis/plan).
export const BEAT_LABEL: Record<
  CanvasKey,
  Record<"gather" | "analyse" | "discuss" | "live", { title: string; description: string }>
> = {
  picture: {
    gather: {
      title: "Upload docs",
      description: "Your last 12 months of statements — any bank, any format.",
    },
    analyse: {
      title: "Reading you",
      description: "I read across everything and write you a first take.",
    },
    discuss: {
      title: "Talking through",
      description: "We read the first take together and shape it until it lands.",
    },
    live: {
      title: "Live",
      description: "Your picture stays current until something changes.",
    },
  },
  analysis: {
    gather: {
      title: "",
      description: "",
    },
    analyse: {
      title: "Thinking",
      description: "I'm working through everything you've told me.",
    },
    discuss: {
      title: "Refining",
      description: "A first-draft analysis — a story and a comic. We read it together and shape it until it lands.",
    },
    live: {
      title: "Live",
      description: "Your agreed analysis, dated and referenceable.",
    },
  },
  plan: {
    gather: { title: "", description: "" },
    analyse: { title: "Drafting", description: "I draft a plan from your agreed analysis." },
    discuss: { title: "Shaping", description: "We shape the plan together." },
    live: { title: "Live", description: "Your agreed plan." },
  },
  progress: {
    gather: { title: "Check-in", description: "The latest actuals come in." },
    analyse: { title: "Reading the delta", description: "What's changed vs. your plan." },
    discuss: { title: "Talking it through", description: "Where we are, what to do." },
    live: { title: "Live", description: "Your current standing." },
  },
};

// Status line shown on the person's side of the PaneHeader, per beat × driver.
// Derived rather than hand-set per screen.
export const BEAT_STATUS_LINE: Record<
  CanvasKey,
  Record<"gather" | "analyse" | "discuss" | "live", string>
> = {
  picture: {
    gather: "your picture · bring it in",
    analyse: "your picture · witnessing",
    discuss: "your picture · in conversation",
    live: "your picture · agreed",
  },
  analysis: {
    gather: "our analysis · about to start",
    analyse: "our analysis · witnessing",
    discuss: "our analysis · refining together",
    live: "our analysis · agreed",
  },
  plan: {
    gather: "your plan · about to start",
    analyse: "your plan · witnessing",
    discuss: "your plan · shaping together",
    live: "your plan · agreed",
  },
  progress: {
    gather: "your progress · check-in",
    analyse: "your progress · reading the delta",
    discuss: "your progress · talking it through",
    live: "your progress · current",
  },
};

// State line for the Ally side of the PaneHeader. Varies by beat × canvas.
export const BEAT_ALLY_STATE_LINE: Record<
  CanvasKey,
  Record<"gather" | "analyse" | "discuss" | "live", string>
> = {
  picture: {
    gather: "reading",
    analyse: "writing your first take",
    discuss: "in chat",
    live: "here if you need me",
  },
  analysis: {
    gather: "",
    analyse: "thinking",
    discuss: "in chat",
    live: "here if you need me",
  },
  plan: {
    gather: "",
    analyse: "drafting",
    discuss: "in chat",
    live: "here if you need me",
  },
  progress: {
    gather: "reading actuals",
    analyse: "reading the delta",
    discuss: "in chat",
    live: "here if you need me",
  },
};

// ============================================================================
// Legacy sub-step descriptions — kept for the old PhaseActionBar path while
// Canvas 2 is still on its old scaffolding. Remove once Slice 2 ports Canvas 2.
// ============================================================================

// Stage descriptions for the picture canvas sub-steps.
export const PICTURE_STAGE: Record<
  "bring_it_in" | "first_take_gaps" | "agreed" | "live",
  { title: string; description: string }
> = {
  bring_it_in: {
    title: "Upload docs",
    description: "Your last 12 months of statements — any bank, any format.",
  },
  first_take_gaps: {
    title: "First take & gaps",
    description: "I'll write you a first view and ask about what I can't see.",
  },
  agreed: {
    title: "Agreed",
    description: "We agree this as your baseline — dated, referenceable.",
  },
  live: {
    title: "Live",
    description: "Your picture stays current until something changes.",
  },
};

// Stage descriptions for the analysis canvas sub-steps. Every canvas follows the
// same action → refine → agree pattern; Analysis is Thinking → Refining → Agreed.
export const ANALYSIS_STAGE: Record<
  "thinking" | "refining" | "agreed",
  { title: string; description: string }
> = {
  thinking: {
    title: "Thinking",
    description: "I'm working through everything you've told me.",
  },
  refining: {
    title: "Refining",
    description: "A first-draft analysis — a story and a comic. We read it together and shape it until it lands.",
  },
  agreed: {
    title: "Agreed",
    description: "We agree this analysis — dated, referenceable. Your plan unlocks.",
  },
};
