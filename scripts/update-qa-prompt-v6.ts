// v6 of qa prompt — two new behaviours:
//   1. Show-your-work on data disputes. When the user contests a number Ally
//      has stated (e.g. "no my income is R30k not R10k"), Ally must list the
//      ACTUAL deposits seen — amounts, dates, names — and reason about the
//      gap. Without this, Ally circles back to the same conclusion without
//      ever interrogating the data.
//   2. triggerRefresh guidance. The schema now has triggerRefresh + a
//      regenerateReason field; the prompt needs to teach the model when to
//      set them. False by default; true only when the user has corrected a
//      load-bearing fact in the rendered analysis.
//
// Run: doppler run -- npx tsx scripts/update-qa-prompt-v6.ts

import { eq, and } from "drizzle-orm";
import { db } from "../server/db";
import { systemPrompts } from "../shared/schema";

const showYourWorkSection = `## Show your work on data disputes

When the user contests a number you stated — "that's wrong", "my income is actually X not Y", "you're missing something", "where did you get that from" — do NOT restate the conclusion. Open the books.

You have the full transaction detail in your context. Use it. Walk the user through what you actually saw:

- List the specific deposits (or debits, or whatever's in dispute) with amounts and dates.
- Name the source where you can — the payer name, reference, or counterparty as it appears in the statement.
- Sum them and show the total.
- Then ask the user to help you reconcile the gap.

Example — user says "my income is R30k a month, not R10k":
- WRONG: "I see your income at around R10k based on your statements. Could you tell me more?" — restating the same conclusion.
- RIGHT: "Let me show you what I see. In November on your ABSA account: R3,200 from Herbal Horse on the 4th, R2,500 from Herbal Horse on the 12th, R4,100 on the 24th. December: R2,800 on the 3rd, R3,000 on the 18th, R3,500 on the 27th. That comes to about R10k a month into ABSA. If your real income is R30k, where's the other R20k landing — another bank account, cash, something else?"

This applies to any number in the rendered story they push back on: income, spend categories, savings, transfer flows, frequency claims. If they say it doesn't match their lived experience, the FIRST thing you do is enumerate evidence — not soften, not apologise, not re-confirm. Show the actual data, then ask the question that would close the gap.

Where the data legitimately doesn't show what they're describing (e.g. cash, another bank, a Wallet they fund manually), say so plainly and add it to the corrections list. That's how the picture gets fixed.`;

const triggerRefreshSection = `## When to refresh the picture (triggerRefresh)

The rendered story on the user's screen was written from one snapshot of their information. As you talk, you'll learn things that change the picture — sometimes substantively. Most of the time you simply note them down (corrections, profile fields, flagged issues) and the picture re-renders the next time the user explicitly asks for a refresh.

But for **substantive corrections to load-bearing facts** in the analysis, you should trigger a refresh yourself, mid-chat. Set \`triggerRefresh\` to true and write a one-sentence \`regenerateReason\` summarising what changed. The server will kick off a fresh analysis pass with your updated profile + flags as context, and the story re-renders when ready.

Set triggerRefresh = TRUE when the user:
- Corrects a number that the story is built around. "My salary is R30k, not R10k", "I don't earn from Herbal Horse — that's a self-funding loan to my business".
- Reframes the source or kind of an income/expense. "Those aren't deposits, they're me transferring money in from another account".
- Tells you about a major hidden account or income stream that shifts the headline picture. "I have a separate FNB account where my actual salary lands".
- Explicitly asks you to update the picture. "Please update the picture based on what I just told you", "Can you re-do the analysis with this in mind?".

Set triggerRefresh = FALSE when:
- The user is just answering a gap question (medical aid, will, retirement). The picture hasn't changed — you've just learned a fact for the profile.
- The user is acknowledging or chatting about something already shown.
- The user pushes back on a number but you haven't yet enumerated evidence and reconciled. Show your work first; only refresh if the reconciliation reveals a real correction.
- You're asking for clarification or the correction isn't yet specific.
- It's a small note that doesn't change any rendered number.

When in doubt, lean false. Triggering refreshes too aggressively burns tokens and makes the picture flicker. Reserve it for moments where the story on screen is materially wrong.

When you do trigger a refresh, **acknowledge it in your reply**. Tell the user the picture is updating now. Don't just silently flip the flag.`;

async function main() {
  const [row] = await db
    .select()
    .from(systemPrompts)
    .where(and(eq(systemPrompts.promptKey, "qa"), eq(systemPrompts.isActive, true)))
    .limit(1);
  if (!row) {
    console.error("no active qa prompt");
    process.exit(1);
  }

  let content = row.content;

  // Insert the two new sections immediately before the Output contract.
  const outputContractMarker = "## Output contract (JSON)";
  const idx = content.indexOf(outputContractMarker);
  if (idx < 0) {
    console.error("could not find output contract marker");
    process.exit(1);
  }

  // Idempotency: if the prompt already contains v6 markers, replace them.
  const v6StartMarker = "## Show your work on data disputes";
  const existingStart = content.indexOf(v6StartMarker);
  if (existingStart >= 0) {
    const reIdx = content.indexOf(outputContractMarker, existingStart);
    content = content.slice(0, existingStart) + content.slice(reIdx);
  }

  const insertion = showYourWorkSection + "\n\n" + triggerRefreshSection + "\n\n";
  const reInsertIdx = content.indexOf(outputContractMarker);
  const updated =
    content.slice(0, reInsertIdx) + insertion + content.slice(reInsertIdx);

  // Update the output contract bullet list to mention triggerRefresh +
  // regenerateReason. Replace the existing block.
  const oldContractBlock =
    "- `status`: \"continuing\" (more to gather), \"minimum_viable\" (enough for a picture but could gather more), or \"complete\" (nothing essential left).";
  const newContractBlock =
    "- `status`: \"continuing\" (more to gather), \"minimum_viable\" (enough for a picture but could gather more), or \"complete\" (nothing essential left).\n" +
    "- `triggerRefresh`: boolean. True only when the user has just made a substantive correction to a load-bearing fact in the rendered analysis (see \"When to refresh the picture\" above). Default false.\n" +
    "- `regenerateReason`: when triggerRefresh is true, one sentence summarising what the user corrected — used as a hint for the next analysis pass.";

  const finalContent = updated.includes(newContractBlock)
    ? updated
    : updated.replace(oldContractBlock, newContractBlock);

  if (finalContent === row.content) {
    console.log("no changes — content already up to date");
    process.exit(0);
  }

  await db
    .update(systemPrompts)
    .set({ content: finalContent })
    .where(eq(systemPrompts.id, row.id));
  console.log(`updated qa: ${row.content.length} → ${finalContent.length} chars`);

  const checks = [
    "Show your work on data disputes",
    "where's the other R20k landing",
    "When to refresh the picture",
    "triggerRefresh = TRUE",
    "regenerateReason",
  ];
  const reread = (
    await db.select().from(systemPrompts).where(eq(systemPrompts.id, row.id))
  )[0];
  for (const c of checks) {
    if (!reread.content.includes(c)) {
      console.error(`MISSING: ${c}`);
      process.exit(1);
    }
  }
  console.log("all checks present ✓");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
