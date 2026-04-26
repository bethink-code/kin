import type { AnalysisClaim } from "@shared/schema";
import { AnnotatedText, type InlineAnnotation } from "./AnnotatedText";

// Loose shape of the panels JSON. Full Zod schema in server/modules/analysisDraft/schema.ts.
type ProportionPart = { label: string; weight: number };
type Proportion = { parts: ProportionPart[] };
type PanelBeat = {
  id: string;
  anchorCopy: string;
  metaphor: string;
  proportion?: Proportion;
  annotations?: InlineAnnotation[];
};
type Panels = {
  beats: PanelBeat[];
};

// Renders Format B — the comic. RING-FENCED: the illustration layer is a
// placeholder until the comic design approach is resolved. The panel data,
// pacing, and annotation logic are all live; only the metaphor artwork is
// stubbed.
//
// When the illustration system lands, replace <MetaphorPlaceholder /> with
// the real renderer. Everything else stays.
export function AnalysisPanels({
  panels,
  claims: _claims,
}: {
  panels: unknown;
  claims: AnalysisClaim[];
}) {
  const p = (panels ?? {}) as Panels;
  const beats = p.beats ?? [];

  if (beats.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic">
        No panel content yet.
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <ComicPlaceholderNotice />
      <div className="space-y-8">
        {beats.map((beat) => (
          <Beat key={beat.id} beat={beat} />
        ))}
      </div>
    </div>
  );
}

function Beat({ beat }: { beat: PanelBeat }) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <MetaphorPlaceholder metaphor={beat.metaphor} proportion={beat.proportion} />
      <div className="px-5 py-4">
        <p className="font-serif text-xl leading-snug">
          <AnnotatedText
            text={beat.anchorCopy}
            annotations={beat.annotations ?? []}
          />
        </p>
      </div>
    </div>
  );
}

// --- RING-FENCED: placeholder artwork ------------------------------------

function MetaphorPlaceholder({
  metaphor,
  proportion,
}: {
  metaphor: string;
  proportion?: Proportion;
}) {
  return (
    <div className="relative aspect-[16/9] bg-muted/40 flex items-center justify-center border-b border-border">
      <div className="absolute top-2 right-2 text-[10px] uppercase tracking-widest text-muted-foreground/70 bg-background/80 rounded px-1.5 py-0.5">
        comic · design pending
      </div>
      <div className="text-center px-6">
        <div className="font-serif text-2xl text-muted-foreground/80">
          {metaphor === "none" ? "—" : metaphor.replace(/_/g, " ")}
        </div>
        {proportion && <ProportionBar parts={proportion.parts} />}
      </div>
    </div>
  );
}

function ProportionBar({ parts }: { parts: ProportionPart[] }) {
  const total = parts.reduce((sum, p) => sum + p.weight, 0) || 1;
  return (
    <div className="mt-4 space-y-1">
      <div className="flex h-6 rounded overflow-hidden border border-border">
        {parts.map((p, i) => {
          const pct = (p.weight / total) * 100;
          return (
            <div
              key={i}
              className={i % 2 === 0 ? "bg-accent/40" : "bg-muted-foreground/30"}
              style={{ width: `${pct}%` }}
              title={`${p.label}: ${p.weight}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        {parts.map((p, i) => (
          <span key={i}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}

function ComicPlaceholderNotice() {
  return (
    <div className="rounded border border-dashed border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
      <strong className="font-medium text-foreground">Ring-fenced:</strong>{" "}
      the comic illustration layer is pending design — the panels, pacing, and
      annotations are live; the artwork above each panel is a placeholder.
    </div>
  );
}
