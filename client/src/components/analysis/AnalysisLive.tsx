import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PaneHeader } from "@/components/layout/PaneHeader";
import { UserAvatar, getInitials } from "@/components/layout/Avatars";
import { PhaseActionBar, type PhaseStep } from "@/components/PhaseActionBar";
import { useAuth } from "@/hooks/useAuth";
import { formatDateLong } from "@/lib/formatters";
import { BEAT_LABEL, BEAT_STATUS_LINE } from "@/lib/canvasCopy";
import type { AnalysisClaim, AnalysisDraft as AnalysisDraftRow, SubStep } from "@shared/schema";
import { AnalysisProse } from "./AnalysisProse";
import { AnalysisPanels } from "./AnalysisPanels";
import { FormatToggle, useFormatPreference } from "./FormatToggle";

// Canvas 2, Live beat. The agreed analysis, read-only, dated.
export function AnalysisLive({ subStep }: { subStep: SubStep }) {
  const { user } = useAuth();
  const displayName = user?.firstName ?? user?.email?.split("@")[0] ?? "You";

  const { format } = useFormatPreference();
  const draftQ = useQuery<AnalysisDraftRow | null>({
    queryKey: ["/api/analysis-draft/current"],
  });
  const draft = draftQ.data ?? null;
  const claimsQ = useQuery<AnalysisClaim[]>({
    queryKey: draft ? [`/api/analysis-draft/${draft.id}/claims`] : ["noop"],
    enabled: !!draft,
  });
  const claims = claimsQ.data ?? [];

  const reopen = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sub-step/${subStep.id}/reopen`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/sub-step/current"] }),
  });

  const agreedAt = subStep.agreedAt
    ? formatDateLong(subStep.agreedAt as unknown as string)
    : draft?.agreedAt
      ? formatDateLong(draft.agreedAt as unknown as string)
      : null;

  const steps: PhaseStep[] = [
    { key: "gather", label: BEAT_LABEL.analysis.gather.title || "Pulled in", status: "past", caption: "done" },
    { key: "analyse", label: BEAT_LABEL.analysis.analyse.title, status: "past", caption: "done" },
    { key: "discuss", label: BEAT_LABEL.analysis.discuss.title, status: "past", caption: "done" },
    {
      key: "live",
      label: BEAT_LABEL.analysis.live.title,
      status: "current",
      caption: agreedAt ? `agreed ${agreedAt}` : "agreed",
    },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      <PaneHeader
        avatar={
          <UserAvatar
            photoUrl={user?.photoDataUrl ?? user?.profileImageUrl}
            initials={getInitials(user?.firstName, user?.lastName, user?.email)}
          />
        }
        name={displayName}
        statusLine={<span className="text-muted-foreground">{BEAT_STATUS_LINE.analysis.live}</span>}
      />
      <div className="flex-1 min-h-0 overflow-y-auto shadow-[inset_0_0_0_4px_var(--color-muted)]">
        {draft ? (
          <div className="px-8 py-6">
            {agreedAt && (
              <div className="mb-6 pb-3 border-b border-border">
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Analysis agreed
                </div>
                <div className="font-serif text-lg">{agreedAt}</div>
              </div>
            )}
            <FormatToggle />
            <div className="mt-4">
              {format === "text" ? (
                <AnalysisProse prose={draft.prose} claims={claims} />
              ) : (
                <AnalysisPanels panels={draft.panels} claims={claims} />
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground italic text-sm">
            Loading your analysis…
          </div>
        )}
      </div>

      <PhaseActionBar
        secondary={{
          label: reopen.isPending ? "Reopening…" : "Something's not right",
          onClick: () => reopen.mutate(),
          disabled: reopen.isPending,
        }}
      />
    </div>
  );
}
