import type { ReactNode } from "react";

// Inline annotation descriptor — matches the shape emitted by prose/panels prompts.
export type InlineAnnotation = {
  kind: "explain" | "note";
  phrase: string;
  anchorId: string;
};

// Split text around annotation phrases and render each phrase as a clickable span.
// Matches are greedy-first (annotations processed in order); if two annotations
// overlap the second is skipped.
export function AnnotatedText({
  text,
  annotations,
}: {
  text: string;
  annotations: InlineAnnotation[];
}) {
  if (annotations.length === 0) return <>{text}</>;

  type Piece = { kind: "text"; text: string } | { kind: "ann"; ann: InlineAnnotation; text: string };
  const pieces: Piece[] = [{ kind: "text", text }];

  for (const ann of annotations) {
    // Walk existing pieces and split any text piece that contains this phrase.
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (p.kind !== "text") continue;
      const idx = p.text.indexOf(ann.phrase);
      if (idx < 0) continue;
      const before = p.text.slice(0, idx);
      const after = p.text.slice(idx + ann.phrase.length);
      const replacement: Piece[] = [];
      if (before) replacement.push({ kind: "text", text: before });
      replacement.push({ kind: "ann", ann, text: ann.phrase });
      if (after) replacement.push({ kind: "text", text: after });
      pieces.splice(i, 1, ...replacement);
      break; // only first match per annotation
    }
  }

  return (
    <>
      {pieces.map((p, i) =>
        p.kind === "text" ? (
          <span key={i}>{p.text}</span>
        ) : (
          <AnnSpan key={i} ann={p.ann} text={p.text} />
        ),
      )}
    </>
  );
}

function AnnSpan({ ann, text }: { ann: InlineAnnotation; text: string }): ReactNode {
  const classes =
    ann.kind === "explain"
      ? "bg-amber-100 text-amber-900 rounded px-0.5 cursor-pointer hover:bg-amber-200 transition-colors"
      : "border-b border-dotted border-muted-foreground cursor-pointer hover:bg-muted/60 transition-colors";

  const onClick = () => {
    window.dispatchEvent(
      new CustomEvent("ally-pane-mode", {
        detail: { mode: ann.kind, anchorId: ann.anchorId },
      }),
    );
  };

  return (
    <span className={classes} onClick={onClick} role="button" tabIndex={0}>
      {text}
    </span>
  );
}
