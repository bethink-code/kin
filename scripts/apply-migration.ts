// Apply a SQL migration file against DATABASE_URL.
// Usage: doppler run --project kin --config <env> -- npx tsx scripts/apply-migration.ts <sql-file>
//
// The migration file is expected to manage its own BEGIN/COMMIT — this runner
// just opens a connection and executes the file as a single multi-statement
// query, then prints a brief schema confirmation for sub_steps.

import fs from "node:fs";
import path from "node:path";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const file = process.argv[2];
if (!file) {
  console.error("Usage: tsx scripts/apply-migration.ts <sql-file>");
  process.exit(1);
}
const sqlPath = path.resolve(file);
if (!fs.existsSync(sqlPath)) {
  console.error(`Not found: ${sqlPath}`);
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set — run via doppler.");
  process.exit(1);
}

const pool = new Pool({ connectionString: url.replace(/[?&]channel_binding=require/, "") });
const sql = fs.readFileSync(sqlPath, "utf8");

(async () => {
  console.log(`Applying ${path.basename(sqlPath)} (${sql.split("\n").length} lines)...\n`);
  await pool.query(sql);
  console.log("Migration applied.\n");

  console.log("=== sub_steps columns ===");
  const sub = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'sub_steps'
    ORDER BY ordinal_position
  `);
  console.table(sub.rows);

  console.log("\n=== record_segments.phase_key present? ===");
  const rs = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'record_segments' AND column_name IN ('phase_key', 'canvas_key')
  `);
  console.table(rs.rows);

  console.log("\n=== record_notes.source_phase present? ===");
  const rn = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'record_notes' AND column_name IN ('source_phase', 'source_canvas')
  `);
  console.table(rn.rows);

  console.log("\n=== sub_steps step values count ===");
  const counts = await pool.query(`SELECT step, COUNT(*)::int AS n FROM sub_steps GROUP BY step ORDER BY step`);
  console.table(counts.rows);
})()
  .then(() => pool.end())
  .catch((e) => {
    console.error("Migration failed:", e);
    return pool.end().then(() => process.exit(1));
  });
