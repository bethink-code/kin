// Admin tool: seed a reinterpretation rule for a user.
//
// Until chat integration lands, this is the only path for creating rules.
// Run with explicit args; refuses to write without --apply.
//
// Usage (matching kinds — credits_matching / debits_matching):
//   doppler run --project kin --config <env> -- npx tsx scripts/seed-reinterpretation.ts \
//     --email <user-email> \
//     --subject income.salary \
//     --effect include \
//     --kind credits_matching \
//     --pattern "herbal horse" --flags i \
//     --rationale "User stated all Herbal Horse credits are fragments of her R30k salary…" \
//     [--source admin] [--supersede <ruleId>] [--apply] [--refresh]
//
// Usage (range kinds — amount_in_range / date_in_range):
//   --kind amount_in_range  --min 100  --max 1000  [--direction credit|debit]
//   --kind date_in_range    --from 2025-01-01  --to 2025-12-31
//
// Fallback for arbitrary predicate shapes:
//   --predicate '<JSON>'  (instead of --pattern / --min / etc.)
//
// Without --apply, the script previews what it would insert.
// With --supersede <id>, the prior rule of that id is marked superseded by the new one.
// With --refresh, also kicks off refreshCanvas1Analysis after insert.

import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { reinterpretations, users } from "@shared/schema";
import { ruleSchema } from "../server/modules/reinterpretation/schema";
import { refreshCanvas1Analysis } from "../server/modules/analysis/refresh";

neonConfig.webSocketConstructor = ws;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");
const pool = new Pool({ connectionString: url.replace(/[?&]channel_binding=require/, "") });
const db = drizzle(pool, { schema });

// --- Arg parsing ------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const email = arg("email");
const subject = arg("subject");
const effect = arg("effect");
const predicateKind = arg("kind");
const predicateRaw = arg("predicate");
const rationale = arg("rationale");
const source = arg("source") ?? "admin";
const supersedeIdRaw = arg("supersede");
const APPLY = flag("apply");
const REFRESH = flag("refresh");

if (!email || !subject || !effect || !predicateKind || !rationale) {
  console.error(
    "Missing required args. Need: --email --subject --effect --kind --rationale\n" +
      "Plus a predicate spec — either:\n" +
      "  --predicate '<JSON>'  (raw)\n" +
      "  --pattern <regex> [--flags <chars>]            (for credits_matching / debits_matching)\n" +
      "  --min <n> --max <n> [--direction credit|debit] (for amount_in_range)\n" +
      "  --from YYYY-MM-DD --to YYYY-MM-DD              (for date_in_range)\n" +
      "Optional: --source <user_correction|ally_inference|admin>\n" +
      "          --supersede <ruleId>  --apply  --refresh",
  );
  process.exit(1);
}

const supersedeId = supersedeIdRaw ? Number.parseInt(supersedeIdRaw, 10) : null;
if (supersedeIdRaw && !Number.isFinite(supersedeId)) {
  console.error(`--supersede must be a numeric rule id, got: ${supersedeIdRaw}`);
  process.exit(1);
}

// Build the predicate from either the raw JSON arg or the kind-specific args.
// Convenience args avoid PowerShell's JSON escape gymnastics.
let predicate: unknown;
if (predicateRaw) {
  try {
    predicate = JSON.parse(predicateRaw);
  } catch (e) {
    console.error(`--predicate must be valid JSON: ${(e as Error).message}`);
    process.exit(1);
  }
} else if (predicateKind === "credits_matching" || predicateKind === "debits_matching") {
  const pattern = arg("pattern");
  if (!pattern) {
    console.error(`--kind ${predicateKind} requires --pattern <regex> (or --predicate '<JSON>')`);
    process.exit(1);
  }
  const flags = arg("flags");
  predicate = flags ? { pattern, flags } : { pattern };
} else if (predicateKind === "amount_in_range") {
  const min = arg("min") ? Number.parseFloat(arg("min")!) : undefined;
  const max = arg("max") ? Number.parseFloat(arg("max")!) : undefined;
  const direction = arg("direction") as "credit" | "debit" | undefined;
  if (min == null && max == null) {
    console.error("--kind amount_in_range requires at least one of --min or --max");
    process.exit(1);
  }
  predicate = {
    ...(min != null ? { min } : {}),
    ...(max != null ? { max } : {}),
    ...(direction ? { direction } : {}),
  };
} else if (predicateKind === "date_in_range") {
  const from = arg("from");
  const to = arg("to");
  if (!from && !to) {
    console.error("--kind date_in_range requires at least one of --from or --to");
    process.exit(1);
  }
  predicate = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
} else {
  console.error(`Unknown --kind: ${predicateKind}. Pass --predicate '<JSON>' for arbitrary shapes.`);
  process.exit(1);
}

// Validate the rule shape — fail loudly before touching DB.
const parsed = ruleSchema.safeParse({
  subject,
  effect,
  predicateKind,
  predicate,
  rationale,
});
if (!parsed.success) {
  console.error("Rule failed schema validation:");
  console.error(parsed.error.format());
  process.exit(1);
}

(async () => {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }

  console.log("\n=== rule preview ===");
  console.log(JSON.stringify({ userId: u.id, ...parsed.data, source }, null, 2));

  if (!APPLY) {
    console.log("\n[DRY RUN] No changes written. Re-run with --apply to commit.");
    return;
  }

  const [created] = await db
    .insert(reinterpretations)
    .values({
      userId: u.id,
      subject: parsed.data.subject,
      effect: parsed.data.effect,
      predicateKind: parsed.data.predicateKind,
      predicate: parsed.data.predicate as unknown as object,
      rationale: parsed.data.rationale,
      source,
    })
    .returning();
  console.log(`\n[APPLIED] rule ${created.id} created for ${email}.`);

  if (supersedeId != null) {
    const [prior] = await db
      .update(reinterpretations)
      .set({ status: "superseded", supersededBy: created.id, supersededAt: new Date() })
      .where(eq(reinterpretations.id, supersedeId))
      .returning();
    if (prior) {
      console.log(`[SUPERSEDED] rule ${supersedeId} marked superseded by ${created.id}.`);
    } else {
      console.warn(`[SUPERSEDE] no rule with id ${supersedeId} found — nothing superseded.`);
    }
  }

  if (!REFRESH) {
    console.log("Pass --refresh to also kick off a fresh analysis.");
    return;
  }

  console.log("\n[REFRESH] Kicking off refreshCanvas1Analysis…");
  const r = await refreshCanvas1Analysis(u.id);
  console.log(`Started analysis ${r.analysisId}. Polling…`);
  for (let i = 0; i < 60; i++) {
    await new Promise((res) => setTimeout(res, 5000));
    const [a] = await db.select().from(schema.analyses).where(eq(schema.analyses.id, r.analysisId));
    if (a.status !== "analysing") {
      console.log(`Analysis ${r.analysisId} → ${a.status} (${a.errorMessage ?? "no error"})`);
      return;
    }
    if (i % 4 === 3) console.log(`  …still analysing (${(i + 1) * 5}s)`);
  }
  console.log("Polling timed out — check analyses table directly.");
})()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    return pool.end().then(() => process.exit(1));
  });
