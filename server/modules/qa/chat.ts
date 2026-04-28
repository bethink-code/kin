import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { qaTurnResultSchema, type QaTurnResult, type QaProfile } from "./schema";

const client = new Anthropic();

export type StatementSummary = {
  filename: string;
  status: string; // extracting | extracted | failed
  bankName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  transactionCount: number | null;
};

// Raw extracted statement detail — passed in alongside StatementSummary so
// Ally can answer specific transaction questions ("list December deposits
// from The Herbal Horse"). Lives in the stable cache block so we pay the
// token cost once per session, not per turn.
export type StatementDetail = {
  filename: string;
  // Pass the extraction result through verbatim — the analysis prompt
  // already knows how to read its shape.
  extraction: unknown;
};

export type QaPhase = "bring_it_in" | "analysing" | "first_take_gaps";

type TurnInput = {
  systemPrompt: string;
  model: string;
  user: { firstName: string | null; email: string };
  // bring_it_in = uploading; analysing = user clicked "show me my picture" but analysis not yet ready;
  // first_take_gaps = analysis done, story is visible.
  phase: QaPhase;
  // null when the analysis hasn't finished yet (phases bring_it_in and analysing).
  analysis: unknown | null;
  // What's been uploaded so far. Always send — Ally uses this in every phase.
  statements: StatementSummary[];
  // Optional full transaction detail for the user's extracted statements.
  // Cached in the stable block. When present, Ally can list specific
  // transactions on request and enumerate evidence on data disputes.
  statementDetails?: StatementDetail[];
  profile: QaProfile;
  flaggedIssues: string[];
  history: Array<{ role: "user" | "assistant"; content: string }>;
  // True when older turns were dropped by the server-side history window.
  historyTruncated: boolean;
  // null = opening message, no user input yet
  latestUser: string | null;
};

type TurnOutput = {
  result: QaTurnResult;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
};

