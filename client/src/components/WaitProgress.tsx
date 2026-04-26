import { useEffect, useState } from "react";

// A thin elapsed-time bar + "Xs in · about a minute" line. Used during known-
// duration waits (Canvas 2 draft generation, Canvas 1 analysis). After the
// expected time passes the bar stays full and the label flips to "nearly
// there" — we don't lie by staying at 99%.
export function WaitProgress({ expectedSeconds }: { expectedSeconds: number }) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const tick = setInterval(() => setElapsedMs(Date.now() - started), 500);
    return () => clearInterval(tick);
  }, []);

  const elapsedSec = Math.floor(elapsedMs / 1000);
  const expectedMs = expectedSeconds * 1000;
  const fillPct = Math.min(100, (elapsedMs / expectedMs) * 100);
  const overshooting = elapsedMs > expectedMs;

  return (
    <div className="w-full max-w-2xl space-y-1">
      <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-accent/70 transition-[width] duration-500 ease-linear"
          style={{ width: `${fillPct}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{overshooting ? "nearly there" : formatElapsed(elapsedSec)}</span>
        <span>about {formatExpected(expectedSeconds)}</span>
      </div>
    </div>
  );
}

function formatElapsed(sec: number): string {
  if (sec < 5) return "just getting started";
  if (sec < 60) return `${sec}s in`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s in`;
}

function formatExpected(sec: number): string {
  if (sec < 90) return "a minute";
  if (sec < 120) return "a minute and a half";
  return `${Math.round(sec / 60)} minutes`;
}
