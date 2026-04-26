import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { pickNextStory, STORIES, type Story } from "@/lib/stories";

const ROTATION_MS = 12_000;
const FADE_MS = 600;

type Tip = { id: string; title: string; body: string; source: "personal" | "general" };
type Card = (Story | Tip) & { source?: "personal" | "general" };

// Wait-state rotator. Pulls personalised tips from /api/tips (derived from
// the user's record_notes) and interleaves them with the curated story
// library — so the first wait sees stories, later waits see tips that
// reference what's already on the record.
export function StoryRotator({ label = "A short story" }: { label?: string }) {
  const tipsQ = useQuery<Tip[]>({ queryKey: ["/api/tips"] });

  const pool = useMemo<Card[]>(() => {
    const tips: Tip[] = (tipsQ.data ?? []).map((t) => ({ ...t, source: "personal" as const }));
    const stories: Card[] = STORIES.map((s) => ({ ...s, source: "general" as const }));
    // Interleave so the first card seen is personal (if any), then a story,
    // alternating. Falls back to plain stories for new users.
    if (tips.length === 0) return stories;
    const out: Card[] = [];
    const max = Math.max(tips.length, stories.length);
    for (let i = 0; i < max; i++) {
      if (i < tips.length) out.push(tips[i]);
      if (i < stories.length) out.push(stories[i]);
    }
    return out;
  }, [tipsQ.data]);

  const [card, setCard] = useState<Card>(() => pool[0] ?? pickNextStory(null));
  const [visible, setVisible] = useState(true);

  // When the pool becomes available (tips finish loading), swap to the first
  // card if we're still showing the seed story.
  useEffect(() => {
    if (pool.length > 0) setCard((prev) => pool.find((c) => c.id === prev.id) ?? pool[0]);
  }, [pool]);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      const timeout = setTimeout(() => {
        setCard((prev) => pickNext(pool, prev.id));
        setVisible(true);
      }, FADE_MS);
      return () => clearTimeout(timeout);
    }, ROTATION_MS);
    return () => clearInterval(interval);
  }, [pool]);

  function next() {
    setVisible(false);
    setTimeout(() => {
      setCard((prev) => pickNext(pool, prev.id));
      setVisible(true);
    }, FADE_MS);
  }

  const cardLabel = card.source === "personal" ? "From your record" : label;

  return (
    <div className="rounded-md border border-border bg-card/60 p-8">
      <div className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">{cardLabel}</div>
      <div
        className="transition-opacity"
        style={{ opacity: visible ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
      >
        <div className="font-serif text-3xl">{card.title}</div>
        <p className="mt-4 leading-relaxed text-foreground/90">{card.body}</p>
      </div>
      <div className="mt-6 flex justify-end">
        <button
          onClick={next}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function pickNext(pool: Card[], currentId: string): Card {
  if (pool.length === 0) return pickNextStory(currentId);
  if (pool.length === 1) return pool[0];
  const others = pool.filter((c) => c.id !== currentId);
  return others[Math.floor(Math.random() * others.length)];
}
