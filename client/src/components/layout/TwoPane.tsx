import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";

// Two-pane spatial grammar: content on the left, Ally on the right.
// Desktop: equal columns by default, with a draggable divider between them to shift the split.
// Mobile: stacked (content above, Ally below), no divider.
// The split ratio is persisted to localStorage so it survives refresh.

const STORAGE_KEY = "ally.splitPct";
const MIN_PCT = 25;
const MAX_PCT = 75;
const DEFAULT_PCT = 65;

function readStoredPct(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= MIN_PCT && n <= MAX_PCT) return n;
  } catch {
    // localStorage may be unavailable (SSR, privacy mode) — fall back to default
  }
  return DEFAULT_PCT;
}

export function TwoPane({ left, right }: { left: ReactNode; right: ReactNode }) {
  const [leftPct, setLeftPct] = useState<number>(DEFAULT_PCT);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Hydrate from localStorage after mount to avoid SSR/hydration mismatch.
  useEffect(() => {
    setLeftPct(readStoredPct());
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width === 0) return;
      const raw = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.max(MIN_PCT, Math.min(MAX_PCT, raw));
      setLeftPct(clamped);
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(STORAGE_KEY, String(leftPct));
      } catch {
        // ignore
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [leftPct]);

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function resetToDefault() {
    setLeftPct(DEFAULT_PCT);
    try {
      localStorage.setItem(STORAGE_KEY, String(DEFAULT_PCT));
    } catch {
      // ignore
    }
  }

  const style = { "--left-pct": `${leftPct}%` } as CSSProperties;

  return (
    <div ref={containerRef} className="flex flex-col md:flex-row h-full bg-muted" style={style}>
      <div className="flex flex-col min-h-0 w-full md:w-[var(--left-pct)] bg-card border-b md:border-b-0 border-border">
        {left}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(leftPct)}
        aria-valuemin={MIN_PCT}
        aria-valuemax={MAX_PCT}
        onMouseDown={startDrag}
        onDoubleClick={resetToDefault}
        title="Drag to resize · double-click to reset"
        className="hidden md:flex items-stretch w-1.5 cursor-col-resize flex-shrink-0 group"
      >
        <div className="w-px mx-auto bg-transparent group-hover:bg-accent/60 group-active:bg-accent transition-colors" />
      </div>

      <div className="flex flex-col min-h-0 flex-1 bg-background">
        {right}
      </div>
    </div>
  );
}
