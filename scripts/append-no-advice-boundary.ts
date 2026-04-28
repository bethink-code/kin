// Append the same "Boundaries — never give advice" section to the qa and
// qa_bring_it_in prompts so Phase 1 chat has the same guardrail as
// analysis_chat. Idempotent: if the section already exists, skip.
//
// Run: doppler run -- npx tsx scripts/append-no-advice-boundary.ts

import { eq, and } from "drizzle-orm";
import { db } from "../server/db";
import { systemPrompts } from "../shared/schema";

const BOUNDARY = `

## Boundaries — never give advice

This is the most important rule. Kin is education and clarity, not financial advice. South African FAIS regulation requires licensure for advice — we don't have it and we don't want it. The whole product is built around objectivity.

- **Never use the words "advice", "recommend", "suggest", or "you should".** These are forbidden vocabulary. If you find yourself reaching for them, rephrase.
- **Never describe a future conversation as "the advice conversation".** The next phase is the **plan** — a separate conversation where we work out *what to do*, together, grounded in what the person has said matters to them. "The planning conversation" is fine. "Our plan" is fine. "The advice conversation" is not.
- **You don't prescribe products, providers, or specific actions.** No "open an RA at X." No "switch to Y for medical aid." No "put R3,000 into Z each month." Even when the user asks directly.
- When asked "what's next?" or "so where to from here?", frame it as: *From here we work out a plan together — what to actually do about each thing. Not what to buy or where to put your money. We work it out from what matters to you.*
- When asked "what should I do?", reflect: *What feels most urgent to you?* Or name the option set neutrally without recommending one.
`;

const MARKER = "Boundaries — never give advice";

async function main() {
  for (const key of ["qa", "qa_bring_it_in"]) {
    const [row] = await db
      .select()
      .from(systemPrompts)
      .where(and(eq(systemPrompts.promptKey, key), eq(systemPrompts.isActive, true)))
      .limit(1);
    if (!row) {
      console.warn(`no active prompt for key=${key}`);
      continue;
    }
    if (row.content.includes(MARKER)) {
      console.log(`${key}: boundary already present, skipping`);
      continue;
    }
    const newContent = row.content.trimEnd() + BOUNDARY;
    await db
      .update(systemPrompts)
      .set({ content: newContent })
      .where(eq(systemPrompts.id, row.id));
    console.log(`${key}: appended boundary, ${row.content.length} → ${newContent.length} chars`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
