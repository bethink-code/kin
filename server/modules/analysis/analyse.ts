import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { analysisSchema, type AnalysisResult } from "./schema";

const client = new Anthropic();

type AnalyseInput = {
  systemPrompt: string;
  model: string;
  statements: Array<{
    filename: string;
    extraction: unknown;
  }>;
};

type AnalyseOutput = {
  result: AnalysisResult;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
};

export async function analyseStatements(input: AnalyseInput): Promise<AnalyseOutput> {
  const body = buildUserMessage(input.statements);

  const response = await client.messages.parse({
    model: input.model,
    max_tokens: 16000,
    system: [
      {
        type: "text",
        text: input.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: body,
      },
    ],
    output_config: { format: zodOutputFormat(analysisSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("Analysis returned no parsed output");
  }

  return {
    result: response.parsed_output,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

function buildUserMessage(statements: AnalyseInput["statements"]): string {
  const header = `You are being given ${statements.length} extracted bank statements covering a period of months. Analyse the whole set together, not one at a time.\n\n`;
  const body = statements
    .map((s, i) => `## Statement ${i + 1} — ${s.filename}\n\`\`\`json\n${JSON.stringify(s.extraction, null, 2)}\n\`\`\``)
    .join("\n\n");
  return header + body;
}
