import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodTypeAny } from "zod";

// Shared Claude client for the three Phase 2 generation calls.
// Matches the pattern in server/modules/analysis/analyse.ts but parameterised
// because we run three structurally-identical calls per draft.

const client = new Anthropic();

export type CallUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

export type StructuredCallInput<S extends ZodTypeAny> = {
  systemPrompt: string;
  model: string;
  userMessage: string;
  outputSchema: S;
  maxTokens?: number;
};

export type StructuredCallOutput<S extends ZodTypeAny> = {
  parsed: import("zod").infer<S>;
  usage: CallUsage;
};

export async function runStructuredCall<S extends ZodTypeAny>(
  input: StructuredCallInput<S>,
): Promise<StructuredCallOutput<S>> {
  const response = await client.messages.parse({
    model: input.model,
    // Default lowered from 16000 — observed outputs are ~3-5k. Callers can
    // override (e.g. analysis_chat sets 1500). Lower ceiling = faster commit.
    max_tokens: input.maxTokens ?? 6000,
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
        content: input.userMessage,
      },
    ],
    output_config: { format: zodOutputFormat(input.outputSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("Structured call returned no parsed output");
  }

  return {
    parsed: response.parsed_output,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

export function sumUsage(usages: CallUsage[]): CallUsage {
  return usages.reduce(
    (acc, u) => ({
      inputTokens: acc.inputTokens + u.inputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + u.cacheReadTokens,
      cacheCreationTokens: acc.cacheCreationTokens + u.cacheCreationTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  );
}
