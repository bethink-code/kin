// Central place for phase-keyed UI strings. Keep copy changes here rather than buried
// inside components. When an admin-editable UI-strings table is built later, this file
// becomes the fallback / seed and the component consumers don't have to change.

export type Phase = "bring_it_in" | "first_take_gaps" | "analysis_refining";

export const LOADER_COPY: Record<Phase, { title: string; sub: string }> = {
  bring_it_in: {
    title: "Settling in…",
    sub: "Just a moment while I get ready for you.",
  },
  first_take_gaps: {
    title: "Reading through your story…",
    sub: "This takes a few seconds the first time.",
  },
  analysis_refining: {
    title: "Ready when you are.",
    sub: "Tell me what's off — or what lands — and I'll work with you.",
  },
};

export const PANE_STATUS_LINE: Record<Phase, string> = {
  bring_it_in: "your picture · bring it in",
  first_take_gaps: "your picture · first take & gaps",
  analysis_refining: "our analysis · refining together",
};
