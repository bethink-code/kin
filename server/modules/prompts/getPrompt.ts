import { db } from "../../db";
import { systemPrompts, type SystemPrompt } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";

export async function getActivePrompt(promptKey: string): Promise<SystemPrompt | null> {
  const [row] = await db
    .select()
    .from(systemPrompts)
    .where(and(eq(systemPrompts.promptKey, promptKey), eq(systemPrompts.isActive, true)))
    .limit(1);
  return row ?? null;
}

export async function listPromptVersions(promptKey: string): Promise<SystemPrompt[]> {
  return db
    .select()
    .from(systemPrompts)
    .where(eq(systemPrompts.promptKey, promptKey))
    .orderBy(desc(systemPrompts.version));
}

export async function listActivePrompts(): Promise<SystemPrompt[]> {
  return db
    .select()
    .from(systemPrompts)
    .where(eq(systemPrompts.isActive, true))
    .orderBy(systemPrompts.promptKey);
}
