// ============================================================================
// Checklist derivation — given a sub-step, compute the agreement-gate
// checklist for that step. Pure-ish (reads from DB, no writes), called from
// the GET endpoint AND from the closer handler so what the user sees in the
// gate modal is the same data the closer reads back.
//
// Phase 1 Discuss: items = qa profile fields (the "what to gather" list).
// Phase 2 Discuss: simpler — one item per analysis section, covered when the
//                   user has acknowledged it (chat engagement is the signal).
// Other beats: no checklist (return empty).
// ============================================================================

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  conversations,
  recordNotes,
  analysisDrafts,
  analysisConversationMessages,
  analysisConversations,
  type SubStep,
} from "@shared/schema";
import { emptyProfile, type QaProfile } from "../qa/schema";

export type ChecklistItem = {
  key: string;
  label: string;
  status: "covered" | "skipped" | "pending";
  reason?: string | null;
  evidence?: string | null;
  importance: "core" | "nice";
};

export type Checklist = {
  canvas: string;
  step: string;
  items: ChecklistItem[];
  agreementReady: boolean;
};

const PICTURE_FIELDS: Array<{
  key: keyof QaProfile;
  label: string;
  importance: "core" | "nice";
}> = [
  { key: "retirement", label: "Retirement", importance: "core" },
  { key: "debt", label: "Debt", importance: "core" },
  { key: "lifeCover", label: "Life cover", importance: "core" },
  { key: "medicalCover", label: "Medical cover", importance: "core" },
  { key: "incomeProtection", label: "Income protection", importance: "core" },
  { key: "incomeContext", label: "Income", importance: "core" },
  { key: "otherAccounts", label: "Other accounts", importance: "core" },
  { key: "tax", label: "Tax", importance: "nice" },
  { key: "property", label: "Property", importance: "nice" },
  { key: "lifeContext", label: "Life context (dependants, partner)", importance: "nice" },
  { key: "will", label: "Will / estate", importance: "nice" },
  { key: "goals", label: "Goals", importance: "core" },
];

export async function deriveChecklist(
  userId: string,
  subStep: SubStep,
): Promise<Checklist> {
  // Only Discuss beats have a real checklist. Other beats return empty.
  if (subStep.step !== "discuss") {
    return { canvas: subStep.phaseKey, step: subStep.step, items: [], agreementReady: true };
  }

  if (subStep.phaseKey === "picture") {
    return derivePictureChecklist(userId, subStep);
  }
  if (subStep.phaseKey === "analysis") {
    return deriveAnalysisChecklist(userId, subStep);
  }
  return { canvas: subStep.phaseKey, step: subStep.step, items: [], agreementReady: true };
}

async function derivePictureChecklist(
  userId: string,
  subStep: SubStep,
): Promise<Checklist> {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .limit(1);

  const profile = (conv?.profile as QaProfile | null) ?? emptyProfile();

  // Skipped items live in record_notes as kind="skipped_gap" with category =
  // the profile field key.
  const skipped = await db
    .select()
    .from(recordNotes)
    .where(and(eq(recordNotes.userId, userId), eq(recordNotes.kind, "skipped_gap")));
  const skippedByCategory = new Map<string, string | null>();
  for (const n of skipped) {
    if (n.category) skippedByCategory.set(n.category, n.body);
  }

  const items: ChecklistItem[] = PICTURE_FIELDS.map(({ key, label, importance }) => {
    if (skippedByCategory.has(key)) {
      return {
        key,
        label,
        status: "skipped",
        reason: skippedByCategory.get(key),
        importance,
      };
    }
    const value = profile[key];
    const covered = Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim().length > 0;
    if (covered) {
      const evidence = Array.isArray(value)
        ? value.join("; ")
        : (value as string);
      return {
        key,
        label,
        status: "covered",
        evidence: evidence.length > 120 ? evidence.slice(0, 117) + "..." : evidence,
        importance,
      };
    }
    return { key, label, status: "pending", importance };
  });

  // Agreement is ready when every "core" item is covered or skipped.
  const agreementReady = items
    .filter((i) => i.importance === "core")
    .every((i) => i.status !== "pending");

  return { canvas: "picture", step: "discuss", items, agreementReady };
}

async function deriveAnalysisChecklist(
  userId: string,
  subStep: SubStep,
): Promise<Checklist> {
  const content = (subStep.contentJson ?? {}) as { draftId?: number };
  if (!content.draftId) {
    return { canvas: "analysis", step: "discuss", items: [], agreementReady: false };
  }

  const [draft] = await db
    .select()
    .from(analysisDrafts)
    .where(eq(analysisDrafts.id, content.draftId))
    .limit(1);
  if (!draft) {
    return { canvas: "analysis", step: "discuss", items: [], agreementReady: false };
  }

  // Items = sections of the prose. The user covers a section by either
  // engaging with it in chat or implicitly by reading + agreeing.
  // For this slice, simpler heuristic: one item per section, all marked
  // "covered" once the user has sent at least one chat turn (read engagement).
  // Skipped flow same as picture.
  const prose = (draft.prose ?? {}) as { sections?: Array<{ id: string; heading?: string }> };
  const sections = prose.sections ?? [];

  const [conv] = await db
    .select()
    .from(analysisConversations)
    .where(eq(analysisConversations.draftId, draft.id))
    .orderBy(desc(analysisConversations.startedAt))
    .limit(1);
  const userTurnCount = conv
    ? (
        await db
          .select()
          .from(analysisConversationMessages)
          .where(
            and(
              eq(analysisConversationMessages.analysisConversationId, conv.id),
              eq(analysisConversationMessages.role, "user"),
            ),
          )
      ).length
    : 0;

  const skipped = await db
    .select()
    .from(recordNotes)
    .where(and(eq(recordNotes.userId, userId), eq(recordNotes.kind, "skipped_gap")));
  const skippedByCategory = new Map<string, string | null>();
  for (const n of skipped) {
    if (n.category) skippedByCategory.set(n.category, n.body);
  }

  // Engagement-based: any user turn = "you read it" → all core sections covered.
  const hasEngagement = userTurnCount > 0;
  const items: ChecklistItem[] = sections.map((s) => {
    const key = `section_${s.id}`;
    if (skippedByCategory.has(key)) {
      return { key, label: s.heading ?? s.id, status: "skipped", reason: skippedByCategory.get(key), importance: "core" };
    }
    return {
      key,
      label: s.heading ?? humaniseSectionId(s.id),
      status: hasEngagement ? "covered" : "pending",
      importance: "core",
    };
  });

  // If there are no sections (empty draft), allow agreement anyway — the gate
  // shouldn't block on derivation gaps.
  const agreementReady = items.length === 0 ? true : items.every((i) => i.status !== "pending");
  return { canvas: "analysis", step: "discuss", items, agreementReady };
}

function humaniseSectionId(s: string): string {
  return s.replace(/[_-]/g, " ").replace(/^./, (c) => c.toUpperCase());
}
