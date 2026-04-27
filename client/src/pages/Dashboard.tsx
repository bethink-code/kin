import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { TopBar } from "@/components/layout/TopBar";
import { TwoPane } from "@/components/layout/TwoPane";
import { PictureGather } from "@/components/picture/PictureGather";
import { PictureAnalyse } from "@/components/picture/PictureAnalyse";
import { PictureDiscuss } from "@/components/picture/PictureDiscuss";
import { PictureLive } from "@/components/picture/PictureLive";
import { AllyPane } from "@/components/picture/AllyPane";
import { AnalysisAnalyse } from "@/components/analysis/AnalysisAnalyse";
import { AnalysisDiscuss } from "@/components/analysis/AnalysisDiscuss";
import { AnalysisLive } from "@/components/analysis/AnalysisLive";
import { BeatLanding } from "@/components/BeatLanding";
import { BeatTransition } from "@/components/BeatTransition";
import type { CanvasKey } from "@/lib/canvasCopy";
import type { Beat } from "@/lib/beats";
import {
  getCanvasCurrentBeat,
  getBeatRelation,
  isPeekMode,
  type NavContext,
} from "@/lib/navigation";
import {
  hasSeenLanding,
  markLandingSeen,
  hasEverSeenALanding,
} from "@/lib/seenLandings";
import type {
  AnalysisDraft as AnalysisDraftRow,
  Conversation,
  Statement,
  Analysis,
  SubStep,
  SubStepMessage,
} from "@shared/schema";

// Tab-click navigation goes through three stages:
//   'landing'      — summary card explaining what they're opening
//   'transitioning'— brief loader (StoryRotator + Ally line) — only fires for
//                    past + current peeks; future-beat CTAs go straight back
//   null           — show actual beat content (live mode for current,
//                    peek mode for past, never reached for future since the
//                    future-CTA is "Back to current" which clears overrides)
type TabNavStage = "landing" | "transitioning" | null;

type SubStepResponse = { subStep: SubStep; messages: SubStepMessage[] };

