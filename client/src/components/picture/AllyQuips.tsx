import { useEffect, useState } from "react";

// Ally's waiting-state voice. Rotates through a small script while she's
// working. Ordered roughly from grounding → self-aware → warm — the longer
// it takes, the more she leans into the wait. Not a script of loading states
// (she doesn't know what step she's on); a script of her personality.
//
// Admin-editability: these will move to a db-backed copy table later. For now
// they live here so writers can tweak without touching schema.
const QUIPS = [
  "I'm putting your full picture together now. Give me a moment — this is the important bit.",
  "Still reading. Your financial life is more interesting than you might think.",
  "I'm looking at the things between the numbers, not just the numbers.",
  "I'd rather take a minute longer than give you something half-true.",
  "I'm sure this is worth it. We'll see.",
  "Still here. Still writing. Still thinking about the retirement gap.",
  "If you're checking the clock — yes, me too.",
  "Almost there. I know — I've been saying that.",
  "Final polish. You want it to read like it was written by someone who listens.",
];

const ROTATION_MS = 11_000;
const FADE_MS = 500;

export function AllyQuips() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      const t = setTimeout(() => {
        setIndex((i) => Math.min(QUIPS.length - 1, i + 1));
        setVisible(true);
      }, FADE_MS);
      return () => clearTimeout(t);
    }, ROTATION_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <p
      className="font-serif italic text-foreground/80 leading-relaxed max-w-xs transition-opacity"
      style={{ opacity: visible ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
    >
      {QUIPS[index]}
    </p>
  );
}
