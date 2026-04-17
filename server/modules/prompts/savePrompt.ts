import { db } from "../../db";
import { systemPrompts, type SystemPrompt } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";

type SaveInput = {
  promptKey: string;
  label: string;
  description?: string;
  model: string;
  content: string;
  createdBy: string;
};

// Creates a new active version. Previous active row(s) become inactive.
export async function savePromptVersion(input: SaveInput): Promise<SystemPrompt> {
  return db.transaction(async (tx) => {
    const [prev] = await tx
      .select()
      .from(systemPrompts)
      .where(eq(systemPrompts.promptKey, input.promptKey))
      .orderBy(desc(systemPrompts.version))
      .limit(1);

    const nextVersion = prev ? prev.version + 1 : 1;

    await tx
      .update(systemPrompts)
      .set({ isActive: false })
      .where(and(eq(systemPrompts.promptKey, input.promptKey), eq(systemPrompts.isActive, true)));

    const [created] = await tx
      .insert(systemPrompts)
      .values({
        promptKey: input.promptKey,
        label: input.label,
        description: input.description,
        model: input.model,
        content: input.content,
        version: nextVersion,
        isActive: true,
        createdBy: input.createdBy,
      })
      .returning();

    return created;
  });
}

export async function rollbackTo(promptKey: string, versionId: number): Promise<SystemPrompt> {
  return db.transaction(async (tx) => {
    await tx
      .update(systemPrompts)
      .set({ isActive: false })
      .where(and(eq(systemPrompts.promptKey, promptKey), eq(systemPrompts.isActive, true)));

    const [activated] = await tx
      .update(systemPrompts)
      .set({ isActive: true })
      .where(and(eq(systemPrompts.id, versionId), eq(systemPrompts.promptKey, promptKey)))
      .returning();

    return activated;
  });
}
