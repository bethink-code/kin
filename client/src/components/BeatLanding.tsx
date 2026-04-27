import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { formatDateLong } from "@/lib/formatters";
import type { BeatRelation, Beat } from "@/lib/beats";
import type { Analysis, AnalysisDraft as AnalysisDraftRow } from "@shared/schema";

// Landing card shown when the user clicks a beat tab/card. Always renders
// for tab-click navigation; never for natural progression. Copy varies by
// relation:
//   past    — "YOU'RE LOOKING BACK · THIS BEAT IS DONE"
//   current — "YOU'RE OPENING X"
//   future  — "COMING UP — what this will be when you reach it"
//
// CTA varies too:
//   past/current → "See / Carry on / Open it" → triggers BeatTransition
//                  → beat content (peek mode for past, live mode for current)
//   future       → "Back to current →" → no transition; just dismisses

type CanvasKey = "picture" | "analysis" | "plan" | "progress";

const COPY: Record<
  CanvasKey,
  Record<
    Beat,
    {
      titles: { past: string; current: string; future: string };
      sub: { past: string; current: string; future: string };
      cta: { past: string; current: string };
      // Live beats carry the locked-state ceremony copy on current.
      closed?: string;
    }
  >
> = {
  picture: {
    gather: {
      titles: {
        past: "Your statements",
        current: "Your statements",
        future: "Your statements",
      },
      sub: {
        past: "Twelve months of statements is what I read your year from. Here's what's on record.",
        current: "Where you upload everything I read your year from. Twelve months gives me the clearest picture, but we work with what you've got.",
        future: "Where you'll upload your last twelve months of bank statements. Any bank, any format.",
      },
      cta: { past: "See your statements →", current: "Continue uploading →" },
    },
    analyse: {
      titles: {
        past: "Your first take",
        current: "Reading your year",
        future: "Reading your year",
      },
      sub: {
        past: "I read across everything you uploaded and wrote you a story. That pass is done — here's where it landed.",
        current: "I'm reading across your statements and writing you a first take.",
        future: "Where I read across your statements and write you a first-take story.",
      },
      cta: { past: "See your first take →", current: "Carry on →" },
    },
    discuss: {
      titles: {
        past: "Talking through your picture",
        current: "Talking through your picture",
        future: "Talking through your picture",
      },
      sub: {
        past: "We read the first take together and shaped it. The conversation is here for the record.",
        current: "We read the first take together and shape it until it lands. The 'this is my picture' button locks it in when you're ready.",
        future: "Where we'll read the first take together and shape it until it lands.",
      },
      cta: { past: "See the conversation →", current: "Carry on →" },
    },
    live: {
      titles: {
        past: "Your past picture",
        current: "Your agreed picture",
        future: "Your agreed picture",
      },
      sub: {
        past: "An earlier version of your picture. Superseded by the conversation that's currently open.",
        current: "This is your baseline. Agreed and locked — referenceable, not editable in place.",
        future: "Once you agree your picture, it lives here — dated and locked.",
      },
      cta: { past: "See it →", current: "Open your picture →" },
      closed:
        "If anything's changed and you need to update it, click 'Something's not right' on the picture itself. That opens a new conversation. This version stays on the record, dated, untouched.",
    },
  },
  analysis: {
    gather: {
      titles: { past: "Pulled in", current: "Pulling it in", future: "Pulling it in" },
      sub: {
        past: "I pulled in your agreed picture and got set up. Quick step, done.",
        current: "I'm taking everything from your agreed picture and getting set up to write your analysis. This step is short.",
        future: "Where I'll pull in your agreed picture and get set up to write your analysis.",
      },
      cta: { past: "Carry on →", current: "Carry on →" },
    },
    analyse: {
      titles: {
        past: "Your analysis",
        current: "Writing your analysis",
        future: "Writing your analysis",
      },
      sub: {
        past: "I worked through your agreed picture and produced your analysis — facts, prose, and panels. That pass is done.",
        current: "I'm working through your agreed picture and producing your analysis — facts, prose, and panels.",
        future: "Where I'll write your analysis — facts, prose, and panels — from your agreed picture.",
      },
      cta: { past: "See your analysis →", current: "Carry on →" },
    },
    discuss: {
      titles: {
        past: "Refining your analysis",
        current: "Refining your analysis",
        future: "Refining your analysis",
      },
      sub: {
        past: "We shaped the draft together. The conversation is here for the record.",
        current: "We're shaping the draft together. Read it, react, correct what's off. The 'This is me' button locks the baseline when it lands right.",
        future: "Where we'll shape the draft together until it lands.",
      },
      cta: { past: "See the conversation →", current: "Carry on →" },
    },
    live: {
      titles: {
        past: "Your past analysis",
        current: "Your agreed analysis",
        future: "Your agreed analysis",
      },
      sub: {
        past: "An earlier version of your analysis. Superseded by the conversation that's currently open.",
        current: "This is your baseline analysis. Agreed and locked — referenceable, not editable in place.",
        future: "Once you agree your analysis, it lives here — dated and locked.",
      },
      cta: { past: "See it →", current: "Open your analysis →" },
      closed:
        "If anything's changed and you need to update it, click 'Something's not right' on the analysis itself. That opens a new conversation. This version stays on the record, dated, untouched.",
    },
  },
  plan: {
    gather: PLACEHOLDER("Pulled in"),
    analyse: PLACEHOLDER("Drafting your plan"),
    discuss: PLACEHOLDER("Shaping your plan"),
    live: PLACEHOLDER("Your agreed plan"),
  },
  progress: {
    gather: PLACEHOLDER("Check-in"),
    analyse: PLACEHOLDER("Reading the delta"),
    discuss: PLACEHOLDER("Talking it through"),
    live: PLACEHOLDER("Where you stand"),
  },
};

