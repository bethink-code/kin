import type { ReactNode } from "react";

export function PinnedActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 border-t border-border bg-background/95 px-6 py-3 flex justify-end gap-3 backdrop-blur">
      {children}
    </div>
  );
}
