import { useEffect, useState } from "react";

// Real-time narration during Analyse-step waits. Ally cycles through what
// she's doing right now — feels alive instead of passive. Replaces the
// static subtitle when the wait is long.
//
// Per Garth's feedback: the StoryRotator alone wasn't meaty enough during
// the ~30s analyse pass. Layering a rotating narration on top gives the
// page a second pulse so the user feels Ally working, not just waiting.

const PICTURE_STAGES = [
  "Reading every transaction across your statements…",
  "Mapping where the money tends to go…",
  "Looking for the rhythms — when it comes in, when it leaves…",
  "Categorising spending the way a person would, not a spreadsheet…",
  "Checking for the patterns the statements can't show on their own…",
  "Naming the gaps I'd want to ask you about…",
  "Writing your year back to you in plain language…",
  "One more pass to make sure it lands right…",
];

const ANALYSIS_STAGES = [
  "Pulling in your agreed picture…",
  "Working through the facts under the story…",
  "Finding the few that matter most…",
  "Drafting the prose — your money in plain words…",
  "Building the panels — the same story, drawn…",
  "Cross-checking what you've already corrected so I don't repeat the miss…",
  "Tightening the language…",
  "Almost there — one last read-through…",
];

const ROTATION_MS = 5000;

export function AllyNarration({ canvas }: { canvas: "picture" | "analysis" }) {
  const stages = canvas === "analysis" ? ANALYSIS_STAGES : PICTURE_STAGES;
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = setInterval(() => {
      setVisible(false);
      const t = setTimeout(() => {
        setIdx((i) => (i + 1) % stages.length);
        setVisible(true);
      }, 400);
      return () => clearTimeout(t);
    }, ROTATION_MS);
    return () => clearInterval(id);
  }, [stages.length]);

  return (
    <div
      className="text-sm italic text-foreground/70 transition-opacity"
      style={{ opacity: visible ? 1 : 0, transitionDuration: "400ms" }}
    >
      {stages[idx]}
    </div>
  );
}
