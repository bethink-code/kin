import { generateFacts } from "./facts";
import { generateProse } from "./prose";
import { generatePanels } from "./panels";
import { sumUsage, type CallUsage } from "./claude";
import type {
  AnalysisFacts,
  AnalysisProse,
  AnalysisPanels,
  annotationSchema,
} from "./schema";
import type { z } from "zod";

// One Canvas 2 draft = one call to facts, then prose + panels in parallel.
// This module is pure: it does not touch the database. The route persists the
// output (and extracts claim rows) once this returns.

export type BuildInput = {
  prompts: {
    facts: { content: string; model: string; id: number };
    prose: { content: string; model: string; id: number };
    panels: { content: string; model: string; id: number };
  };
  firstTakeAnalysis: unknown;
  conversationProfile: unknown;
  flaggedIssues: unknown;
  statementSummaries: Array<{
    filename: string;
    bankName: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    transactionCount: number | null;
  }>;
};

export type BuildOutput = {
  facts: AnalysisFacts;
  prose: AnalysisProse;
  panels: AnalysisPanels;
  claims: ExtractedClaim[];
  notes: ExtractedNote[];
  usage: CallUsage;
  promptVersionIds: {
    facts: number;
    prose: number;
    panels: number;
  };
};

export type ExtractedClaim = {
  kind: "explain" | "note";
  anchorId: string;
  label: string;
  category: string | null;
  body: string | null;
  evidenceRefs: unknown;
};

export type ExtractedNote = {
  anchorId: string;
  category: string;
  label: string;
  body: string;
  evidenceRefs: unknown;
};

export async function buildAnalysisDraft(input: BuildInput): Promise<BuildOutput> {
  const { facts, usage: factsUsage } = await generateFacts({
    systemPrompt: input.prompts.facts.content,
    model: input.prompts.facts.model,
    firstTakeAnalysis: input.firstTakeAnalysis,
    conversationProfile: input.conversationProfile,
    flaggedIssues: input.flaggedIssues,
    statementSummaries: input.statementSummaries,
  });

  const [proseResult, panelsResult] = await Promise.all([
    generateProse({
      systemPrompt: input.prompts.prose.content,
      model: input.prompts.prose.model,
      facts,
    }),
    generatePanels({
      systemPrompt: input.prompts.panels.content,
      model: input.prompts.panels.model,
      facts,
    }),
  ]);

  const claims = extractClaims(proseResult.prose, panelsResult.panels, facts);
  const notes = facts.notesToRaise.map((n) => ({
    anchorId: n.anchorId,
    category: n.category,
    label: n.label,
    body: n.body,
    evidenceRefs: n.evidenceRefs,
  }));

  return {
    facts,
    prose: proseResult.prose,
    panels: panelsResult.panels,
    claims,
    notes,
    usage: sumUsage([factsUsage, proseResult.usage, panelsResult.usage]),
    promptVersionIds: {
      facts: input.prompts.facts.id,
      prose: input.prompts.prose.id,
      panels: input.prompts.panels.id,
    },
  };
}

type Annotation = z.infer<typeof annotationSchema>;

// Walk prose and panels, collect annotations, dedupe by anchorId. Explain anchors
// get their body from explainClaims in the respective output; note anchors get
// their body from the matching entry in facts.notesToRaise (cross-referenced by
// category/label heuristic — prompts are instructed to keep these stable).
function extractClaims(
  prose: AnalysisProse,
  panels: AnalysisPanels,
  facts: AnalysisFacts,
): ExtractedClaim[] {
  const seen = new Map<string, ExtractedClaim>();

  for (const section of prose.sections) {
    for (const paragraph of section.paragraphs) {
      for (const ann of paragraph.annotations ?? []) {
        addAnnotation(seen, ann, prose, panels, facts);
      }
    }
  }
  for (const beat of panels.beats) {
    for (const ann of beat.annotations ?? []) {
      addAnnotation(seen, ann, prose, panels, facts);
    }
  }

  return Array.from(seen.values());
}

function addAnnotation(
  acc: Map<string, ExtractedClaim>,
  ann: Annotation,
  prose: AnalysisProse,
  panels: AnalysisPanels,
  facts: AnalysisFacts,
): void {
  if (acc.has(ann.anchorId)) return;

  if (ann.kind === "explain") {
    const claim =
      prose.explainClaims.find((c) => c.anchorId === ann.anchorId) ??
      panels.explainClaims.find((c) => c.anchorId === ann.anchorId);
    acc.set(ann.anchorId, {
      kind: "explain",
      anchorId: ann.anchorId,
      label: claim?.label ?? ann.phrase,
      category: null,
      body: claim?.body ?? null,
      evidenceRefs: claim
        ? { refs: claim.evidenceRefs, chartKind: claim.chartKind }
        : null,
    });
  } else {
    // Note annotation: look up the canonical note from facts.notesToRaise by anchorId.
    const note = facts.notesToRaise.find((n) => n.anchorId === ann.anchorId);
    acc.set(ann.anchorId, {
      kind: "note",
      anchorId: ann.anchorId,
      label: note?.label ?? ann.phrase,
      category: note?.category ?? null,
      body: note?.body ?? null,
      evidenceRefs: note ? { refs: note.evidenceRefs } : null,
    });
  }
}
