import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDate } from "@/lib/formatters";
import type { RecordNote } from "@shared/schema";

// Notes mode — the user's record of conversation. Available on every canvas,
// every step, all the time. Reads from /api/record/notes — the unified store.
//
// "Notes" is the user-facing surface name; internally this is the record. See
// Scratch/ally_architecture_spec.md and the slice 3 plan.
//
// Slice 3 scope: list view, category-grouped. Pending-gaps integration with
// the agreement gate is the next slice (gate work). Editing / supersede /
// soft-delete UI is also a follow-up.
const CATEGORY_ORDER = [
  "house",
  "retirement",
  "medical_aid",
  "life_cover",
  "income_protection",
  "debt",
  "crypto",
  "investments",
  "business",
  "tax",
  "family",
  "goals",
  "other_accounts",
  "summary",
  "decision",
  "flag",
  "other",
];

const CATEGORY_LABELS: Record<string, string> = {
  house: "House",
  retirement: "Retirement",
  medical_aid: "Medical aid",
  life_cover: "Life cover",
  income_protection: "Income protection",
  debt: "Debts",
  crypto: "Crypto",
  investments: "Investments",
  business: "Business",
  tax: "Tax",
  family: "Family & dependents",
  goals: "Goals",
  other_accounts: "Other accounts",
  summary: "Summaries",
  decision: "Decisions",
  flag: "Things flagged",
  other: "Other",
};

export function NotesPane({
  highlightedAnchorId,
  onBack,
}: {
  // Optional anchor to scroll to (when a phrase click in the prose targets a
  // specific note). Slice 3: the value comes through but not yet matched against
  // the new record_notes ids — we'll wire that mapping in a follow-up.
  highlightedAnchorId?: string | null;
  onBack: () => void;
}) {
  const notesQ = useQuery<RecordNote[]>({
    queryKey: ["/api/record/notes"],
  });

  const highlightRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (!highlightedAnchorId || !highlightRef.current) return;
    highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedAnchorId, notesQ.data]);

  if (!notesQ.isFetched) {
    return <Frame onBack={onBack}>Loading…</Frame>;
  }

  const notes = notesQ.data ?? [];
  if (notes.length === 0) {
    return (
      <Frame onBack={onBack}>
        Nothing yet. As we talk, this is where everything we establish gets
        recorded — your record of conversation, on hand whenever you want it.
      </Frame>
    );
  }

  const grouped = groupByCategory(notes);

  return (
    <div className="flex flex-col h-full min-h-0 shadow-[inset_0_0_0_4px_var(--color-muted)]">
      <div className="px-6 pt-5 pb-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        Your record · {notes.length} {notes.length === 1 ? "entry" : "entries"}
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-6">
        {CATEGORY_ORDER.filter((c) => grouped[c]?.length).map((category) => (
          <section key={category}>
            <h3 className="font-serif text-base mb-2">
              {CATEGORY_LABELS[category] ?? humanise(category)}
            </h3>
            <ul className="space-y-2">
              {grouped[category]!.map((n) => {
                const anchorId = readAnchorId(n);
                const isHighlighted =
                  anchorId !== null && anchorId === highlightedAnchorId;
                return (
                  <li
                    key={n.id}
                    ref={isHighlighted ? highlightRef : null}
                    className={`rounded-md border px-3 py-2 text-xs ${
                      isHighlighted
                        ? "border-accent bg-accent/5"
                        : "border-border bg-background"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="font-medium text-sm">{n.label}</div>
                      <div className="text-[10px] text-muted-foreground/80 flex-shrink-0">
                        {formatDate(n.establishedAt as unknown as string)}
                      </div>
                    </div>
                    {n.body && (
                      <div className="mt-0.5 text-muted-foreground leading-relaxed">
                        {n.body}
                      </div>
                    )}
                    {n.sourcePhase && (
                      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                        from · {n.sourcePhase}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <div className="border-t border-border px-6 py-3">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ← back to chat
        </button>
      </div>
    </div>
  );
}

function Frame({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="flex flex-col h-full min-h-0 shadow-[inset_0_0_0_4px_var(--color-muted)]">
      <div className="flex-1 flex items-center justify-center px-6 text-center">
        <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">{children}</p>
      </div>
      <div className="border-t border-border px-6 py-3">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ← back to chat
        </button>
      </div>
    </div>
  );
}

function groupByCategory(notes: RecordNote[]): Record<string, RecordNote[]> {
  const out: Record<string, RecordNote[]> = {};
  for (const n of notes) {
    const key = n.category ?? "other";
    if (!out[key]) out[key] = [];
    out[key].push(n);
  }
  return out;
}

function humanise(s: string): string {
  return s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

// Migrated notes carry their original anchorId in attributes.anchorId; this
// lets prose phrase clicks (which still use the old anchor scheme) line up.
function readAnchorId(n: RecordNote): string | null {
  const attrs = n.attributes as { anchorId?: string } | null;
  return attrs?.anchorId ?? null;
}
