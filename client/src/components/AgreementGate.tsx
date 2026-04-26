import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";

// ============================================================================
// Agreement gate — modal shown when the user clicks the Discuss-beat primary
// CTA ("This is my picture" / "This is my analysis"). Reads the checklist for
// the sub-step, lets the user mark pending items as skipped (with a reason),
// and only enables the lock CTA when every core item is covered or skipped.
//
// Closer message (deterministic, built on the server in postAgreedOpener) then
// reads back the same checklist as a Live transition message.
// ============================================================================

type ChecklistItem = {
  key: string;
  label: string;
  status: "covered" | "skipped" | "pending";
  reason?: string | null;
  evidence?: string | null;
  importance: "core" | "nice";
};

type Checklist = {
  canvas: string;
  beat: string;
  items: ChecklistItem[];
  agreementReady: boolean;
};

export function AgreementGate({
  subStepId,
  open,
  onClose,
  onAgreed,
  lockLabel,
}: {
  subStepId: number;
  open: boolean;
  onClose: () => void;
  onAgreed: () => void;
  lockLabel: string;
}) {
  const checklistQ = useQuery<Checklist>({
    queryKey: [`/api/sub-step/${subStepId}/checklist`],
    enabled: open,
  });

  const skip = useMutation({
    mutationFn: (vars: { itemKey: string; itemLabel: string; reason: string }) =>
      apiRequest("POST", `/api/sub-step/${subStepId}/skip`, vars),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/sub-step/${subStepId}/checklist`] }),
  });

  // "Talk about this" — closes the modal and posts an Ally turn opening the
  // topic in chat, so the user lands back in conversation with a question
  // waiting instead of having to steer the chat themselves.
  const discussTopic = useMutation({
    mutationFn: (vars: { itemKey: string; itemLabel: string }) =>
      apiRequest("POST", `/api/sub-step/${subStepId}/discuss-topic`, vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/qa/conversation"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analysis-conversation"] });
      onClose();
    },
  });

  const agree = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sub-step/${subStepId}/agree`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sub-step/current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/qa/conversation"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analysis-conversation"] });
      queryClient.invalidateQueries({ queryKey: ["/api/record/notes"] });
      onAgreed();
    },
  });

  const [activeSkipKey, setActiveSkipKey] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState("");

  // Reset local state when modal opens/closes.
  useEffect(() => {
    if (!open) {
      setActiveSkipKey(null);
      setSkipReason("");
    }
  }, [open]);

  if (!open) return null;

  const items = checklistQ.data?.items ?? [];
  const agreementReady = checklistQ.data?.agreementReady ?? false;
  const pendingCore = items.filter((i) => i.status === "pending" && i.importance === "core");
  const covered = items.filter((i) => i.status === "covered");
  const skipped = items.filter((i) => i.status === "skipped");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-lg bg-background shadow-xl border border-border max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-5 pb-3 border-b border-border">
          <div className="font-serif text-lg">Before we lock this in</div>
          <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Green = covered. Open = we haven't talked about it yet. For each open one,
            either <strong>Talk about it</strong> (jumps back to chat) or <strong>Skip</strong>{" "}
            with a quick note (stays on the record as parked, not gone). Lock unlocks once
            every essential item is covered or skipped.
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {checklistQ.isLoading && (
            <div className="text-sm text-muted-foreground italic">Reading the record…</div>
          )}
          {checklistQ.data && items.length === 0 && (
            <div className="text-sm text-muted-foreground italic">
              Nothing on the checklist yet — go ahead.
            </div>
          )}
          {items.map((item) => {
            const isActive = activeSkipKey === item.key;
            return (
              <div
                key={item.key}
                className={`rounded-md border px-3 py-2 ${
                  item.status === "covered"
                    ? "border-emerald-200 bg-emerald-50/40"
                    : item.status === "skipped"
                      ? "border-amber-200 bg-amber-50/40"
                      : "border-border bg-background"
                }`}
              >
                <div className="flex items-center gap-3">
                  <StatusBadge status={item.status} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">
                      {item.label}
                      {item.importance === "nice" && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                          optional
                        </span>
                      )}
                    </div>
                    {item.evidence && (
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">{item.evidence}</div>
                    )}
                    {item.status === "skipped" && (
                      <div className="text-xs text-amber-800 mt-0.5">
                        parked: {item.reason ?? "no reason given"}
                      </div>
                    )}
                  </div>
                  {item.status === "pending" && !isActive && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        disabled={discussTopic.isPending}
                        onClick={() =>
                          discussTopic.mutate({ itemKey: item.key, itemLabel: item.label })
                        }
                        className="text-xs px-2 py-1 rounded border border-border text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                      >
                        Talk about it
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveSkipKey(item.key);
                          setSkipReason("");
                        }}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
                      >
                        Skip
                      </button>
                    </div>
                  )}
                </div>
                {isActive && (
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      placeholder="Why skip? (optional — e.g. 'don't have one', 'not relevant')"
                      className="flex-1 text-xs px-2 py-1 border border-border rounded bg-background"
                      value={skipReason}
                      onChange={(e) => setSkipReason(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="button"
                      disabled={skip.isPending}
                      onClick={() =>
                        skip.mutate(
                          {
                            itemKey: item.key,
                            itemLabel: item.label,
                            reason: skipReason.trim(),
                          },
                          {
                            onSuccess: () => {
                              setActiveSkipKey(null);
                              setSkipReason("");
                            },
                          },
                        )
                      }
                      className="text-xs px-2 py-1 rounded bg-foreground text-background disabled:opacity-50"
                    >
                      {skip.isPending ? "..." : skipReason.trim() ? "Park it" : "Skip anyway"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSkipKey(null);
                        setSkipReason("");
                      }}
                      className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {covered.length} covered · {skipped.length} parked · {pendingCore.length} still open
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={agree.isPending}>
              Keep talking
            </Button>
            <Button
              disabled={!agreementReady || agree.isPending}
              onClick={() => agree.mutate()}
            >
              {agree.isPending ? "Locking…" : lockLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: "covered" | "skipped" | "pending" }) {
  if (status === "covered") {
    return (
      <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-900">
        ✓
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">
        skip
      </span>
    );
  }
  return (
    <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-muted-foreground">
      open
    </span>
  );
}
