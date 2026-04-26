import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PaneHeader } from "@/components/layout/PaneHeader";
import { UserAvatar, getInitials } from "@/components/layout/Avatars";
import { PhaseActionBar, type PhaseStep } from "@/components/PhaseActionBar";
import { StoryArticle, type StoryAnalysisResult } from "@/components/StoryArticle";
import { useAuth } from "@/hooks/useAuth";
import { formatDateLong } from "@/lib/formatters";
import { BEAT_LABEL, BEAT_STATUS_LINE } from "@/lib/canvasCopy";
import type { Analysis, SubStep } from "@shared/schema";

// Canvas 1, Live beat. The agreed picture, dated and read-only. Re-entry goes
// back to Discuss via the Reopen action. The primary forward CTA jumps to the
// next canvas (analysis) — Canvas 2 is auto-started on agree, so it always
// exists by the time this screen renders.
export function PictureLive({ subStep, onContinue }: { subStep: SubStep; onContinue?: () => void }) {
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
    { key: "gather", label: BEAT_LABEL.picture.gather.title, status: "past", caption: "done" },
    { key: "analyse", label: BEAT_LABEL.picture.analyse.title, status: "past", caption: "done" },
    { key: "discuss", label: BEAT_LABEL.picture.discuss.title, status: "past", caption: "done" },
    {
      key: "live",
      label: BEAT_LABEL.picture.live.title,
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
        statusLine={<span className="text-muted-foreground">{BEAT_STATUS_LINE.picture.live}</span>}
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
          onContinue
            ? {
                label: "See your analysis →",
                onClick: onContinue,
              }
            : undefined
        }
        secondary={{
          label: reopen.isPending ? "Reopening…" : "Something's not right",
          onClick: () => reopen.mutate(),
          disabled: reopen.isPending,
        }}
      />
    </div>
  );
}