function PLACEHOLDER(title: string) {
  const sub =
    "Coming after we agree the analysis. Once your plan is in motion this lights up — until then it lives quietly.";
  return {
    titles: { past: title, current: title, future: title },
    sub: { past: sub, current: sub, future: sub },
    cta: { past: "Back to current →", current: "Back to current →" },
  };
}

const TAG: Record<BeatRelation, string> = {
  past: "YOU'RE LOOKING BACK · THIS BEAT IS DONE",
  current: "YOU'RE OPENING THIS",
  future: "COMING UP",
};

export function BeatLanding({
  canvas,
  beat,
  relation,
  isFirstEver,
  onCta,
  onBackToCurrent,
}: {
  canvas: CanvasKey;
  beat: Beat;
  relation: BeatRelation;
  /** True for the user's very first landing ever — drives the product
   *  orientation copy on the Gather card. */
  isFirstEver?: boolean;
  /** Past + current — proceed into the content (via BeatTransition). */
  onCta: () => void;
  /** Future or placeholder — dismiss without entering anything. */
  onBackToCurrent: () => void;
}) {
  // First-ever Gather gets the orientation card (what Kin is, no-advice
  // expectation, what we're going to build, why 12 months). Subsequent
  // visits to Gather get the routine summary.
  if (isFirstEver && canvas === "picture" && beat === "gather" && relation === "current") {
    return <FirstEverOrientation onCta={onCta} />;
  }

  const copy = COPY[canvas][beat];
  const title = copy.titles[relation];
  const sub = copy.sub[relation];

  // Surface completion stats only on past analyse + live.
  const analysisQ = useQuery<Analysis | null>({
    queryKey: ["/api/analysis/latest"],
    enabled: canvas === "picture" && (beat === "analyse" || beat === "live") && relation !== "future",
  });
  const draftQ = useQuery<AnalysisDraftRow | null>({
    queryKey: ["/api/analysis-draft/current"],
    enabled: canvas === "analysis" && (beat === "analyse" || beat === "live") && relation !== "future",
  });

  let stampLabel: string | null = null;
  let stampValue: string | null = null;
  if (canvas === "picture" && beat === "analyse" && relation !== "future") {
    const at = analysisQ.data?.completedAt as unknown as string | undefined;
    if (at) {
      stampLabel = "Completed";
      stampValue = formatDateLong(at);
    }
  } else if (canvas === "picture" && beat === "live" && relation === "current") {
    const at = analysisQ.data?.completedAt as unknown as string | undefined;
    if (at) {
      stampLabel = "Agreed";
      stampValue = formatDateLong(at);
    }
  } else if (canvas === "analysis" && beat === "analyse" && relation !== "future") {
    const at = draftQ.data?.generatedAt as unknown as string | undefined;
    if (at) {
      stampLabel = "Completed";
      stampValue = formatDateLong(at);
    }
  } else if (canvas === "analysis" && beat === "live" && relation === "current") {
    const at = draftQ.data?.agreedAt as unknown as string | undefined;
    if (at) {
      stampLabel = "Agreed";
      stampValue = formatDateLong(at);
    }
  }

  const isPlaceholder = canvas === "plan" || canvas === "progress";
  const ctaIsBack = relation === "future" || isPlaceholder;
  const ctaLabel = ctaIsBack ? "Back to current →" : copy.cta[relation as "past" | "current"];
  const ctaAction = ctaIsBack ? onBackToCurrent : onCta;

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center">
      <div className="max-w-md">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
          {TAG[relation]}
        </div>
        <h2 className="font-serif text-3xl mb-3">{title}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-5">{sub}</p>
        {stampLabel && stampValue && (
          <div className="rounded-lg border border-border bg-card/60 p-3 text-left text-xs space-y-1 mb-5">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{stampLabel}</span>
              <span className="text-foreground">{stampValue}</span>
            </div>
          </div>
        )}
        {beat === "live" && relation === "current" && copy.closed && (
          <p className="text-xs text-muted-foreground/85 leading-relaxed mb-6 italic">
            {copy.closed}
          </p>
        )}
        <Button onClick={ctaAction}>{ctaLabel}</Button>
      </div>
    </div>
  );
}

