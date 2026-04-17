import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { extractionSchema, type ExtractionResult } from "./schema";

const client = new Anthropic();

type ExtractInput = {
  pdfBase64: string;
  systemPrompt: string;
  model: string;
};

type ExtractOutput = {
  result: ExtractionResult;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
};

export async function extractStatement(input: ExtractInput): Promise<ExtractOutput> {
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
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: input.pdfBase64 },
          },
          {
            type: "text",
            text: "Extract the structured data from this bank statement PDF.",
          },
        ],
      },
    ],
    output_config: {
      format: zodOutputFormat(extractionSchema),
    },
  });

  if (!response.parsed_output) {
    throw new Error("Extraction returned no parsed output");
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
