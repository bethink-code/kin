import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PaneHeader } from "@/components/layout/PaneHeader";
import { UserAvatar, getInitials } from "@/components/layout/Avatars";
import { PhaseActionBar, type PhaseStep } from "@/components/PhaseActionBar";
import { AllyAtWork, type AllyAtWorkMode } from "@/components/AllyAtWork";
import { AnalysePeek } from "@/components/AnalysePeek";
import { useAuth } from "@/hooks/useAuth";
import { BEAT_LABEL, BEAT_STATUS_LINE } from "@/lib/canvasCopy";
import type { SubStep } from "@shared/schema";

// Canvas 2, Analyse beat. Ally is at work — facts → prose + panels pipeline.
// The server's background worker drives status transitions; this screen just
// reflects the sub-step's errorMessage as the hit_problem sub-mode.
//
// Peek mode: when the user navigates here via the canvas pill while their
// actual sub-step is past the analyse beat, render a static historical
// recap instead — never lie that work is in flight.
export function AnalysisAnalyse({
  subStep,
  onPeekDone,
}: {
  subStep: SubStep;
  onPeekDone?: () => void;
}) {
  const { user } = useAuth();
  const displayName = user?.firstName ?? user?.email?.split("@")[0] ?? "You";

  const isPeek = subStep.canvasKey !== "analysis" || subStep.beat !== "analyse";

  const retry = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sub-step/${subStep.id}/retry`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/sub-step/current"] }),
  });

  const mode: AllyAtWorkMode = subStep.errorMessage ? "hit_problem" : "working";

  const steps: PhaseStep[] = [
    { key: "gather", label: BEAT_LABEL.analysis.gather.title || "Pulled in", status: "past", caption: "done" },
    {
      key: "analyse",
      label: BEAT_LABEL.analysis.analyse.title,
      status: "current",
      caption: mode === "hit_problem" ? "hit a snag" : "in progress",
    },
    { key: "discuss", label: BEAT_LABEL.analysis.discuss.title, status: "future", caption: "opens when I'm done" },
    { key: "live", label: BEAT_LABEL.analysis.live.title, status: "future", caption: "—" },
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
        statusLine={<span className="text-muted-foreground">{BEAT_STATUS_LINE.analysis.analyse}</span>}
      />
      <div className="flex-1 min-h-0 overflow-auto shadow-[inset_0_0_0_4px_var(--color-muted)]">
        {isPeek ? (
          <AnalysePeek canvas="analysis" onSeeResult={onPeekDone} />
        ) : (
          <AllyAtWork
            mode={mode}
            title={displayName ? `Writing your analysis, ${displayName}…` : "Writing your analysis…"}
            expectedSeconds={90}
            rotatorLabel="While I write · a short story"
            errorMessage={subStep.errorMessage}
            onRetry={() => retry.mutate()}
          />
        )}
      </div>
      <PhaseActionBar />
    </div>
  );
}
