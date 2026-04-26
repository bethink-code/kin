import { z } from "zod/v4";

// Canvas 2 — Our analysis
// Three Claude calls produce the draft:
//   1. analysis_facts  → structured ground truth (analysisFactsSchema)
//   2. analysis_prose  → Format A text story   (analysisProseSchema)
//   3. analysis_panels → Format B comic beats  (analysisPanelsSchema)
//
// Prose and panels both carry inline annotations (kind=explain|note).
// The server walks those annotations after generation and writes rows into
// `analysis_claims` so Explain / Notes modes don't re-parse the jsonb on click.

// --- Facts ---------------------------------------------------------------

export const evidenceRefSchema = z.object({
  kind: z.enum(["transaction", "profile", "analysis", "conversation", "statement"]),
  ref: z.string().describe("Opaque identifier — transaction id, profile path like 'family.dependents', statement id, etc."),
});

export const keyFactSchema = z.object({
  statement: z.string().describe("A single observation in Ally's voice. Plain, specific, not preachy."),
  evidenceRefs: z.array(evidenceRefSchema).describe("Where this observation comes from. Never leave empty — if there's no evidence, don't write the fact."),
});

export const factsSectionSchema = z.object({
  id: z.string().describe("Slug — 'income' | 'spending' | 'family_obligations' | 'whats_missing' | etc. Stable across generations so re-renders can re-use claims."),
  salience: z.number().int().min(1).max(10).describe("How much this section matters for THIS person. 10 = opens or near-opens the story. 1 = mention in passing. Drives dynamic ordering."),
  emotionalRegister: z.enum(["gentle", "honest", "warm", "hopeful", "grounding", "celebratory", "matter_of_fact"]).describe("Tone this section should land with — set by what the user revealed in conversation."),
  headline: z.string().describe("One-sentence summary in Ally's voice. The essence of this section if the user read nothing else."),
  keyFacts: z.array(keyFactSchema),
  gaps: z.array(z.string()).describe("What we DON'T know in this area but would want to. These seed future notes/questions — they do not become claims in this draft."),
});

export const analysisFactsSchema = z.object({
  openingRecognition: z.object({
    whatTheyreCarrying: z.string().describe("The emotional weight the user is holding, named specifically. Draws from what they revealed in conversation. NOT data — the feeling behind the data. Example: 'You just signed a bond. It's bigger than you expected, and you're carrying three people who are depending on you working out.'"),
    emotionalRegister: z.enum(["gentle", "honest", "warm", "hopeful", "grounding", "celebratory", "matter_of_fact"]),
  }),
  emotionalTrajectory: z.enum([
    "heavy_to_light",
    "steady",
    "celebratory",
    "grounding",
    "challenging_but_hopeful",
  ]).describe("The arc the story/comic should follow, per PRD §6.5. Most users: heavy_to_light."),
  sections: z.array(factsSectionSchema).describe("Dynamic — only include sections this user has evidence for. Ordered by salience descending. Expect 4-8 sections; not every user gets every category."),
  notesToRaise: z.array(z.object({
    anchorId: z.string().describe("Stable slug, e.g. 'note_retirement' or 'note_house_bond'. Prose and panels reference these when they emit note-kind annotations."),
    category: z.string().describe("'house' | 'retirement' | 'medical_aid' | 'crypto' | 'goals' | 'family' | etc."),
    label: z.string().describe("Short title for the note, e.g. 'Retirement'"),
    body: z.string().describe("Short factual body, e.g. 'Provident fund through employer, no visible contributions outside that.'"),
    evidenceRefs: z.array(evidenceRefSchema),
  })).describe("The facts that should become Notes / Record of Advice entries — dated, attributed, referenceable."),
});

export type AnalysisFacts = z.infer<typeof analysisFactsSchema>;

// --- Prose (Format A) -----------------------------------------------------

export const annotationSchema = z.object({
  kind: z.enum(["explain", "note"]),
  phrase: z.string().describe("The exact text substring from the surrounding copy to highlight. Must appear verbatim in the paragraph/anchor text."),
  anchorId: z.string().describe("Stable id referencing a claim (explain) or note (note). Prose and panels MAY share anchor ids when they reference the same underlying fact."),
});

