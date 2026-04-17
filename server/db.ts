import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL not set — is Doppler running?");
}

// Neon URLs sometimes include `channel_binding=require`, which breaks the pg driver.
// Strip it defensively so the app doesn't need config tweaks per-environment.
const connectionString = process.env.DATABASE_URL.replace(/[?&]channel_binding=require/, "");

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });
