import { useState } from "react";
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
import type { AnalysisDraft as AnalysisDraftRow, Conversation, SubStep, SubStepMessage } from "@shared/schema";

// Tab-click navigation goes through three stages:
//   'landing'      — summary card explaining what they're opening
//   'transitioning'— brief loader (StoryRotator + Ally line)
//   null           — show actual content (also the natural state — no
//                    landing for server-driven progressions like agree)
type TabNavStage = "landing" | "transitioning" | null;

// Top-level dashboard. Both Canvas 1 and Canvas 2 now run on the sub-step
// primitive — single /api/sub-step/current query drives which beat screen renders.

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

  const [viewingCanvas, setViewingCanvas] = useState<CanvasKey | null>(null);
  const [viewingPictureBeat, setViewingPictureBeat] = useState<Beat | null>(null);
  const [viewingAnalysisBeat, setViewingAnalysisBeat] = useState<Beat | null>(null);
  const [tabNavStage, setTabNavStage] = useState<TabNavStage>(null);

  if (!user) return null;

  const canvas1Complete = conversationQ.data?.conversation?.status === "complete";
  // Natural canvas: wherever the user's sub-step says they are. Falls back to
  // legacy state while the sub-step query is still loading.
  const subStepCanvas = subStepQ.data?.subStep.canvasKey as CanvasKey | undefined;
  const naturalCanvas: CanvasKey =
    subStepCanvas ?? (canvas1Complete || draftQ.data ? "analysis" : "picture");
  const effectiveCanvas: CanvasKey = viewingCanvas ?? naturalCanvas;
  const firstName = user.firstName ?? user.email.split("@")[0];
  const subStep = subStepQ.data?.subStep ?? null;

  // What beat is each canvas at right now (independent of which one is viewed)?
  // The sub-step query gives us the user's forward-facing position — exactly
  // one canvas. For the *other* canvas we derive from auxiliary state so that
  // jumping between canvases lands on each one's actual current beat rather
  // than the analyse-default.
  const pictureCurrentBeat: Beat =
    subStep?.canvasKey === "picture" ? (subStep.beat as Beat) : "live";

  const analysisCurrentBeat: Beat = (() => {
    if (subStep?.canvasKey === "analysis") return subStep.beat as Beat;
    const d = draftQ.data;
    if (!d) return "analyse";
    if (d.status === "agreed") return "live";
    if (d.status === "ready") return "discuss";
    return "analyse"; // thinking / failed / unknown
  })();

  // Effective beat = explicit peek override OR the canvas's current beat.
  const effectiveBeat: Beat =
    effectiveCanvas === "picture"
      ? viewingPictureBeat ?? pictureCurrentBeat
      : viewingAnalysisBeat ?? analysisCurrentBeat;

  function onNavigateSubStep(canvas: CanvasKey, subStepKey: string) {
    setViewingCanvas(canvas === naturalCanvas ? null : canvas);
    if (canvas === "picture" && isBeat(subStepKey)) {
      setViewingPictureBeat(
        subStep?.canvasKey === "picture" && subStepKey === subStep.beat ? null : subStepKey,
      );
    } else if (canvas === "analysis" && isBeat(subStepKey)) {
      setViewingAnalysisBeat(
        subStep?.canvasKey === "analysis" && subStepKey === subStep.beat ? null : subStepKey,
      );
    }
    // Tab click always opens a landing screen first — the "finite break"
    // pattern. CTA on the landing advances to transitioning, then content.
    setTabNavStage("landing");
  }

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
            tabNavStage === "landing" && effectiveCanvas !== "plan" && effectiveCanvas !== "progress" ? (
              <BeatLanding
                canvas={effectiveCanvas as "picture" | "analysis"}
                beat={effectiveBeat}
                onCta={() => setTabNavStage("transitioning")}
              />
            ) : tabNavStage === "transitioning" && effectiveCanvas !== "plan" && effectiveCanvas !== "progress" ? (
              <BeatTransition
                canvas={effectiveCanvas as "picture" | "analysis"}
                beat={effectiveBeat}
                onDone={() => {
                  setTabNavStage(null);
                  // Clear the beat override so we land on the canvas's
                  // current beat (live / discuss / whatever it actually is).
                  // Tab click was a "look at this" — content shown after the
                  // pause is the canvas's real state.
                  if (effectiveCanvas === "analysis") setViewingAnalysisBeat(null);
                  else if (effectiveCanvas === "picture") setViewingPictureBeat(null);
                }}
              />
            ) : effectiveCanvas === "analysis" ? (
              <AnalysisContent
                subStep={subStep}
                effectiveBeat={effectiveBeat}
                displayName={firstName}
                onClearPeek={() => setViewingAnalysisBeat(null)}
              />
            ) : (
              <PictureContent
                subStep={subStep}
                effectiveBeat={effectiveBeat}
                onContinueToAnalysis={() => {
                  setViewingCanvas("analysis");
                  setTabNavStage("landing");
                }}
                onClearPeek={() => setViewingPictureBeat(null)}
              />
            )
          }
          right={<AllyPane canvas={effectiveCanvas} />}
        />
      </div>
    </div>
  );
}

function isBeat(k: string): k is Beat {
  return k === "gather" || k === "analyse" || k === "discuss" || k === "live";
}

function PictureContent({
  subStep,
  effectiveBeat,
  onContinueToAnalysis,
  onClearPeek,
}: {
  subStep: SubStep | null;
  effectiveBeat: Beat;
  onContinueToAnalysis: () => void;
  onClearPeek: () => void;
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
      return <PictureGather subStep={subStep} />;
    case "analyse":
      return <PictureAnalyse subStep={subStep} onPeekDone={onClearPeek} />;
    case "discuss":
      return <PictureDiscuss subStep={subStep} />;
    case "live":
      return <PictureLive subStep={subStep} onContinue={onContinueToAnalysis} />;
  }
}

function AnalysisContent({
  subStep,
  effectiveBeat,
  displayName: _displayName,
  onClearPeek,
}: {
  subStep: SubStep | null;
  effectiveBeat: Beat;
  displayName: string;
  onClearPeek: () => void;
}) {
  if (!subStep) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground italic">
        Settling in…
      </div>
    );
  }
  // Canvas 2's Gather beat is invisible — if somehow we're routed to it, the
  // server has auto-advanced; render Analyse while we wait for refetch.
  switch (effectiveBeat) {
    case "gather":
    case "analyse":
      return <AnalysisAnalyse subStep={subStep} onPeekDone={onClearPeek} />;
    case "discuss":
      return <AnalysisDiscuss subStep={subStep} />;
    case "live":
      return <AnalysisLive subStep={subStep} />;
  }
}
