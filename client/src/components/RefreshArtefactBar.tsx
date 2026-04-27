import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// Manual refresh affordance for the artefact pane (story / analysis). Click
// Refresh → server kicks off a fresh analyse pass with the latest profile +
// chat corrections in context → background regenerates → content updates
// automatically when ready.
//
// Polls the relevant "latest" endpoint until the artefact id changes from
// the one captured at click-time, then stops. The previous content stays
// visible during the regeneration so the user has something to read.

type RefreshArtefactBarProps = {
  canvas: "picture" | "analysis";
};

export function RefreshArtefactBar({ canvas }: RefreshArtefactBarProps) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const beforeIdRef = useRef<number | null>(null);

  const latestKey =
    canvas === "picture" ? ["/api/analysis/latest"] : ["/api/analysis-draft/current"];
  const refreshUrl =
    canvas === "picture" ? "/api/analysis/refresh" : "/api/analysis-draft/refresh";

  const latestQ = useQuery<{ id?: number } | null>({
    queryKey: latestKey,
    refetchInterval: refreshing ? 3000 : false,
  });

  const trigger = useMutation({
    mutationFn: () => apiRequest("POST", refreshUrl),
    onMutate: () => {
      beforeIdRef.current = latestQ.data?.id ?? null;
      setRefreshing(true);
    },
  });

  // Stop polling once a different id appears. That's how we know the
  // background regeneration completed and the new artefact is in place.
  useEffect(() => {
    if (!refreshing) return;
    const currentId = latestQ.data?.id ?? null;
    if (
      currentId != null &&
      beforeIdRef.current != null &&
      currentId !== beforeIdRef.current
    ) {
      setRefreshing(false);
      // Force claims to refetch for the new artefact id.
      queryClient.invalidateQueries({
        queryKey:
          canvas === "picture"
            ? [`/api/analysis/${currentId}/claims`]
            : [`/api/analysis-draft/${currentId}/claims`],
      });
    }
  }, [latestQ.data?.id, refreshing, canvas, queryClient]);

  return (
    <div className="flex items-center justify-end gap-3 -mt-2 mb-6">
      {refreshing && (
        <span className="text-xs text-muted-foreground italic flex items-center gap-2">
          <span className="flex items-center gap-1" aria-hidden>
            <span className="h-1.5 w-1.5 rounded-full bg-accent/80 animate-pulse [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-accent/80 animate-pulse [animation-delay:200ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-accent/80 animate-pulse [animation-delay:400ms]" />
          </span>
          Ally is rewriting with your latest input…
        </span>
      )}
      <button
        type="button"
        onClick={() => trigger.mutate()}
        disabled={refreshing || trigger.isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        title="Re-run the analysis with the latest chat corrections"
      >
        <span aria-hidden className={refreshing || trigger.isPending ? "animate-spin inline-block" : "inline-block"}>↻</span>
        {refreshing || trigger.isPending ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
