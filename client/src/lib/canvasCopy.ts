// Single source of truth for phase-level copy — pill labels, sentence verbs,
// card state captions, narration templates. Change copy here, not in components.

export type PhaseKey = "picture" | "analysis" | "plan" | "progress";

export const PHASE_KEYS: PhaseKey[] = ["picture", "analysis", "plan", "progress"];

// The short label shown inside the pill itself ("your financial snapshot", etc.).
// Lowercase — it's mid-sentence. Never italicised.
export const PHASE_PILL_LABEL: Record<PhaseKey, string> = {
  picture: "your financial snapshot",
  analysis: "our analysis",
  plan: "your plan",
  progress: "your progress",
};

// Verb phrase used in the top-bar sentence: "Hi {name}. We're {verb} {pill}".
export const PHASE_SENTENCE_VERB: Record<PhaseKey, string> = {
  picture: "working on",
  analysis: "looking at",
  plan: "building",
  progress: "watching",
};

// Title-case label shown on the phase cards in the megamenu (and in section headings).
export const PHASE_CARD_TITLE: Record<PhaseKey, string> = {
  picture: "Your financial snapshot",
  analysis: "Our analysis",
  plan: "Your plan",
  progress: "Your progress",
};

// State of each phase relative to the user's journey. `past` is new — a phase
// the user has already agreed (e.g., Picture when they're in Analysis). `past`
// phases are visitable read-only via the phase menu.
export type PhaseCardState = "current" | "next" | "later" | "dormant" | "past";

export const PHASE_STATE_CAPTION: Record<PhaseCardState, string> = {
  current: "Currently here",
  next: "Unlocks after baseline",
  later: "After analysis",
  dormant: "Lights up when you have a plan",
  past: "Agreed — visit any time",
};

// Returns the relative state of every phase given (a) the phase the user
// is currently *viewing* and (b) which phases they've already agreed. Agreed
// phases always show as `past` when not being viewed, regardless of linear
// order — this matters once the user can jump backwards via the menu.
export function phaseStates(
  viewing: PhaseKey,
  agreedPhases: ReadonlySet<PhaseKey> = new Set(),
): Record<PhaseKey, PhaseCardState> {
  const order: PhaseKey[] = ["picture", "analysis", "plan", "progress"];
  // "Furthest reached" = the highest-index phase that's either viewed or agreed.
  // Everything after it is still `next`/`later`/`dormant`.
  const viewIdx = order.indexOf(viewing);
  let furthestIdx = viewIdx;
  for (const k of agreedPhases) {
    const i = order.indexOf(k);
    if (i > furthestIdx) furthestIdx = i;
  }
  return order.reduce(
    (acc, k, i) => {
      if (k === viewing) acc[k] = "current";
      else if (agreedPhases.has(k)) acc[k] = "past";
      else if (i === furthestIdx + 1) acc[k] = "next";
      else if (k === "progress") acc[k] = "dormant";
      else acc[k] = "later";
      return acc;
    },
    {} as Record<PhaseKey, PhaseCardState>,
  );
}

// Short label for the phase tab bar (under each tab title).
export const PHASE_TAB_CAPTION: Record<PhaseCardState, string> = {
  current: "you're here",
  next: "next",
  later: "later",
  dormant: "dormant",
  past: "agreed",
};

// ============================================================================
// Universal four-step rhythm per the architecture spec §3.
// Code uses the stable Step keys (`gather | draft | discuss | live`); UI
// labels are editorial per phase — Gather in picture reads as "Upload docs",
// in analysis as a silent pull, etc. `STEP_LABEL[phase][step]` is the single
// source of truth for step UI copy going forward.
// ============================================================================

// Per-phase label + description for each step. Drives the FootBar stepper
// and the PhaseMenu stage cards. Empty string means the step has no user-
// facing card for that phase (e.g. invisible pull-Gather in analysis/plan).
export const STEP_LABEL: Record<
  PhaseKey,
  Record<"gather" | "draft" | "discuss" | "live", { title: string; description: string }>
> = {
  picture: {
    gather: {
      title: "Upload docs",
      description: "Your last 12 months of statements — any bank, any format.",
    },
    draft: {
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
    draft: {
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
    draft: { title: "Drafting", description: "I draft a plan from your agreed analysis." },
    discuss: { title: "Shaping", description: "We shape the plan together." },
    live: { title: "Live", description: "Your agreed plan." },
  },
  progress: {
    gather: { title: "Check-in", description: "The latest actuals come in." },
    draft: { title: "Reading the delta", description: "What's changed vs. your plan." },
    discuss: { title: "Talking it through", description: "Where we are, what to do." },
    live: { title: "Live", description: "Your current standing." },
  },
};

// Status line shown on the person's side of the PaneHeader, per step × driver.
// Derived rather than hand-set per screen.
export const STEP_STATUS_LINE: Record<
  PhaseKey,
  Record<"gather" | "draft" | "discuss" | "live", string>
> = {
  picture: {
    gather: "your picture · bring it in",
    draft: "your picture · witnessing",
    discuss: "your picture · in conversation",
    live: "your picture · agreed",
  },
  analysis: {
    gather: "our analysis · about to start",
    draft: "our analysis · witnessing",
    discuss: "our analysis · refining together",
    live: "our analysis · agreed",
  },
  plan: {
    gather: "your plan · about to start",
    draft: "your plan · witnessing",
    discuss: "your plan · shaping together",
    live: "your plan · agreed",
  },
  progress: {
    gather: "your progress · check-in",
    draft: "your progress · reading the delta",
    discuss: "your progress · talking it through",
    live: "your progress · current",
  },
};

// State line for the Ally side of the PaneHeader. Varies by step × phase.
export const STEP_ALLY_STATE_LINE: Record<
  PhaseKey,
  Record<"gather" | "draft" | "discuss" | "live", string>
> = {
  picture: {
    gather: "reading",
    draft: "writing your first take",
    discuss: "in chat",
    live: "here if you need me",
  },
  analysis: {
    gather: "",
    draft: "thinking",
    discuss: "in chat",
    live: "here if you need me",
  },
  plan: {
    gather: "",
    draft: "drafting",
    discuss: "in chat",
    live: "here if you need me",
  },
  progress: {
    gather: "reading actuals",
    draft: "reading the delta",
    discuss: "in chat",
    live: "here if you need me",
  },
};

// ============================================================================
// Legacy sub-step descriptions — kept for the old PhaseActionBar path while
// Phase 2 is still on its old scaffolding. Remove once Slice 2 ports Phase 2.
// ============================================================================

// Stage descriptions for the picture phase sub-steps.
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

// Stage descriptions for the analysis phase sub-steps. Every phase follows the
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