// Shown ONLY the first time a brand-new user lands in Gather — answers the
// "what is this thing? what does it do?" question explicitly so the user
// doesn't carry that confusion into the upload screen and Ally's first chat
// turn. Sets the no-advice expectation up front. Subsequent Gather landings
// fall back to the routine summary copy above.
function FirstEverOrientation({ onCta }: { onCta: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-10 text-center overflow-y-auto">
      <div className="max-w-xl space-y-5">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Welcome — let's start
        </div>
        <h2 className="font-serif text-3xl leading-tight">
          We build your picture before anything else.
        </h2>
        <p className="text-base text-foreground/85 leading-relaxed">
          Kin isn't a financial adviser. We don't tell you what to buy, where
          to put your money, or what you should do. We help you see your
          situation clearly — that's the whole point.
        </p>
        <div className="rounded-lg border border-border bg-card/60 p-5 text-left space-y-3 text-sm leading-relaxed">
          <div className="flex gap-3">
            <span className="font-serif text-xl text-accent leading-none">1</span>
            <div>
              <div className="font-medium">You upload your last twelve months of bank statements.</div>
              <div className="text-muted-foreground text-xs mt-0.5">
                Any bank, any format. Twelve months gives me a full year to find rhythms.
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="font-serif text-xl text-accent leading-none">2</span>
            <div>
              <div className="font-medium">I read across all of them and write you a first-take story.</div>
              <div className="text-muted-foreground text-xs mt-0.5">
                Your money, in plain language. Not a dashboard — a narrative.
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="font-serif text-xl text-accent leading-none">3</span>
            <div>
              <div className="font-medium">We shape it together until it lands right.</div>
              <div className="text-muted-foreground text-xs mt-0.5">
                You correct what's off, fill the gaps the statements can't show. When you say "this is me", we lock the baseline.
              </div>
            </div>
          </div>
        </div>
        <p className="text-sm text-muted-foreground italic">
          From there we move into the analysis, then a plan — but never advice.
          You stay in charge of every decision.
        </p>
        <div className="pt-2">
          <Button onClick={onCta}>Start uploading →</Button>
        </div>
      </div>
    </div>
  );
}
