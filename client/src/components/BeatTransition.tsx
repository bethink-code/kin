import { useEffect } from "react";
import { StoryRotator } from "@/components/StoryRotator";

// Brief transition shown between BeatLanding's CTA and the actual beat
// content. Reuses the same wait-state pattern (StoryRotator) Ally uses for
// real work — keeps the visual language consistent. ~2.5s default; auto-
// advances by calling onDone.

const TRANSITION_LINES: Record<string, Record<string, string>> = {
  picture: {
    gather: "Getting things ready…",
    analyse: "Reading it back…",
    discuss: "Picking up where we left off…",
    live: "Opening the record…",
  },
  analysis: {
    gather: "Pulling it in…",
    analyse: "Reading it back…",
    discuss: "Picking up where we left off…",
    live: "Opening the record…",
  },
};

export function BeatTransition({
  canvas,
  beat,
  durationMs = 2500,
  onDone,
}: {
  canvas: "picture" | "analysis";
  beat: "gather" | "analyse" | "discuss" | "live";
  durationMs?: number;
  onDone: () => void;
}) {
  const line = TRANSITION_LINES[canvas]?.[beat] ?? "One moment…";

  useEffect(() => {
    const t = setTimeout(onDone, durationMs);
    return () => clearTimeout(t);
  }, [durationMs, onDone]);

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 gap-8 text-center">
      <div>
        <div className="flex items-center justify-center gap-1.5 mb-3" aria-label="Ally is preparing">
          <span className="h-2 w-2 rounded-full bg-accent/70 animate-pulse [animation-delay:0ms]" />
          <span className="h-2 w-2 rounded-full bg-accent/70 animate-pulse [animation-delay:200ms]" />
          <span className="h-2 w-2 rounded-full bg-accent/70 animate-pulse [animation-delay:400ms]" />
        </div>
        <p className="text-sm text-muted-foreground italic">{line}</p>
      </div>
      <div className="w-full max-w-xl">
        <StoryRotator />
      </div>
    </div>
  );
}
