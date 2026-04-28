import { useQuery } from "@tanstack/react-query";
import type { Analysis, AnalysisClaim, AnalysisDraft as AnalysisDraftRow } from "@shared/schema";
import type { PhaseKey } from "@/lib/canvasCopy";

type EvidenceRefs = {
  refs?: Array<{ kind: string; ref: string }>;
  chartKind?: string;
};

// The Explain mode of the Ally pane. Opens when a user clicks a highlighted
// claim in the prose or a panel's anchor copy. Shows the claim restated +
// evidence.
//
// Works for both canvases:
//   picture  → claims live on /api/analysis/:id/claims (Phase 1)
//   analysis → claims live on /api/analysis-draft/:id/claims (Phase 2)
export function ExplainPane({
  canvas,
  anchorId,
  onBack,
}: {
  canvas: PhaseKey;
  anchorId: string | null;
  onBack: () => void;
}) {
  // Phase 1 source-of-truth — the latest done analysis.
  const analysisQ = useQuery<Analysis | null>({
    queryKey: ["/api/analysis/latest"],
    enabled: canvas === "picture",
  });
  const analysisId = analysisQ.data?.id ?? null;
  const pictureClaimsQ = useQuery<AnalysisClaim[]>({
    queryKey: [`/api/analysis/${analysisId}/claims`],
    enabled: canvas === "picture" && analysisId !== null,
  });

  // Phase 2 source-of-truth — the current non-superseded draft.
  const draftQ = useQuery<AnalysisDraftRow | null>({
    queryKey: ["/api/analysis-draft/current"],
    enabled: canvas === "analysis",
  });
  const draftId = draftQ.data?.id ?? null;
  const analysisClaimsQ = useQuery<AnalysisClaim[]>({
    queryKey: [`/api/analysis-draft/${draftId}/claims`],
    enabled: canvas === "analysis" && draftId !== null,
  });

  if (canvas !== "picture" && canvas !== "analysis") {
    return <EmptyState onBack={onBack}>Explain mode isn't available on this canvas yet.</EmptyState>;
  }
  if (!anchorId) {
    return (
      <EmptyState onBack={onBack}>
        Click a highlighted phrase on the left to see the evidence behind it.
      </EmptyState>
    );
  }

  const fetched =
    canvas === "picture"
      ? analysisQ.isFetched && (analysisId === null || pictureClaimsQ.isFetched)
      : draftQ.isFetched && (draftId === null || analysisClaimsQ.isFetched);
  if (!fetched) return <EmptyState onBack={onBack}>Loading…</EmptyState>;

  const claims = canvas === "picture" ? pictureClaimsQ.data ?? [] : analysisClaimsQ.data ?? [];
  const claim = claims.find((c) => c.anchorId === anchorId && c.kind === "explain");
  if (!claim) {
    return <EmptyState onBack={onBack}>Couldn't find the evidence for that one.</EmptyState>;
  }

  const evidence = (claim.evidenceRefs ?? {}) as EvidenceRefs;
  const refs = evidence.refs ?? [];
  const chartKind = evidence.chartKind && evidence.chartKind !== "none" ? evidence.chartKind : null;

  return (
    <div className="flex flex-col h-full min-h-0 shadow-[inset_0_0_0_4px_var(--color-muted)]">
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        <p className="font-serif text-lg leading-snug">{claim.body ?? claim.label}</p>

        {chartKind && <EvidenceChartPlaceholder chartKind={chartKind} />}

        {refs.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Evidence
            </div>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {refs.slice(0, 20).map((r, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="inline-block px-1.5 py-0.5 rounded bg-muted text-foreground/80 text-[10px]">
                    {r.kind}
                  </span>
                  <span className="truncate">{r.ref}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="border-t border-border px-6 py-3">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ← back to chat
        </button>
      </div>
    </div>
  );
}

function EmptyState({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="flex flex-col h-full min-h-0 shadow-[inset_0_0_0_4px_var(--color-muted)]">
      <div className="flex-1 flex items-center justify-center px-6 text-center">
        <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">{children}</p>
      </div>
      <div className="border-t border-border px-6 py-3">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ← back to chat
        </button>
      </div>
    </div>
  );
}

function EvidenceChartPlaceholder({ chartKind }: { chartKind: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6">
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">
        chart placeholder
      </div>
      <div className="text-sm text-foreground/80">{chartKind.replace(/_/g, " ")}</div>
    </div>
  );
}