export const proseParagraphSchema = z.object({
  text: z.string(),
  annotations: z.array(annotationSchema).default([]),
});

export const proseSectionSchema = z.object({
  id: z.string().describe("Matches the facts section id."),
  heading: z.string().optional().describe("Optional — many sections work better without one. Only use when it earns its place."),
  paragraphs: z.array(proseParagraphSchema),
});

export const analysisProseSchema = z.object({
  sections: z.array(proseSectionSchema).describe("Ordered. The first section IS the opening recognition — it must not open with numbers or financial facts."),
  explainClaims: z.array(z.object({
    anchorId: z.string(),
    label: z.string().describe("The pill/highlight copy."),
    body: z.string().describe("One-sentence restatement of the claim, shown in Explain mode header."),
    evidenceRefs: z.array(evidenceRefSchema),
    chartKind: z.enum([
      "none",
      "balance_by_month",
      "spend_by_category",
      "income_over_time",
      "cash_flow_shape",
    ]).describe("Which evidence visual (if any) Explain mode should render. 'none' = text + transactions only."),
  })).describe("Every explain-kind annotation in the prose must have a matching claim here."),
});

export type AnalysisProse = z.infer<typeof analysisProseSchema>;

// --- Panels (Format B) ----------------------------------------------------

export const proportionSchema = z.object({
  parts: z.array(z.object({
    label: z.string(),
    weight: z.number().describe("Relative weight — the renderer normalises these to fractions."),
  })),
});

export const panelBeatSchema = z.object({
  id: z.string().describe("Stable id, e.g. 'income_shape', 'bond_weight'. Matches facts section ids when the beat is tied to one."),
  anchorCopy: z.string().describe("ONE short sentence — the line of text under/beside the panel illustration. Under ~90 chars."),
  metaphor: z.enum([
    "tap_and_basin",
    "holes_in_basin",
    "shield",
    "road_ahead",
    "weights_carried",
    "hands_reaching",
    "crossroads",
    "scale",
    "lamp_lit",
    "empty_chair",
    "open_door",
    "stacked_stones",
    "none",
  ]).describe("The visual metaphor to use. 'none' = copy-only beat (opener or beat of silence). Extend the enum only when a new metaphor is earned."),
  proportion: proportionSchema.optional().describe("Optional proportional visual (e.g., income vs commitments). Rendered deterministically."),
  annotations: z.array(annotationSchema).default([]),
});

export const analysisPanelsSchema = z.object({
  beats: z.array(panelBeatSchema).describe("Ordered top-to-bottom. The first beat IS the opening recognition."),
  explainClaims: z.array(z.object({
    anchorId: z.string(),
    label: z.string(),
    body: z.string(),
    evidenceRefs: z.array(evidenceRefSchema),
    chartKind: z.enum([
      "none",
      "balance_by_month",
      "spend_by_category",
      "income_over_time",
      "cash_flow_shape",
    ]),
  })).describe("Every explain-kind annotation in panels must have a matching claim here. MAY duplicate prose claims if the same anchor is used in both formats."),
});

export type AnalysisPanels = z.infer<typeof analysisPanelsSchema>;

// --- Refining chat --------------------------------------------------------

export const analysisChatTurnSchema = z.object({
  reply: z.string().describe("Ally's response to the user in plain conversational text. One-to-three paragraphs."),
  action: z.enum([
    "reply_only",
    "request_regenerate",
    "mark_complete",
  ]).describe("What this turn should do. reply_only = conversation continues. request_regenerate = the user has corrected something substantive and Ally will rewrite the draft. mark_complete = the user has agreed the draft is right (moves to 'agreed')."),
  regenerateReason: z.string().optional().describe("When action=request_regenerate, the short reason that will drive the next generation pass — a plain-language summary of what changed."),
  noteUpdates: z.array(z.object({
    category: z.string(),
    label: z.string(),
    body: z.string(),
    evidenceRefs: z.array(evidenceRefSchema).default([]),
  })).default([]).describe("Notes established or updated on this turn. Each becomes a new Record-of-Advice entry; prior versions stay in history."),
});

export type AnalysisChatTurn = z.infer<typeof analysisChatTurnSchema>;
