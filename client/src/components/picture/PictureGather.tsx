import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { StatementUpload } from "@/components/StatementUpload";
import { PaneHeader } from "@/components/layout/PaneHeader";
import { UserAvatar, getInitials } from "@/components/layout/Avatars";
import { PhaseActionBar, type PhaseStep } from "@/components/PhaseActionBar";
import { useAuth } from "@/hooks/useAuth";
import { useStatementQueue } from "@/hooks/useStatementQueue";
import { StatementList } from "./StatementList";
import { BEAT_LABEL, BEAT_STATUS_LINE } from "@/lib/canvasCopy";
import type { Statement, SubStep } from "@shared/schema";

// Canvas 1, Gather beat. Refactor of the previous BringItIn — same upload body,
// but advancement is now driven by the sub-step orchestrator.
export function PictureGather({ subStep }: { subStep: SubStep }) {
  const { user } = useAuth();
  const queueState = useStatementQueue();
  const statementsQ = useQuery<Statement[]>({ queryKey: ["/api/statements"] });
  const statements = statementsQ.data ?? [];
  const extractedCount = statements.filter((s) => s.status === "extracted").length;

  const advance = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sub-step/${subStep.id}/advance`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/sub-step/current"] }),
  });

  const displayName = user?.firstName ?? user?.email?.split("@")[0] ?? "You";

  const steps: PhaseStep[] = [
    {
      key: "gather",
      label: BEAT_LABEL.picture.gather.title,
      status: "current",
      caption: `${extractedCount} read`,
    },
    { key: "analyse", label: BEAT_LABEL.picture.analyse.title, status: "future", caption: "—" },
    { key: "discuss", label: BEAT_LABEL.picture.discuss.title, status: "future", caption: "—" },
    { key: "live", label: BEAT_LABEL.picture.live.title, status: "future", caption: "—" },
  ];

  const canAdvance = extractedCount > 0 && !queueState.anyBusy;

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
        statusLine={<span className="text-muted-foreground">{BEAT_STATUS_LINE.picture.gather}</span>}
      />
      <main className="flex-1 overflow-y-auto px-6 py-8 min-h-0 space-y-8 shadow-[inset_0_0_0_4px_var(--color-muted)]">
        <StatementUpload
          queue={queueState.queue}
          anyBusy={queueState.anyBusy}
          rejectWarning={queueState.rejectWarning}
          onStageFiles={queueState.stageFiles}
          onClearFinished={queueState.clearFinished}
        />
        <StatementList statements={statements} />
      </main>

      <PhaseActionBar
        primary={{
          label: advance.isPending ? "One moment…" : "That's all my docs",
          onClick: () => advance.mutate(),
          disabled: !canAdvance || advance.isPending,
        }}
      />
    </div>
  );
}
