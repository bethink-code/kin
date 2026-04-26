// Pinned-bottom action bar. Carries the primary forward action and an optional
// secondary action for the current moment. The mini-timeline that used to live
// here moved into the pane header (PaneHeader's `steps` prop) — the foot is
// now action-only, with secondary on the left and primary on the right.

export type PhaseStep = {
  key: string;
  label: string;
  status: "past" | "current" | "future";
  // Short caption under the label — e.g. "done", "4 of 7", "dated 24 apr".
  caption?: string;
};

export function PhaseActionBar({
  primary,
  secondary,
}: {
  primary?: { label: string; onClick: () => void; disabled?: boolean };
  secondary?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <div className="shrink-0 bg-foreground text-background">
      <div className="flex items-center gap-6 px-6 py-4 min-h-[70px]">
        {secondary ? (
          <button
            type="button"
            onClick={secondary.onClick}
            disabled={secondary.disabled}
            className="px-3 py-2 text-xs text-background/70 hover:text-background disabled:opacity-60 transition-colors"
          >
            {secondary.label}
          </button>
        ) : (
          <span aria-hidden />
        )}
        <div className="ml-auto">
          {primary && (
            <button
              type="button"
              onClick={primary.onClick}
              disabled={primary.disabled}
              className="h-10 px-5 py-2 text-sm rounded-md bg-accent text-accent-foreground font-medium disabled:opacity-60 transition-colors hover:bg-accent/90"
            >
              {primary.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
