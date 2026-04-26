import type { ReactNode } from "react";

// Symmetric pane header used on both sides of the two-pane layout.
// Left pane (content): user's avatar + first name + what they're doing.
// Right pane (Ally): 'a' circle + "Ally" + current mode.
// Optional `right` slot for e.g. the three-pill mode switcher on Ally's pane.
export function PaneHeader({
  avatar,
  name,
  statusLine,
  right,
}: {
  avatar: ReactNode;
  name: string;
  statusLine: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="bg-muted px-6 py-4 flex items-center gap-6">
      <div className="flex items-center gap-3 min-w-0">
        {avatar}
        <div className="min-w-0">
          <div className="font-serif text-xl leading-tight truncate">{name}</div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">{statusLine}</div>
        </div>
      </div>
      {right && <div className="flex-shrink-0">{right}</div>}
    </div>
  );
}