export async function runQaTurn(input: TurnInput): Promise<TurnOutput> {
  const { stable, dynamic } = buildContextBlocks(input);

  // Two cache breakpoints: system prompt (stable brief) + stable context block
  // (user/phase/statements/analysis). Dynamic block (profile/flags/opener) is
  // NOT cached — it changes every turn. History after that is also fresh.
  const response = await client.messages.parse({
    model: input.model,
    // Ally's reply is supposed to be short ("a few sentences, never a wall of
    // text"). Capping at 800 helps the model commit faster instead of using
    // the full thinking budget — meaningful latency win.
    max_tokens: 800,
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
          { type: "text", text: stable, cache_control: { type: "ephemeral" } },
          { type: "text", text: dynamic },
        ],
      },
      ...input.history.map((m) => ({ role: m.role, content: m.content })),
      ...(input.latestUser !== null ? [{ role: "user" as const, content: input.latestUser }] : []),
    ],
    output_config: { format: zodOutputFormat(qaTurnResultSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("QA turn returned no parsed output");
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

// Split context into:
//   stable   — content that doesn't change turn-to-turn. Cached.
//   dynamic  — content that changes every turn (profile, flags, opening). Fresh.
function buildContextBlocks(input: TurnInput): { stable: string; dynamic: string } {
  const stable = buildStableContext(input);
  const dynamic = buildDynamicContext(input);
  return { stable, dynamic };
}

function buildStableContext(input: TurnInput): string {
  const who = input.user.firstName
    ? `You're speaking with ${input.user.firstName}.`
    : `You're speaking with a user whose first name you don't know — avoid using a name.`;

  const statementsBlock =
    input.statements.length === 0
      ? "(no statements uploaded yet)"
      : input.statements.map((s) => formatStatementLine(s)).join("\n");

  const sections: string[] = [who, "", `## Current phase: ${input.phase}`];

  if (input.phase === "bring_it_in") {
    sections.push(
      "They are uploading statements. You do NOT have an analysis yet — don't pretend to. Your job here is to reassure, answer process questions (why statements, what format, what if they have fewer than 12, privacy), and encourage them to keep uploading. Do NOT drive through gaps yet — that's for the next phase.",
    );
  } else if (input.phase === "analysing") {
    sections.push(
      "They've finished uploading and clicked \"show me my picture\". The analysis is running in the background right now and will finish shortly. You do NOT have the analysis yet. Do NOT ask for more statements — they're done with that. Do NOT drive through gaps — you don't have the story yet. If they ask what to do next, tell them the analysis is running (should take about a minute) and then you'll go through the story together. Stay light.",
    );
  } else {
    sections.push(
      "They've uploaded statements and the analysis has run. The story on the left is yours. Your job now is to drive through the gaps — corrections first, then what statements couldn't show, then safety nets, goals, life context.",
    );
  }

  sections.push("", "## Statements so far", statementsBlock, "");

  // Full transaction detail when available. Cached so we pay tokens once per
  // session. Ally needs this to answer "list December transactions from
  // X" and to enumerate evidence when the user contests a number.
  if (input.statementDetails && input.statementDetails.length > 0) {
    sections.push(
      "## Full statement detail (every transaction)",
      "Use this to enumerate evidence when the user asks about specific transactions, dates, deposits, or contests a number. Quote actual amounts and dates rather than summarising.",
      "",
    );
    for (const d of input.statementDetails) {
      sections.push(`### ${d.filename}`, "```json", JSON.stringify(d.extraction), "```", "");
    }
  }

  if (input.analysis) {
    // Compact (no pretty-print). Saves ~30% of analysis tokens vs indent=2.
    sections.push(
      "## Their financial story (from the Analysis phase)",
      "```json",
      JSON.stringify(input.analysis),
      "```",
      "",
    );
  }

  return sections.join("\n");
}

function buildDynamicContext(input: TurnInput): string {
  // Trim the profile to non-empty fields before serialising. Empty strings
  // and empty arrays carry no signal but cost tokens — Ally re-reads them
  // every turn. Compact JSON (no pretty-print) saves more.
  const trimmedProfile = compactProfile(input.profile);
  const profileBlock =
    Object.keys(trimmedProfile).length === 0
      ? "(nothing established yet)"
      : "```json\n" + JSON.stringify(trimmedProfile) + "\n```";

  const sections: string[] = [
    "## What you've already learned from them (running profile)",
    profileBlock,
    "",
    "## Issues you've already flagged (don't repeat these)",
    input.flaggedIssues.length === 0
      ? "(none yet)"
      : input.flaggedIssues.map((f) => `- ${f}`).join("\n"),
    "",
  ];

  if (input.historyTruncated) {
    sections.push(
      "## Memory note",
      "Earlier turns of this conversation have been trimmed — you only see the recent messages below. Everything meaningful from earlier is captured in the running profile above. If the user references something older that isn't in the profile, it's fine to ask again.",
      "",
    );
  }

  const opening =
    input.latestUser === null
      ? input.phase === "first_take_gaps"
        ? "The conversation hasn't started yet. Greet them warmly, acknowledge the story they've just read, state privacy in one line, set the expectation that this takes about 10 minutes, and ask your first correction-check question."
        : input.phase === "analysing"
          ? "The conversation hasn't started yet. Greet them warmly and tell them the analysis is running — it'll be ready in a minute."
          : "The conversation hasn't started yet. Greet them warmly, explain in one or two sentences why you need their bank statements, and invite them to drop pdfs on the left. Privacy in one line. Ask if they have any questions before they start."
      : "The conversation history follows. Respond to their most recent message.";

  sections.push(opening);
  return sections.join("\n");
}

// Strip empty fields (empty strings, empty arrays) so the profile sent to
// Ally only contains what's actually been established. Saves ~50-70% of
// profile tokens for partially-filled profiles.
function compactProfile(p: QaProfile): Partial<QaProfile> {
  const out: Partial<QaProfile> = {};
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === "string" && v.trim().length > 0) (out as Record<string, unknown>)[k] = v;
    else if (Array.isArray(v) && v.length > 0) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function formatStatementLine(s: StatementSummary): string {
  if (s.status === "extracted") {
    const bits: string[] = [s.filename];
    if (s.bankName) bits.push(s.bankName);
    if (s.periodStart && s.periodEnd) bits.push(`${s.periodStart} → ${s.periodEnd}`);
    if (s.transactionCount != null) bits.push(`${s.transactionCount} transactions`);
    return `- ${bits.join(" · ")}`;
  }
  return `- ${s.filename} (${s.status})`;
}
