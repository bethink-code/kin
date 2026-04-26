import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PaneHeader } from "@/components/layout/PaneHeader";
import { UserAvatar, getInitials } from "@/components/layout/Avatars";
import { PhaseActionBar, type PhaseStep } from "@/components/PhaseActionBar";
import { StoryArticle, type StoryAnalysisResult } from "@/components/StoryArticle";
import { AgreementGate } from "@/components/AgreementGate";
import { useAuth } from "@/hooks/useAuth";
import { BEAT_LABEL, BEAT_STATUS_LINE } from "@/lib/canvasCopy";
import type { Analysis, SubStep } from "@shared/schema";

// Canvas 1, Discuss beat. The story-plus-chat sub-step. Person reads the first
// take, chats with Ally to correct and fill gaps, then Agrees when ready —
// click opens the agreement gate, which checks coverage + skips before locking.
export function PictureDiscuss({ subStep }: { subStep: SubStep }) {
  const { user } = useAuth();
  const displayName = user?.firstName ?? user?.email?.split("@")[0] ?? "You";
  const [gateOpen, setGateOpen] = useState(false);

  // The Analyse beat wrote { analysisId } into contentJson — Slice 1 simplifies
  // by reading whichever analysis is latest (there's one active per user today).
  const analysisQ = useQuery<Analysis | null>({
    queryKey: ["/api/analysis/latest"],
  });

  const analysis = analysisQ.data ?? null;
  const storyResult = analysis?.result as StoryAnalysisResult | null | undefined;

  const steps: PhaseStep[] = [
    { key: "gather", label: BEAT_LABEL.picture.gather.title, status: "past", caption: "done" },
    { key: "analyse", label: BEAT_LABEL.picture.analyse.title, status: "past", caption: "done" },
    {
      key: "discuss",
      label: BEAT_LABEL.picture.discuss.title,
      status: "current",
      caption: "in conversation",
    },
    { key: "live", label: BEAT_LABEL.picture.live.title, status: "future", caption: "—" },
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
        statusLine={<span className="text-muted-foreground">{BEAT_STATUS_LINE.picture.discuss}</span>}
      />
      <div className="flex-1 min-h-0 overflow-y-auto shadow-[inset_0_0_0_4px_var(--color-muted)]">
        {storyResult ? (
          <div className="px-6 py-8">
            <StoryArticle result={storyResult} />
            {/* Supporting-doc attach zone — stubbed for Slice 1.
                Full mid-Discuss document extraction defers to Slice 2. */}
            <div className="mt-10 pt-6 border-t border-border text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70">
              Supporting documents · coming soon
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground italic text-sm">
            Loading your picture…
          </div>
        )}
      </div>

      <PhaseActionBar
        primary={{
          label: "This is my picture",
          onClick: () => setGateOpen(true),
          disabled: !storyResult,
        }}
      />

      <AgreementGate
        subStepId={subStep.id}
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        onAgreed={() => setGateOpen(false)}
        lockLabel="Lock it in"
      />
    </div>
  );
}
