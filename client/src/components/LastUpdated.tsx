import { useEffect, useState } from "react";
import { formatTimeAgo } from "@/lib/formatters";

export function LastUpdated({ dataUpdatedAt }: { dataUpdatedAt: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!dataUpdatedAt) return null;
  return (
    <span className="text-xs text-muted-foreground">
      Updated {formatTimeAgo(new Date(dataUpdatedAt))}
    </span>
  );
}
