import { z } from "zod/v4";

// The enriched profile the QA conversation accumulates — per domain brief §4 "What to gather".
// Flat, string-based notes per topic area. Two arrays: corrections and goals.
// Shape is deliberately thin on unions — Anthropic's structured-output endpoint caps the
// combined count of arrays + anyOf parameters at 16 per schema. Plain strings have zero cost.
// Empty string = "nothing learned about this topic yet (or this turn)".
// Goals stay in the user's own words — NEVER translated into financial jargon (brief rule 10 + §8).

export const qaProfileSchema = z.object({
  corrections: z
    .array(z.string())
    .describe("Things the user said were wrong in their story. Short statements, one per correction."),

  otherAccounts: z
    .string()
    .describe("Notes on accounts not visible in the uploaded statements (other banks, savings, investments, credit cards). Empty string if not yet discussed."),

  incomeContext: z
    .string()
    .describe("Notes on income stability, source concentration, side income. Empty string if not yet discussed."),

  debt: z
    .string()
    .describe("Notes on debts not visible in statements (store accounts, family loans, other bank credit cards). Empty string if not yet discussed."),

  medicalCover: z
    .string()
    .describe("Notes on medical aid / hospital cover status. Empty string if not yet discussed."),

  lifeCover: z
    .string()
    .describe("Notes on life cover and who depends on the user's income. Empty string if not yet discussed."),

  incomeProtection: z
    .string()
    .describe("Notes on income protection cover. Empty string if not yet discussed."),

  retirement: z
    .string()
    .describe("Notes on retirement savings — RA, employer fund, provident fund, etc. Empty string if not yet discussed."),

  tax: z
    .string()
    .describe("Notes on tax situation — PAYE, provisional, VAT, company salary. Empty string if not yet discussed."),

  property: z
    .string()
    .describe("Notes on property ownership, bonds, rental. Empty string if not yet discussed."),

  goals: z
    .array(z.string())
    .describe("What the user wants — VERBATIM in their own words. Do not reword into financial jargon."),

  lifeContext: z
    .string()
    .describe("Notes on dependents, partner, living situation, life stage. Empty string if not yet discussed."),

  will: z
    .string()
    .describe("Notes on will / estate planning. Empty string if not yet discussed."),
});

export type QaProfile = z.infer<typeof qaProfileSchema>;

// Agent returns the same shape each turn. Empty strings / empty arrays mean "no change this turn".
// Merging rules: non-empty strings overwrite existing; arrays are concatenated with dedup.
export const qaProfileUpdateSchema = qaProfileSchema;
export type QaProfileUpdate = QaProfile;

export const qaTurnResultSchema = z.object({
  reply: z
    .string()
    .describe(
      "What to say back to the user. Short — a few sentences, never a wall of text. No formatting (no bullets, bold, headers, lists). Conversational. One question at a time, never two."
    ),
  profileUpdates: qaProfileUpdateSchema.describe(
    "Your full current view of the profile. For topics you didn't address this turn, pass an empty string (or empty array for corrections/goals). The server merges: non-empty strings overwrite existing notes, arrays are appended and deduped."
  ),
  newFlaggedIssues: z
    .array(z.string())
    .describe(
      "NEW key issues to flag from what the user just said. One short sentence each. Do not repeat previously flagged issues. Empty array if nothing new to flag."
    ),
  status: z
    .enum(["continuing", "minimum_viable", "complete"])
    .describe(
      "continuing = more to gather; minimum_viable = enough for a picture but could gather more; complete = nothing essential left to gather."
    ),

  triggerRefresh: z
    .boolean()
    .default(false)
    .describe(
      "Set true when the user has just made a substantive correction to a fact that the rendered analysis depends on (e.g. 'that's not salary, it's self-funding from my business'; 'my real income is R30k, not R10k'; 'please update the picture based on what I just told you'). When true, the server kicks off a fresh analysis with the updated profile in context, and the rendered story re-renders. Set FALSE for soft acknowledgements, clarifying questions, and small chat updates that don't change the analysis."
    ),
  regenerateReason: z
    .string()
    .optional()
    .describe(
      "When triggerRefresh=true, a one-sentence summary of what the user corrected — the next analysis pass uses this as a hint. e.g. 'User corrected income: actual salary is R30k/month from The Herbal Horse, fragmented across multiple deposits.'"
    ),
});

export type QaTurnResult = z.infer<typeof qaTurnResultSchema>;

export function emptyProfile(): QaProfile {
  return {
    corrections: [],
    otherAccounts: "",
    incomeContext: "",
    debt: "",
    medicalCover: "",
    lifeCover: "",
    incomeProtection: "",
    retirement: "",
    tax: "",
    property: "",
    goals: [],
    lifeContext: "",
    will: "",
  };
}
