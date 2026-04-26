import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { formatDateLong } from "@/lib/formatters";
import type { Analysis, AnalysisDraft as AnalysisDraftRow } from "@shared/schema";

// Historical recap shown when the user peeks at a past Analyse beat via the
// canvas pill. The live AllyAtWork screen would lie ("Writing your analysis…"
// with progress bar) about a pass that already finished — this component is
// the static "this happened" view.
//
// Used by both PictureAnalyse and AnalysisAnalyse when their sub-step is past
// the analyse beat (i.e. user has navigated to a sub-step they've already
// agreed away from).
export function AnalysePeek({
  canvas,
  onSeeResult,
}: {
  canvas: "picture" | "analysis";
  onSeeResult?: () => void;
}) {
  const analysisQ = useQuery<Analysis | null>({
    queryKey: ["/api/analysis/latest"],
    enabled: canvas === "picture",
  });
  const draftQ = useQuery<AnalysisDraftRow | null>({
    queryKey: ["/api/analysis-draft/current"],
    enabled: canvas === "analysis",
  });

  // Pull whatever timestamps + scale we have from the underlying record so
  // the recap is concrete, not just "done".
  const completedAt =
    canvas === "picture"
      ? (analysisQ.data?.completedAt as unknown as string | null | undefined)
      : (draftQ.data?.generatedAt as unknown as string | null | undefined);

  const inputTokens =
    canvas === "picture"
      ? analysisQ.data?.inputTokens ?? null
      : draftQ.data?.inputTokens ?? null;
  const outputTokens =
    canvas === "picture"
      ? analysisQ.data?.outputTokens ?? null
      : draftQ.data?.outputTokens ?? null;

  const heading = canvas === "picture" ? "Your first take" : "Your analysis";
  const subhead =
    canvas === "picture"
      ? "I read across everything you uploaded and wrote you a story. That pass is done — here's where it landed."
      : "I worked through your agreed picture and produced your analysis — facts, prose, and panels. That pass is done — here's where it landed.";
  const ctaLabel = canvas === "picture" ? "See your picture →" : "See your analysis →";

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center">
      <div className="max-w-md">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
          You're looking back · this beat is done
        </div>
        <h2 className="font-serif text-3xl mb-3">{heading}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">{subhead}</p>

        <div className="rounded-lg border border-border bg-card/60 p-4 text-left text-xs space-y-1.5">
          <Row label="Completed">
            {completedAt ? formatDateLong(completedAt) : "—"}
          </Row>
          {inputTokens != null && (
            <Row label="Input">{inputTokens.toLocaleString()} tokens</Row>
          )}
          {outputTokens != null && (
            <Row label="Output">{outputTokens.toLocaleString()} tokens</Row>
          )}
        </div>

        {onSeeResult && (
          <div className="mt-6">
            <Button onClick={onSeeResult}>{ctaLabel}</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{children}</span>
    </div>
  );
}