export default function Dashboard() {
  const { user } = useAuth();

  const conversationQ = useQuery<{ conversation: Conversation | null } | null>({
    queryKey: ["/api/qa/conversation"],
    enabled: !!user,
  });
  const draftQ = useQuery<AnalysisDraftRow | null>({
    queryKey: ["/api/analysis-draft/current"],
    enabled: !!user,
  });
  const subStepQ = useQuery<SubStepResponse | null>({
    queryKey: ["/api/sub-step/current"],
    enabled: !!user,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return false;
      return d.subStep.beat === "analyse" ? 2500 : false;
    },
  });
  const statementsQ = useQuery<Statement[]>({
    queryKey: ["/api/statements"],
    enabled: !!user,
  });
  const analysisQ = useQuery<Analysis | null>({
    queryKey: ["/api/analysis/latest"],
    enabled: !!user,
  });

  const [viewingCanvas, setViewingCanvas] = useState<CanvasKey | null>(null);
  // Per-canvas beat override for tab-click peek navigation. One bag for all
  // four canvases so the same machinery works on picture, analysis, plan
  // and progress without per-canvas state ladders.
  const [viewingBeats, setViewingBeats] = useState<Record<CanvasKey, Beat | null>>({
    picture: null,
    analysis: null,
    plan: null,
    progress: null,
  });
  const [tabNavStage, setTabNavStage] = useState<TabNavStage>(null);

  if (!user) return null;

  // Gate the whole render on the sub-step query settling (success OR error).
  // Without this, the first paint uses fallback derivations (subStep null →
  // naturalCanvas defaults to picture, then re-renders to analysis when the
  // conversation/draft arrives, etc.) — visible as content flashing in then
  // being replaced by a loader. Quiet "Settling in" frame until we know.
  if (subStepQ.isPending) {
    return (
      <div className="flex items-center justify-center h-screen text-sm text-muted-foreground italic">
        Settling in…
      </div>
    );
  }

  const subStep = subStepQ.data?.subStep ?? null;

  // Single nav context. Every navigation decision (relation, current beat,
  // peek mode, clickability) reads from this so callers stay consistent.
  const navCtx: NavContext = {
    subStep,
    draft: draftQ.data ?? null,
    conversation: conversationQ.data?.conversation ?? null,
    analysis: analysisQ.data ?? null,
    statements: statementsQ.data ?? [],
  };

  // Natural canvas: where the user's sub-step actually is.
  const naturalCanvas: CanvasKey =
    (subStep?.canvasKey as CanvasKey | undefined) ??
    (conversationQ.data?.conversation?.status === "complete" || draftQ.data ? "analysis" : "picture");
  const effectiveCanvas: CanvasKey = viewingCanvas ?? naturalCanvas;

  // Effective beat = peek override for this canvas (if set) OR canvas's
  // actual current beat from the navigation module.
  const effectiveBeat: Beat =
    viewingBeats[effectiveCanvas] ?? getCanvasCurrentBeat(effectiveCanvas, navCtx);

  function onNavigateSubStep(canvas: CanvasKey, subStepKey: string) {
    setViewingCanvas(canvas === naturalCanvas ? null : canvas);
    if (isBeat(subStepKey)) {
      // Override clears if user clicked their actual current beat (no peek
      // needed). Otherwise set the override.
      const isOwnCurrent = subStep?.canvasKey === canvas && subStepKey === subStep.beat;
      setViewingBeats((prev) => ({
        ...prev,
        [canvas]: isOwnCurrent ? null : subStepKey,
      }));
    }
    setTabNavStage("landing");
  }

  // Drop all overrides — return user to their natural canvas + beat. Used by
  // the foot bar's "Back to current" CTA in peek mode and by future-beat
  // landing dismissals.
  function backToCurrent() {
    setViewingCanvas(null);
    setViewingBeats({ picture: null, analysis: null, plan: null, progress: null });
    setTabNavStage(null);
  }

  const peek = isPeekMode(effectiveCanvas, effectiveBeat, navCtx);
  const beatRelation = getBeatRelation(effectiveCanvas, effectiveBeat, navCtx);

  // First-arrival landing: when the user lands on a beat they've never seen
  // before (post-onboarding into Gather, server advance into Analyse, agree
  // into Live, reopen into a new Discuss instance), auto-fire the
  // interstitial. The landing is per-(canvas, beat, instance) — once
  // dismissed it doesn't re-show on refresh, but a fresh instance does.
  // Skip if user is already in a tab-click landing flow (don't double-up).
  useEffect(() => {
    if (!subStep || tabNavStage !== null) return;
    if (!hasSeenLanding(subStep.canvasKey as CanvasKey, subStep.beat as Beat, subStep.instance)) {
      setTabNavStage("landing");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subStep?.id]);

  // Whether this is the user's very first landing ever — drives the
  // product-orientation copy on the Gather card (vs. the routine version).
  const isFirstEver = !hasEverSeenALanding();

  return (
    <div className="flex flex-col h-screen">
      <TopBar
        user={user}
        activeCanvas={effectiveCanvas}
        onNavigateSubStep={onNavigateSubStep}
      />
      <div className="flex-1 min-h-0">
        <TwoPane
          left={
            tabNavStage === "landing" ? (
              <BeatLanding
                canvas={effectiveCanvas}
                beat={effectiveBeat}
                relation={beatRelation}
                isFirstEver={isFirstEver}
                onCta={() => setTabNavStage("transitioning")}
                onBackToCurrent={backToCurrent}
              />
            ) : tabNavStage === "transitioning" ? (
              <BeatTransition
                canvas={effectiveCanvas === "plan" || effectiveCanvas === "progress" ? "picture" : effectiveCanvas}
                beat={effectiveBeat}
                // Mark the landing for the user's CURRENT beat as seen so it
                // won't auto-fire on refresh. (For tab-click peeks, the
                // current beat is what the user actually returns to.) Then
                // clear the stage. Override stays — peek mode persists until
                // the user explicitly clicks "Back to current".
                onDone={() => {
                  if (subStep) {
                    markLandingSeen(
                      subStep.canvasKey as CanvasKey,
                      subStep.beat as Beat,
                      subStep.instance,
                    );
                  }
                  setTabNavStage(null);
                }}
              />
            ) : effectiveCanvas === "plan" || effectiveCanvas === "progress" ? (
              // No content for plan/progress yet; landing already dismissed.
              // Fall back to a placeholder. Shouldn't normally render — the
              // future-CTA dismisses via backToCurrent.
              <ComingSoonPane onBack={backToCurrent} />
            ) : effectiveCanvas === "analysis" ? (
              <AnalysisContent
                subStep={subStep}
                effectiveBeat={effectiveBeat}
                peek={peek}
                onBackToCurrent={backToCurrent}
              />
            ) : (
              <PictureContent
                subStep={subStep}
                effectiveBeat={effectiveBeat}
                peek={peek}
                onBackToCurrent={backToCurrent}
                onContinueToAnalysis={() => {
                  setViewingCanvas("analysis");
                  setTabNavStage("landing");
                }}
              />
            )
          }
          right={<AllyPane canvas={effectiveCanvas === "plan" || effectiveCanvas === "progress" ? "picture" : effectiveCanvas} />}
        />
      </div>
    </div>
  );
}

