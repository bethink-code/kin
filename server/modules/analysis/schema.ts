import { z } from "zod/v4";

// Shape of the analysis result Claude returns.
// Per PRD §4.3 — categorise, identify patterns, find gaps.
// Tone: warm, observational, narrative — NOT dashboard language.

export const categorySchema = z.object({
  category: z.string().describe("Plain-language category name — 'Food & groceries', 'Transport', 'Subscriptions', etc. Not dev-speak."),
  monthlyAverage: z.number().describe("Rough average monthly spend in ZAR as a positive number"),
  percentOfSpend: z.number().describe("Share of total monthly spend as a decimal 0-1"),
  examples: z.array(z.string()).describe("3-5 actual merchant or description examples from the statements"),
});

export const recurringSchema = z.object({
  description: z.string().describe("Description as it appears on statement — exact"),
  amount: z.number().describe("ZAR amount, positive"),
  frequency: z.string().describe('e.g. "monthly on 25th", "every 2nd month"'),
  category: z.string(),
});

export const incomeSourceSchema = z.object({
  description: z.string(),
  monthlyAverage: z.number(),
  frequency: z.string().describe('e.g. "monthly", "irregular"'),
});

export const gapSchema = z.object({
  key: z.string().describe('Short slug — e.g. "retirement", "insurance", "crypto", "other_debt", "employer_benefits", "goals", "concerns"'),
  label: z.string().describe("Human-readable label — 'Retirement savings', 'Insurance cover', etc."),
  whyItMatters: z.string().describe("One or two sentences in plain language explaining why this gap is worth closing"),
  questionToAsk: z.string().describe("The specific conversational question to ask the user next, warm and curious, not interrogative"),
});

// Annotation = a phrase in the prose that the user can click to see an
// inline explanation. Same shape as Phase 2's analysisProseSchema.
export const annotationSchema = z.object({
  kind: z.literal("explain"),
  phrase: z.string().describe("The exact phrase from the surrounding text that becomes clickable. Must appear verbatim in the text."),
  anchorId: z.string().describe("A short stable id for this anchor — e.g. 'income-pattern', 'monthly-average', 'spending-shape'. Used to look up the matching explainClaim."),
});

export const explainClaimSchema = z.object({
  anchorId: z.string().describe("Matches an annotation's anchorId."),
  label: z.string().describe("The phrase being explained, restated."),
  body: z.string().describe("The explanation in 1-3 sentences. The 'why' or 'how' behind the headline phrase. Warm, plain-language."),
  evidenceRefs: z.array(z.object({
    kind: z.string().describe("e.g. 'transactions', 'months', 'category'"),
    ref: z.string().describe("Specific reference — date range, merchant, etc."),
  })).default([]),
  chartKind: z.enum([
    "none",
    "balance_by_month",
    "spend_by_category",
    "income_over_time",
    "cash_flow_shape",
  ]).default("none").describe("If a small evidence chart helps, the kind. Default 'none'."),
});

export const analysisSchema = z.object({
  lifeSnapshot: z.string().describe("A warm 2-3 sentence paragraph describing this person's financial life based on what the statements show. Observational and human — 'Your money comes in once a month. Most of it goes out again within a fortnight.'"),
  lifeSnapshotAnnotations: z.array(annotationSchema).default([]).describe("Phrases in lifeSnapshot worth making clickable for inline explanation. 0-3 items."),

  income: z.object({
    summary: z.string().describe("Short narrative describing income — regularity, sources, variability. Plain language, warm, not clinical."),
    summaryAnnotations: z.array(annotationSchema).default([]).describe("Phrases in summary worth making clickable. 0-3 items."),
    monthlyAverage: z.number().nullable().describe("Average monthly income across the period, ZAR"),
    regularity: z.enum(["steady", "variable", "irregular"]),
    sources: z.array(incomeSourceSchema),
  }),

  spending: z.object({
    summary: z.string().describe("Short narrative describing the shape of spending — calm, non-judgemental."),
    summaryAnnotations: z.array(annotationSchema).default([]).describe("Phrases in summary worth making clickable. 0-3 items."),
    monthlyAverage: z.number().nullable(),
    byCategory: z.array(categorySchema).describe("Categories sorted by monthlyAverage descending"),
  }),

  savings: z.object({
    summary: z.string().describe("A single observation about savings behaviour — what's happening or what isn't. No lecturing."),
    summaryAnnotations: z.array(annotationSchema).default([]).describe("Phrases in summary worth making clickable. 0-3 items."),
    monthlyAverageSaved: z.number().nullable().describe("Can be negative if outflows exceed inflows. Null if unclear."),
    observation: z.string().describe("One sentence — plain, honest, hopeful."),
  }),

  recurring: z.array(recurringSchema).describe("Debit orders / subscriptions / regular outflows detected"),

  gaps: z.array(gapSchema).describe("What the statements cannot show but we need to understand the full picture. Typical gaps: retirement, insurance, crypto, undisclosed debt, employer benefits, goals, concerns. Prioritise the 5-8 most important."),

  explainClaims: z.array(explainClaimSchema).default([]).describe("Every annotation across the document must have a matching explainClaim with the same anchorId. The body is what's shown when the user clicks the phrase."),

  notes: z.string().optional().describe("Anything else worth flagging — unusual patterns, data quality caveats, etc."),
});

export type AnalysisResult = z.infer<typeof analysisSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type ExplainClaim = z.infer<typeof explainClaimSchema>;
