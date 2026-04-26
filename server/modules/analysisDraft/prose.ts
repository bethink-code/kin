import { runStructuredCall, type CallUsage } from "./claude";
import { analysisProseSchema, type AnalysisProse, type AnalysisFacts } from "./schema";

type ProseInput = {
  systemPrompt: string;
  model: string;
  facts: AnalysisFacts;
};

export async function generateProse(input: ProseInput): Promise<{
  prose: AnalysisProse;
  usage: CallUsage;
}> {
  const userMessage = [
    "# Facts (ground truth) — render Format A prose from this.",
    "```json",
    JSON.stringify(input.facts, null, 2),
    "```",
  ].join("\n");

  const { parsed, usage } = await runStructuredCall({
    systemPrompt: input.systemPrompt,
    model: input.model,
    userMessage,
    outputSchema: analysisProseSchema,
  });
  return { prose: parsed, usage };
}
