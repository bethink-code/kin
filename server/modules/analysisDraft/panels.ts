import { runStructuredCall, type CallUsage } from "./claude";
import { analysisPanelsSchema, type AnalysisPanels, type AnalysisFacts } from "./schema";

type PanelsInput = {
  systemPrompt: string;
  model: string;
  facts: AnalysisFacts;
};

export async function generatePanels(input: PanelsInput): Promise<{
  panels: AnalysisPanels;
  usage: CallUsage;
}> {
  const userMessage = [
    "# Facts (ground truth) — render Format B comic beats from this.",
    "```json",
    JSON.stringify(input.facts, null, 2),
    "```",
  ].join("\n");

  const { parsed, usage } = await runStructuredCall({
    systemPrompt: input.systemPrompt,
    model: input.model,
    userMessage,
    outputSchema: analysisPanelsSchema,
  });
  return { panels: parsed, usage };
}
