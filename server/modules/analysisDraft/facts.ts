import { runStructuredCall, type CallUsage } from "./claude";
import { analysisFactsSchema, type AnalysisFacts } from "./schema";

type FactsInput = {
  systemPrompt: string;
  model: string;
  // Everything Canvas 1 produced. Shape is intentionally loose — the prompt
  // works off the stringified JSON, we don't re-type each field here.
  firstTakeAnalysis: unknown;
  conversationProfile: unknown;
  flaggedIssues: unknown;
  statementSummaries: Array<{
    filename: string;
    bankName: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    transactionCount: number | null;
  }>;
};

export async function generateFacts(input: FactsInput): Promise<{
  facts: AnalysisFacts;
  usage: CallUsage;
}> {
  const userMessage = buildUserMessage(input);
  const { parsed, usage } = await runStructuredCall({
    systemPrompt: input.systemPrompt,
    model: input.model,
    userMessage,
    outputSchema: analysisFactsSchema,
    // Power users (12+ months of business data) generate Facts outputs that
    // exceed the 6000-token shared default. Saw this for savannah's prd run:
    // Anthropic stopped mid-string at ~24k chars. Prose/panels are bounded by
    // narrative shape, so they keep the lower default.
    maxTokens: 16000,
  });
  return { facts: parsed, usage };
}

function buildUserMessage(input: FactsInput): string {
  return [
    "# Canvas 1 outputs — produce the structured facts for Canvas 2.",
    "",
    "## Statements (summary)",
    "```json",
    JSON.stringify(input.statementSummaries, null, 2),
    "```",
    "",
    "## First-take analysis (from Canvas 1)",
    "```json",
    JSON.stringify(input.firstTakeAnalysis, null, 2),
    "```",
    "",
    "## Conversation profile (everything the user confirmed, corrected, or revealed in Q&A)",
    "```json",
    JSON.stringify(input.conversationProfile, null, 2),
    "```",
    "",
    "## Flagged issues (things Ally noticed during Q&A)",
    "```json",
    JSON.stringify(input.flaggedIssues, null, 2),
    "```",
  ].join("\n");
}
