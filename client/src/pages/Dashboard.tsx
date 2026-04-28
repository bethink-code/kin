import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { TopBar } from "@/components/layout/TopBar";
import { TwoPane } from "@/components/layout/TwoPane";
import { PictureGather } from "@/components/picture/PictureGather";
import { PictureDraft } from "@/components/picture/PictureDraft";
import { PictureDiscuss } from "@/components/picture/PictureDiscuss";
import { PictureLive } from "@/components/picture/PictureLive";
import { AllyPane } from "@/components/picture/AllyPane";
import { AnalysisDraft } from "@/components/analysis/AnalysisDraft";
import { AnalysisDiscuss } from "@/components/analysis/AnalysisDiscuss";
import { AnalysisLive } from "@/components/analysis/AnalysisLive";
import { StepController } from "@/components/StepController";
import { StepTransition } from "@/components/StepTransition";
import type { PhaseKey } from "@/lib/canvasCopy";
import type { Step } from "@/lib/steps";
import {
  getPhaseCurrentStep,
  getStepRelation,
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
//                    past + current peeks; future-step CTAs go straight back
//   null           — show actual step content (live mode for current,
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
      return d.subStep.step === "draft" ? 2500 : false;
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

  const [viewingCanvas, setViewingCanvas] = useState<PhaseKey | null>(null);
  // Per-canvas step override for tab-click peek navigation. One bag for all
  // four canvases so the same machinery works on picture, analysis, plan
  // and progress without per-canvas state ladders.
  const [viewingBeats, setViewingBeats] = useState<Record<PhaseKey, Step | null>>({
    picture: null,
    analysis: null,
    plan: null,
    progress: null,
  });
  const [tabNavStage, setTabNavStage] = useState<TabNavStage>(null);

  // First-arrival landing: when the user lands on a step they've never seen
  // before, auto-fire the interstitial. Per-(canvas, step, instance) — once
  // dismissed it doesn't re-show on refresh; a new instance does.
  //
  // IMPORTANT: hooks must be called unconditionally on every render (Rules
  // of Hooks). Keep this useEffect ABOVE any early returns. Reads from the
  // query result directly (not a derived const) to avoid an ordering bind.
  useEffect(() => {
    const sub = subStepQ.data?.subStep;
    if (!sub || tabNavStage !== null) return;
    if (!hasSeenLanding(sub.phaseKey as PhaseKey, sub.step as Step, sub.instance)) {
      setTabNavStage("landing");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subStepQ.data?.subStep?.id]);

  if (!user) return null;

  // Gate the whole render on the sub-step query settling (success OR error).
  // Quiet "Settling in" frame so first paint doesn't flicker through fallback
  // canvas/step derivations as queries arrive in different orders.
  if (subStepQ.isPending) {
    return (
      <div className="flex items-center justify-center h-screen text-sm text-muted-foreground italic">
        Settling in…
      </div>
    );
  }

  const subStep = subStepQ.data?.subStep ?? null;

  // Single nav context. Every navigation decision (relation, current step,
  // peek mode, clickability) reads from this so callers stay consistent.
  const navCtx: NavContext = {
    subStep,
    draft: draftQ.data ?? null,
    conversation: conversationQ.data?.conversation ?? null,
    analysis: analysisQ.data ?? null,
    statements: statementsQ.data ?? [],
  };

  // Natural canvas: where the user's sub-step actually is.
  const naturalCanvas: PhaseKey =
    (subStep?.phaseKey as PhaseKey | undefined) ??
    (conversationQ.data?.conversation?.status === "complete" || draftQ.data ? "analysis" : "picture");
  const effectiveCanvas: PhaseKey = viewingCanvas ?? naturalCanvas;

  // Effective step = peek override for this canvas (if set) OR canvas's
  // actual current step from the navigation module.
  const effectiveStep: Step =
    viewingBeats[effectiveCanvas] ?? getPhaseCurrentStep(effectiveCanvas, navCtx);

  function onNavigateSubStep(canvas: PhaseKey, subStepKey: string) {
    setViewingCanvas(canvas === naturalCanvas ? null : canvas);
    if (isBeat(subStepKey)) {
      // Override clears if user clicked their actual current step (no peek
      // needed). Otherwise set the override.
      const isOwnCurrent = subStep?.phaseKey === canvas && subStepKey === subStep.step;
      setViewingBeats((prev) => ({
        ...prev,
        [canvas]: isOwnCurrent ? null : subStepKey,
      }));
    }
    setTabNavStage("landing");
  }

  // Drop all overrides — return user to their natural canvas + step. Used by
  // the foot bar's "Back to current" CTA in peek mode and by future-step
  // landing dismissals.
  function backToCurrent() {
    setViewingCanvas(null);
    setViewingBeats({ picture: null, analysis: null, plan: null, progress: null });
    setTabNavStage(null);
  }

  const peek = isPeekMode(effectiveCanvas, effectiveStep, navCtx);
  const stepRelation = getStepRelation(effectiveCanvas, effectiveStep, navCtx);

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
              <StepController
                canvas={effectiveCanvas}
                step={effectiveStep}
                relation={stepRelation}
                isFirstEver={isFirstEver}
                onCta={() => setTabNavStage("transitioning")}
                onBackToCurrent={backToCurrent}
              />
            ) : tabNavStage === "transitioning" ? (
              <StepTransition
                canvas={effectiveCanvas === "plan" || effectiveCanvas === "progress" ? "picture" : effectiveCanvas}
                step={effectiveStep}
                // Mark the landing for the user's CURRENT step as seen so it
                // won't auto-fire on refresh. (For tab-click peeks, the
                // current step is what the user actually returns to.) Then
                // clear the stage. Override stays — peek mode persists until
                // the user explicitly clicks "Back to current".
                onDone={() => {
                  if (subStep) {
                    markLandingSeen(
                      subStep.phaseKey as PhaseKey,
                      subStep.step as Step,
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
                effectiveStep={effectiveStep}
                peek={peek}
                onBackToCurrent={backToCurrent}
              />
            ) : (
              <PictureContent
                subStep={subStep}
                effectiveStep={effectiveStep}
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

function isBeat(k: string): k is Step {
  return k === "gather" || k === "draft" || k === "discuss" || k === "live";
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
  effectiveStep,
  peek,
  onBackToCurrent,
  onContinueToAnalysis,
}: {
  subStep: SubStep | null;
  effectiveStep: Step;
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
  switch (effectiveStep) {
    case "gather":
      return <PictureGather subStep={subStep} peek={peek} onBackToCurrent={onBackToCurrent} />;
    case "draft":
      return <PictureDraft subStep={subStep} peek={peek} onBackToCurrent={onBackToCurrent} />;
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
  effectiveStep,
  peek,
  onBackToCurrent,
}: {
  subStep: SubStep | null;
  effectiveStep: Step;
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
  switch (effectiveStep) {
    case "gather":
    case "draft":
      return <AnalysisDraft subStep={subStep} peek={peek} onBackToCurrent={onBackToCurrent} />;
    case "discuss":
      return <AnalysisDiscuss subStep={subStep} peek={peek} onBackToCurrent={onBackToCurrent} />;
    case "live":
      return <AnalysisLive subStep={subStep} peek={peek} onBackToCurrent={onBackToCurrent} />;
  }
}
