import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PaneHeader } from "@/components/layout/PaneHeader";
import { UserAvatar, getInitials } from "@/components/layout/Avatars";
import { PhaseActionBar, type PhaseStep } from "@/components/PhaseActionBar";
import { StoryArticle, type StoryAnalysisResult } from "@/components/StoryArticle";
import { useAuth } from "@/hooks/useAuth";
import { formatDateLong } from "@/lib/formatters";
import { STEP_LABEL, STEP_STATUS_LINE } from "@/lib/canvasCopy";
import type { Analysis, SubStep } from "@shared/schema";

// Phase 1, Live step. The agreed picture, dated and read-only. Re-entry goes
// back to Discuss via the Reopen action. The primary forward CTA jumps to the
// next canvas (analysis) — Phase 2 is auto-started on agree, so it always
// exists by the time this screen renders.
export function PictureLive({
  subStep,
  onContinue,
  peek,
  onBackToCurrent,
}: {
  subStep: SubStep;
  onContinue?: () => void;
  /** Rendered as a peek (sub-step is elsewhere). Disables the reopen flow
   *  and replaces the primary CTA with "Back to current". */
  peek?: boolean;
  onBackToCurrent?: () => void;
}) {
  const { user } = useAuth();
  const displayName = user?.firstName ?? user?.email?.split("@")[0] ?? "You";

  const analysisQ = useQuery<Analysis | null>({
    queryKey: ["/api/analysis/latest"],
  });

  const reopen = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sub-step/${subStep.id}/reopen`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/sub-step/current"] }),
  });

  const analysis = analysisQ.data ?? null;
  const storyResult = analysis?.result as StoryAnalysisResult | null | undefined;
  const agreedAt = subStep.agreedAt
    ? formatDateLong(subStep.agreedAt as unknown as string)
    : subStep.startedAt
      ? formatDateLong(subStep.startedAt as unknown as string)
      : null;

  const steps: PhaseStep[] = [
    { key: "gather", label: STEP_LABEL.picture.gather.title, status: "past", caption: "done" },
    { key: "draft", label: STEP_LABEL.picture.draft.title, status: "past", caption: "done" },
    { key: "discuss", label: STEP_LABEL.picture.discuss.title, status: "past", caption: "done" },
    {
      key: "live",
      label: STEP_LABEL.picture.live.title,
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
        statusLine={<span className="text-muted-foreground">{STEP_STATUS_LINE.picture.live}</span>}
      />
      <div className="flex-1 min-h-0 overflow-y-auto shadow-[inset_0_0_0_4px_var(--color-muted)]">
        {storyResult ? (
          <div className="px-6 py-8">
            {agreedAt && (
              <div className="mb-6 pb-3 border-b border-border">
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Baseline agreed
                </div>
                <div className="font-serif text-lg">{agreedAt}</div>
              </div>
            )}
            <StoryArticle result={storyResult} />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground italic text-sm">
            Loading your picture…
          </div>
        )}
      </div>

      <PhaseActionBar
        primary={
          peek
            ? { label: "Back to current →", onClick: onBackToCurrent ?? (() => {}) }
            : onContinue
              ? { label: "See your analysis →", onClick: onContinue }
              : undefined
        }
        secondary={
          peek
            ? undefined
            : {
                label: reopen.isPending ? "Reopening…" : "Something's not right",
                onClick: () => reopen.mutate(),
                disabled: reopen.isPending,
              }
        }
      />
    </div>
  );
}
