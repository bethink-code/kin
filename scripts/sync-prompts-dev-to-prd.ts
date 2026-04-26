// Sync the active prompts from dev to prd. Each prompt becomes a NEW version
// in prd (max(version)+1) marked is_active=true; old prd versions are marked
// is_active=false so they're preserved for rollback.
//
// IMPORTANT: this script connects to TWO databases via separate pg pools —
// dev (read source) and prd (write target). The target connection string is
// passed via PRD_DATABASE_URL env var; the source uses DATABASE_URL.
//
// Run:
//   doppler secrets get DATABASE_URL --config prd --plain | xargs -I{} \
//     PRD_DATABASE_URL={} doppler run --config dev -- npx tsx scripts/sync-prompts-dev-to-prd.ts

import { Pool } from "pg";

const SOURCE_URL = process.env.DATABASE_URL;
const TARGET_URL = process.env.PRD_DATABASE_URL;

if (!SOURCE_URL || !TARGET_URL) {
  console.error("Both DATABASE_URL (dev source) and PRD_DATABASE_URL (prd target) must be set");
  process.exit(1);
}

if (SOURCE_URL === TARGET_URL) {
  console.error("REFUSING: source and target URLs are identical. Did you set them right?");
  process.exit(1);
}

const source = new Pool({ connectionString: SOURCE_URL });
const target = new Pool({ connectionString: TARGET_URL });

async function main() {
  // Pull all active prompts from dev.
  const devPrompts = await source.query(
    `select prompt_key, label, description, content, model
     from system_prompts where is_active = true order by prompt_key`,
  );
  console.log(`source (dev): ${devPrompts.rows.length} active prompts`);

  for (const p of devPrompts.rows) {
    // Look up max version on prd for this key.
    const maxR = await target.query(
      `select coalesce(max(version), 0) as max_v from system_prompts where prompt_key = $1`,
      [p.prompt_key],
    );
    const nextVersion = (maxR.rows[0]?.max_v ?? 0) + 1;

    // Deactivate any currently-active version on prd for this key.
    const deactivated = await target.query(
      `update system_prompts set is_active = false where prompt_key = $1 and is_active = true returning version`,
      [p.prompt_key],
    );

    // Insert the new version, active.
    const inserted = await target.query(
      `insert into system_prompts (prompt_key, label, description, content, model, version, is_active)
       values ($1, $2, $3, $4, $5, $6, true)
       returning id, version`,
      [p.prompt_key, p.label, p.description, p.content, p.model, nextVersion],
    );
    const old = deactivated.rows.map((r: { version: number }) => r.version).join(",") || "(none)";
    console.log(
      `  ${p.prompt_key}: prd v${old} → v${inserted.rows[0].version} (id=${inserted.rows[0].id}, model=${p.model})`,
    );
  }

  await source.end();
  await target.end();
  console.log("\n✓ sync complete");
  process.exit(0);
}

main().catch((err) => {
  console.error("[sync] failed:", err);
  process.exit(1);
});
