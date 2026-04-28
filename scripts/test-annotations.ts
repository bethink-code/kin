// Targeted test: trigger a fresh Phase 1 analyse pass and verify the new
// schema (annotations + explainClaims) lands correctly + claims persist
// with analysis_id set (Phase 1, not draft_id).
//
// Run: doppler run -- npx tsx scripts/test-annotations.ts <userId>

import { eq, and } from "drizzle-orm";
import { db } from "../server/db";
import {
  users,
  statements as statementsTable,
  analyses,
  analysisClaims,
  type Statement,
} from "../shared/schema";
import { getActivePrompt } from "../server/modules/prompts/getPrompt";
import { analyseStatements } from "../server/modules/analysis/analyse";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: tsx scripts/test-annotations.ts <userId>");
  process.exit(1);
}

async function main() {
  const t0 = Date.now();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("user not found");

  const sts: Statement[] = await db
    .select()
    .from(statementsTable)
    .where(and(eq(statementsTable.userId, userId), eq(statementsTable.status, "extracted")));
  console.log(`statements: ${sts.length} extracted`);

  const prompt = await getActivePrompt("analysis");
  if (!prompt) throw new Error("no analysis prompt");
  console.log(`prompt v?, model=${prompt.model}, len=${prompt.content.length}`);

  const [analysis] = await db
    .insert(analyses)
    .values({
      userId,
      status: "analysing",
      promptVersionId: prompt.id,
      sourceStatementIds: sts.map((s) => s.id) as unknown as object,
    })
    .returning();
  console.log(`analyses row id=${analysis.id} (analysing)`);

  console.log(`\ncalling analyseStatements...`);
  const { result, usage } = await analyseStatements({
    systemPrompt: prompt.content,
    model: prompt.model,
    statements: sts.map((s) => ({ filename: s.filename, extraction: s.extractionResult })),
    // Test the regen path: pass a fake corrective profile so we can verify
    // the prompt picks it up. (For first-take this is empty/null.)
    conversationProfile: null,
    flaggedIssues: [],
  });
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s — in=${usage.inputTokens} out=${usage.outputTokens}`);

  await db
    .update(analyses)
    .set({
      status: "done",
      result: result as unknown as object,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      completedAt: new Date(),
    })
    .where(eq(analyses.id, analysis.id));

  // Annotation/claim shape check
  const r = result as {
    lifeSnapshotAnnotations?: Array<{ phrase: string; anchorId: string }>;
    income?: { summaryAnnotations?: Array<{ phrase: string; anchorId: string }> };
    spending?: { summaryAnnotations?: Array<{ phrase: string; anchorId: string }> };
    savings?: { summaryAnnotations?: Array<{ phrase: string; anchorId: string }> };
    explainClaims?: Array<{ anchorId: string; label: string; body: string }>;
  };

  console.log("\n--- annotations emitted ---");
  console.log(`lifeSnapshot:        ${(r.lifeSnapshotAnnotations ?? []).length}`);
  console.log(`income.summary:      ${(r.income?.summaryAnnotations ?? []).length}`);
  console.log(`spending.summary:    ${(r.spending?.summaryAnnotations ?? []).length}`);
  console.log(`savings.summary:     ${(r.savings?.summaryAnnotations ?? []).length}`);
  console.log(`explainClaims total: ${(r.explainClaims ?? []).length}`);

  // Persist claims
  const claims = r.explainClaims ?? [];
  const phraseByAnchor = new Map<string, string>();
  for (const a of r.lifeSnapshotAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);
  for (const a of r.income?.summaryAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);
  for (const a of r.spending?.summaryAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);
  for (const a of r.savings?.summaryAnnotations ?? []) phraseByAnchor.set(a.anchorId, a.phrase);

  if (claims.length > 0) {
    await db.insert(analysisClaims).values(
      claims.map((c) => ({
        analysisId: analysis.id,
        kind: "explain" as const,
        anchorId: c.anchorId,
        label: phraseByAnchor.get(c.anchorId) ?? c.label,
        body: c.body,
      })),
    );
  }

  // Verify claims persisted
  const persisted = await db
    .select()
    .from(analysisClaims)
    .where(eq(analysisClaims.analysisId, analysis.id));
  console.log(`\npersisted ${persisted.length} claims with analysis_id=${analysis.id}`);

  console.log("\n--- sample claims ---");
  for (const c of persisted.slice(0, 5)) {
    console.log(`  [${c.anchorId}] "${c.label}"`);
    console.log(`    → ${(c.body ?? "").slice(0, 100)}${(c.body ?? "").length > 100 ? "..." : ""}`);
  }

  // Cross-check: every annotation has a matching claim
  const allAnnotations = [
    ...(r.lifeSnapshotAnnotations ?? []),
    ...(r.income?.summaryAnnotations ?? []),
    ...(r.spending?.summaryAnnotations ?? []),
    ...(r.savings?.summaryAnnotations ?? []),
  ];
  const claimAnchors = new Set(claims.map((c) => c.anchorId));
  const orphanAnchors = allAnnotations.filter((a) => !claimAnchors.has(a.anchorId));
  if (orphanAnchors.length > 0) {
    console.log(`\n⚠ ${orphanAnchors.length} annotation(s) without matching claim:`);
    for (const a of orphanAnchors) console.log(`  - ${a.anchorId}: "${a.phrase}"`);
  } else {
    console.log(`\n✓ every annotation has a matching claim`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
