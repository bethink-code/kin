import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PaneHeader } from "@/components/layout/PaneHeader";
import { UserAvatar, getInitials } from "@/components/layout/Avatars";
import { PhaseActionBar, type PhaseStep } from "@/components/PhaseActionBar";
import { AgreementGate } from "@/components/AgreementGate";
import { useAuth } from "@/hooks/useAuth";
import { BEAT_LABEL, BEAT_STATUS_LINE } from "@/lib/canvasCopy";
import type { AnalysisClaim, AnalysisDraft as AnalysisDraftRow, SubStep } from "@shared/schema";
import { AnalysisProse } from "./AnalysisProse";
import { AnalysisPanels } from "./AnalysisPanels";
import { FormatToggle, useFormatPreference } from "./FormatToggle";

// Canvas 2, Discuss beat. The first-draft analysis is visible. Person reads,
// refines with Ally in chat, then Agrees when it lands — click opens the
// agreement gate, which checks coverage + skips before locking.
export function AnalysisDiscuss({ subStep }: { subStep: SubStep }) {
  const { user } = useAuth();
  const displayName = user?.firstName ?? user?.email?.split("@")[0] ?? "You";
  const [gateOpen, setGateOpen] = useState(false);

  const { format } = useFormatPreference();
  // Slice 2: read the current draft from the legacy route. contentJson.draftId
  // points at it. The /api/analysis-draft/current endpoint returns the most
  // recent non-superseded draft, which matches what the sub-step points to.
  const draftQ = useQuery<AnalysisDraftRow | null>({
    queryKey: ["/api/analysis-draft/current"],
  });
  const draft = draftQ.data ?? null;
  const claimsQ = useQuery<AnalysisClaim[]>({
    queryKey: draft ? [`/api/analysis-draft/${draft.id}/claims`] : ["noop"],
    enabled: !!draft,
  });
  const claims = claimsQ.data ?? [];

  const steps: PhaseStep[] = [
    { key: "gather", label: BEAT_LABEL.analysis.gather.title || "Pulled in", status: "past", caption: "done" },
    { key: "analyse", label: BEAT_LABEL.analysis.analyse.title, status: "past", caption: "done" },
    {
      key: "discuss",
      label: BEAT_LABEL.analysis.discuss.title,
      status: "current",
      caption: "refining together",
    },
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
        statusLine={<span className="text-muted-foreground">{BEAT_STATUS_LINE.analysis.discuss}</span>}
      />
      <div className="flex-1 min-h-0 overflow-y-auto shadow-[inset_0_0_0_4px_var(--color-muted)]">
        {draft ? (
          <div className="px-8 py-6">
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
        primary={{
          label: "This is me",
          onClick: () => setGateOpen(true),
          disabled: !draft,
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
