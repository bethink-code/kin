import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { formatDateLong } from "@/lib/formatters";
import type { Analysis, AnalysisDraft as AnalysisDraftRow } from "@shared/schema";

// Landing card shown when the user clicks a beat tab in the canvas pill.
// Always renders for tab-click navigation; never for natural progression
// (server advances, agree → live, etc.). The "finite break" Garth identified
// as good UX — gives the user a moment of pause and explains what they're
// about to open, especially the locked-state framing for agreed beats.

type Beat = "gather" | "analyse" | "discuss" | "live";

type Status = "in_progress" | "agreed" | "future";

const COPY: Record<
  "picture" | "analysis",
  Record<Beat, { tag: string; title: string; sub: string; cta: string; closed?: string }>
> = {
  picture: {
    gather: {
      tag: "YOU'RE OPENING THIS",
      title: "Your statements",
      sub: "Where you upload everything I read your year from. Twelve months gives me the clearest picture, but we work with what you've got.",
      cta: "Continue uploading →",
    },
    analyse: {
      tag: "YOU'RE LOOKING BACK · THIS BEAT IS DONE",
      title: "Your first take",
      sub: "I read across everything you uploaded and wrote you a story. That pass is done — here's where it landed.",
      cta: "See your picture →",
    },
    discuss: {
      tag: "YOU'RE OPENING THE CONVERSATION",
      title: "Talking through your picture",
      sub: "We read the first take together and shape it until it lands. The 'this is my picture' button locks it in when you're ready.",
      cta: "Carry on →",
    },
    live: {
      tag: "YOU'RE OPENING WHAT'S CLOSED",
      title: "Your agreed picture",
      sub: "This is your baseline. Agreed and locked — referenceable, not editable in place.",
      closed:
        "If anything's changed and you need to update it, click 'Something's not right' on the picture itself. That opens a new conversation. This version stays on the record, dated, untouched.",
      cta: "Open your picture →",
    },
  },
  analysis: {
    gather: {
      // Canvas 2's gather is invisible (auto-pull) — fallback if ever shown.
      tag: "YOU'RE OPENING THIS",
      title: "Pulling it in",
      sub: "I'm taking everything from your agreed picture and getting set up to write your analysis. This step is short.",
      cta: "Carry on →",
    },
    analyse: {
      tag: "YOU'RE LOOKING BACK · THIS BEAT IS DONE",
      title: "Your analysis",
      sub: "I worked through your agreed picture and produced your analysis — facts, prose, and panels. That pass is done.",
      cta: "See your analysis →",
    },
    discuss: {
      tag: "YOU'RE OPENING THE CONVERSATION",
      title: "Refining your analysis",
      sub: "We're shaping the draft together. Read it, react, correct what's off. The 'This is me' button locks the baseline when it lands right.",
      cta: "Carry on →",
    },
    live: {
      tag: "YOU'RE OPENING WHAT'S CLOSED",
      title: "Your agreed analysis",
      sub: "This is your baseline analysis. Agreed and locked — referenceable, not editable in place.",
      closed:
        "If anything's changed and you need to update it, click 'Something's not right' on the analysis itself. That opens a new conversation. This version stays on the record, dated, untouched.",
      cta: "Open your analysis →",
    },
  },
};

export function BeatLanding({
  canvas,
  beat,
  onCta,
}: {
  canvas: "picture" | "analysis";
  beat: Beat;
  onCta: () => void;
}) {
  const copy = COPY[canvas][beat];

  // For analyse beat, surface completion stats so "this is done" feels concrete.
  const analysisQ = useQuery<Analysis | null>({
    queryKey: ["/api/analysis/latest"],
    enabled: canvas === "picture" && beat === "analyse",
  });
  const draftQ = useQuery<AnalysisDraftRow | null>({
    queryKey: ["/api/analysis-draft/current"],
    enabled: canvas === "analysis" && (beat === "analyse" || beat === "live"),
  });

  let completedAt: string | null = null;
  if (canvas === "picture" && beat === "analyse") {
    completedAt = (analysisQ.data?.completedAt as unknown as string | null | undefined) ?? null;
  } else if (canvas === "analysis" && beat === "analyse") {
    completedAt = (draftQ.data?.generatedAt as unknown as string | null | undefined) ?? null;
  } else if (beat === "live") {
    completedAt = (draftQ.data?.agreedAt as unknown as string | null | undefined) ?? null;
  }

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center">
      <div className="max-w-md">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
          {copy.tag}
        </div>
        <h2 className="font-serif text-3xl mb-3">{copy.title}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-5">{copy.sub}</p>
        {completedAt && (
          <div className="rounded-lg border border-border bg-card/60 p-3 text-left text-xs space-y-1 mb-5">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{beat === "live" ? "Agreed" : "Completed"}</span>
              <span className="text-foreground">{formatDateLong(completedAt)}</span>
            </div>
          </div>
        )}
        {copy.closed && (
          <p className="text-xs text-muted-foreground/85 leading-relaxed mb-6 italic">
            {copy.closed}
          </p>
        )}
        <Button onClick={onCta}>{copy.cta}</Button>
      </div>
    </div>
  );
}
