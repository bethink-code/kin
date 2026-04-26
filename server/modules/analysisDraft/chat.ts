import { runStructuredCall, type CallUsage } from "./claude";
import {
  analysisChatTurnSchema,
  type AnalysisChatTurn,
  type AnalysisFacts,
  type AnalysisProse,
  type AnalysisPanels,
} from "./schema";

type ChatInput = {
  systemPrompt: string;
  model: string;
  // Latest draft the user is looking at. Passed as-is so the prompt sees exactly
  // what the user sees.
  draft: {
    id: number;
    facts: AnalysisFacts;
    prose: AnalysisProse;
    panels: AnalysisPanels;
    status: string;
  };
  // Running record-of-advice so the model knows what's been established.
  notes: Array<{
    category: string;
    label: string;
    body: string;
    establishedAt: string;
  }>;
  // Conversation history on THIS refining thread. Oldest first.
  history: Array<{ role: "user" | "assistant"; content: string }>;
  latestUser: string;
};

export async function runAnalysisChatTurn(input: ChatInput): Promise<{
  turn: AnalysisChatTurn;
  usage: CallUsage;
}> {
  const userMessage = buildUserMessage(input);
  const { parsed, usage } = await runStructuredCall({
    systemPrompt: input.systemPrompt,
    model: input.model,
    userMessage,
    outputSchema: analysisChatTurnSchema,
    // Lowered from 4000 — analysis_chat replies + noteUpdates fit comfortably
    // in 1500 tokens. The previous ceiling was forcing the model to plan for
    // a much larger response than ever materialised.
    maxTokens: 1500,
  });
  return { turn: parsed, usage };
}

function buildUserMessage(input: ChatInput): string {
  // Compact JSON (no pretty-print). Saves ~30% tokens on the draft + notes
  // blocks, which are the bulk of the input every turn.
  return [
    "# The current draft (what the user is looking at)",
    "```json",
    JSON.stringify({
      draftId: input.draft.id,
      status: input.draft.status,
      facts: input.draft.facts,
      prose: input.draft.prose,
      panels: input.draft.panels,
    }),
    "```",
    "",
    "# Record of advice so far",
    "```json",
    JSON.stringify(input.notes),
    "```",
    "",
    "# Conversation history (this refining thread)",
    ...input.history.map((m) => `**${m.role}:** ${m.content}`),
    "",
    "# Latest user message",
    input.latestUser,
  ].join("\n");
}
