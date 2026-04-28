import { Button } from "@/components/ui/button";
import { StoryRotator } from "@/components/StoryRotator";
import { WaitProgress } from "@/components/WaitProgress";
import { AllyNarration } from "@/components/AllyNarration";

// The reusable shell for the Analyse step on any canvas. Ally is at work;
// the person is witnessing. See architecture spec §4 "Ally at work".
//
// Sub-modes:
//   working       — the normal case; title, progress bar, interlude story
//   taking_longer — soft copy change; progress bar muted; stories continue
//   hit_problem   — named problem + recovery CTAs; stories paused
//   recovered     — "Okay, trying again…" → back to working
//
// The caller owns the mode transition (driven by sub-step status + timer on
// the server). This component is purely presentational.

export type AllyAtWorkMode = "working" | "taking_longer" | "hit_problem" | "recovered";

export function AllyAtWork({
  mode,
  title,
  expectedSeconds,
  rotatorLabel = "While I work · a short story",
  canvas,
  errorMessage,
  onRetry,
  onSkip,
}: {
  mode: AllyAtWorkMode;
  title: string;
  expectedSeconds: number;
  rotatorLabel?: string;
  /** Phase drives which narration stages cycle ("Reading…" vs "Drafting…"). */
  canvas?: "picture" | "analysis";
  errorMessage?: string | null;
  onRetry?: () => void;
  onSkip?: () => void;
}) {
  if (mode === "hit_problem") {
    return (
      <HitProblem errorMessage={errorMessage ?? null} onRetry={onRetry} onSkip={onSkip} />
    );
  }

  // working / taking_longer / recovered all render the same shell. The chat
  // pane carries the voice shift ("this is taking a bit longer…" / "Okay,
  // trying again…"); here we just soften the progress when it's taking long.
  const softened = mode === "taking_longer";

  return (
    <div className="flex flex-col items-center justify-start px-6 py-12 text-center space-y-6 h-full overflow-y-auto">
      <div>
        <h2 className="font-serif text-4xl leading-tight">{title}</h2>
        <p className="mt-3 text-muted-foreground">
          {softened
            ? "Taking a bit longer than I thought — still worth doing right."
            : "A minute or two — I want to get this right."}
        </p>
      </div>
      <div className={softened ? "opacity-70" : undefined}>
        <WaitProgress expectedSeconds={expectedSeconds} />
      </div>
      {canvas && (
        <div className="min-h-[2rem]">
          <AllyNarration canvas={canvas} />
        </div>
      )}
      <div className="w-full max-w-2xl pt-2">
        <StoryRotator label={rotatorLabel} />
      </div>
    </div>
  );
}

function HitProblem({
  errorMessage,
  onRetry,
  onSkip,
}: {
  errorMessage: string | null;
  onRetry?: () => void;
  onSkip?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center space-y-5 h-full overflow-y-auto">
      <div className="max-w-md">
        <h2 className="font-serif text-3xl leading-tight">I've hit a snag.</h2>
        <p className="mt-3 text-foreground/80 leading-relaxed">
          Something got in the way of what I was doing. I've got enough to pick up
          where I left off — want me to try again?
        </p>
        {errorMessage && (
          <p className="mt-3 text-xs text-muted-foreground/80">
            (for the record: {errorMessage})
          </p>
        )}
      </div>
      <div className="flex gap-3">
        {onRetry && (
          <Button onClick={onRetry} variant="default">
            Try again
          </Button>
        )}
        {onSkip && (
          <Button onClick={onSkip} variant="ghost">
            Skip for now
          </Button>
        )}
      </div>
    </div>
  );
}
