import type { AnalysisClaim } from "@shared/schema";
import { AnnotatedText, type InlineAnnotation } from "./AnnotatedText";

// Loose shape of the prose JSON persisted on analysisDrafts.prose. We keep the
// types narrow here to the fields we render — the full Zod schema lives in
// server/modules/analysisDraft/schema.ts.
type ProseParagraph = {
  text: string;
  annotations?: InlineAnnotation[];
};
type ProseSection = {
  id: string;
  heading?: string;
  paragraphs: ProseParagraph[];
};
type Prose = {
  sections: ProseSection[];
};

// Renders Format A — the text story. Serif editorial voice, no tables, no charts.
// Annotations are clickable spans that drive the Ally pane (Explain/Notes modes).
export function AnalysisProse({
  prose,
  claims: _claims,
}: {
  prose: unknown;
  claims: AnalysisClaim[];
}) {
  const p = (prose ?? {}) as Prose;
  const sections = p.sections ?? [];

  if (sections.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic">
        No prose content yet.
      </div>
    );
  }

  return (
    <article className="space-y-12 max-w-2xl">
      {/* Top-level orienting title — mirror of Canvas 1's "Your money, as I see it.".
          Without this the reader has no anchor for what they're looking at. */}
      <header>
        <h2 className="font-serif text-3xl">Our analysis.</h2>
        {sections[0] && sections[0].paragraphs[0] && !sections[0].heading && (
          <p className="mt-4 text-lg leading-relaxed text-foreground/90">
            <AnnotatedText
              text={sections[0].paragraphs[0].text}
              annotations={sections[0].paragraphs[0].annotations ?? []}
            />
          </p>
        )}
      </header>

      {sections.map((section, idx) => {
        const isOpening = idx === 0 && !section.heading;
        // Opening section: top paragraph is rendered in the header above.
        // Render any remaining paragraphs as flat prose under the title.
        const paragraphs = isOpening ? section.paragraphs.slice(1) : section.paragraphs;
        if (paragraphs.length === 0 && isOpening) return null;
        const heading = section.heading || (isOpening ? null : humanise(section.id));
        return (
          <section key={section.id}>
            {heading && <h3 className="font-serif text-2xl mb-4">{heading}</h3>}
            <div className="space-y-2 text-foreground/90 leading-relaxed">
              {paragraphs.map((para, i) => (
                <p key={i}>
                  <AnnotatedText
                    text={para.text}
                    annotations={para.annotations ?? []}
                  />
                </p>
              ))}
            </div>
          </section>
        );
      })}
    </article>
  );
}

// Humanise a snake_case section id into a sentence-case heading for fallback
// when the prompt didn't supply one. "your_income" → "Your income".
function humanise(id: string): string {
  const spaced = id.replace(/_/g, " ").trim();
  if (!spaced) return "";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