function isBeat(k: string): k is Beat {
  return k === "gather" || k === "analyse" || k === "discuss" || k === "live";
}

function ComingSoonPane({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-4">
      <p className="text-sm text-muted-foreground italic max-w-md">
        This canvas isn't built yet. It comes after we agree the analysis.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="text-sm underline text-muted-foreground hover:text-foreground"
      >
        Back to current
      </button>
    </div>
  );
}

function PictureContent({
  subStep,
  effectiveBeat,
  peek,
  onBackToCurrent,
  onContinueToAnalysis,
}: {
  subStep: SubStep | null;
  effectiveBeat: Beat;
  peek: boolean;
  onBackToCurrent: () => void;
  onContinueToAnalysis: () => void;
}) {
  if (!subStep) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground italic">
        Settling in…
      </div>
    );
  }
  switch (effectiveBeat) {
    case "gather":
      return <PictureGather subStep={subStep} peek={peek} onBackToCurrent={onBackToCurrent} />;
    case "analyse":
      return <PictureAnalyse subStep={subStep} peek={peek} onBackToCurrent={onBackToCurrent} />;
    case "discuss":
      return <PictureDiscuss subStep={subStep} peek={peek} onBackToCurrent={onBackToCurrent} />;
    case "live":
      return (
        <PictureLive
          subStep={subStep}
          peek={peek}
          onBackToCurrent={onBackToCurrent}
          onContinue={onContinueToAnalysis}
        />
      );
  }
}

function AnalysisContent({
  subStep,
  effectiveBeat,
  peek,
  onBackToCurrent,
}: {
  subStep: SubStep | null;
  effectiveBeat: Beat;
  peek: boolean;
  onBackToCurrent: () => void;
}) {
  if (!subStep) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground italic">
        Settling in…
      </div>
    );
  }
  switch (effectiveBeat) {
    case "gather":
    case "analyse":
      return <AnalysisAnalyse subStep={subStep} peek={peek} onBackToCurrent={onBackToCurrent} />;
    case "discuss":
      return <AnalysisDiscuss subStep={subStep} peek={peek} onBackToCurrent={onBackToCurrent} />;
    case "live":
      return <AnalysisLive subStep={subStep} peek={peek} onBackToCurrent={onBackToCurrent} />;
  }
}
