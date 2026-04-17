import { useEffect, useState } from "react";
import { pickNextStory, type Story } from "@/lib/stories";

const ROTATION_MS = 12_000;
const FADE_MS = 600;

export function StoryRotator({ label = "A short story" }: { label?: string }) {
  const [story, setStory] = useState<Story>(() => pickNextStory(null));
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      const timeout = setTimeout(() => {
        setStory((prev) => pickNextStory(prev.id));
        setVisible(true);
      }, FADE_MS);
      return () => clearTimeout(timeout);
    }, ROTATION_MS);
    return () => clearInterval(interval);
  }, []);

  function next() {
    setVisible(false);
    setTimeout(() => {
      setStory((prev) => pickNextStory(prev.id));
      setVisible(true);
    }, FADE_MS);
  }

  return (
    <div className="rounded-md border border-border bg-card/60 p-8">
      <div className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className="transition-opacity"
        style={{ opacity: visible ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
      >
        <div className="font-serif text-3xl">{story.title}</div>
        <p className="mt-4 leading-relaxed text-foreground/90">{story.body}</p>
      </div>
      <div className="mt-6 flex justify-end">
        <button
          onClick={next}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Next story →
        </button>
      </div>
    </div>
  );
}
