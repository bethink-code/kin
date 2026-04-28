import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { UserAvatar, getInitials } from "./Avatars";
import { STEP_ORDER, type Step } from "@/lib/steps";
import { formatDateLong, formatDate, formatTimeAgo } from "@/lib/formatters";
import {
  PHASE_KEYS,
  PHASE_PILL_LABEL,
  PHASE_CARD_TITLE,
  PHASE_TAB_CAPTION,
  STEP_LABEL,
  phaseStates,
  type PhaseKey,
} from "@/lib/canvasCopy";
import type { Statement, Analysis, AnalysisDraft, SubStep, SubStepMessage } from "@shared/schema";

// Phase pill + megamenu (the arc per brief §6). The menu has four sections:
//   1. Phase tab bar (the four canvases across the top) — clicks swap the
//      view INSIDE the modal only, they never navigate.
//   2. Ally narration paragraph (follows the viewed tab)
//   3. The four stage cards within the viewed canvas — clicks navigate and
//      close the modal.
//   4. History footer
// Past canvases (agreed) and the current canvas are clickable in both the
// tab bar and the stage grid. Next/later/dormant canvases are muted and inert.
export function CanvasMenu({
  activeCanvas,
  onNavigateSubStep,
}: {
  activeCanvas: PhaseKey;
  onNavigateSubStep?: (canvas: PhaseKey, subStep: string) => void;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Queries that drive the inline step timeline on the trigger pill (and that
  // also feed the megamenu's stage cards). Pulling them up to the outer scope
  // means trigger + megamenu read the same data.
  const subStepQ = useQuery<{ subStep: SubStep; messages: SubStepMessage[] } | null>({
    queryKey: ["/api/sub-step/current"],
  });
  const statementsQ = useQuery<Statement[]>({ queryKey: ["/api/statements"] });
  const analysisQ = useQuery<Analysis | null>({ queryKey: ["/api/analysis/latest"] });
  const draftQ = useQuery<AnalysisDraft | null>({ queryKey: ["/api/analysis-draft/current"] });

  // Step for the currently-active canvas. Sub-step query is the user's
  // forward-facing position; if they're on the picture canvas, the step we
  // care about is picture's; same for analysis. When the user is *viewing*
  // a different canvas via the menu (past view), fall back to its terminal
  // step (Live).
  const activeStep: Step = (() => {
    const sub = subStepQ.data?.subStep;
    if (sub && sub.phaseKey === activeCanvas) return sub.step as Step;
    if (activeCanvas === "picture") return "live";
    if (activeCanvas === "analysis") return "live";
    return "gather";
  })();

  return (
    <div className="relative">
      <PillTrigger
        user={user}
        activeCanvas={activeCanvas}
        currentStep={activeStep}
        statements={statementsQ.data ?? []}
        analysis={analysisQ.data ?? null}
        draft={draftQ.data ?? null}
        subStep={subStepQ.data?.subStep ?? null}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        onNavigateSubStep={onNavigateSubStep}
      />
      {open && (
        <>
          <div
            className="fixed inset-0 bg-black/65 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Phase navigation"
            className="fixed inset-x-0 top-28 z-50 flex justify-center px-4 pointer-events-none"
          >
            <div className="w-full max-w-5xl rounded-xl border border-border bg-card shadow-2xl pointer-events-auto">
              <Arc
                activeCanvas={activeCanvas}
                onClose={() => setOpen(false)}
                onNavigateSubStep={onNavigateSubStep}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// The trigger element of the canvas menu — replaces the old small pill button.
// Visually a wide cream capsule with: avatar | canvas title | inline step
// timeline. Clicking anywhere on the capsule opens the megamenu (same as
// the original pill's behaviour).
function PillTrigger({
  user: _user,
  activeCanvas,
  currentStep,
  statements,
  analysis,
  draft,
  subStep,
  open,
  onToggle,
  onNavigateSubStep,
}: {
  user: ReturnType<typeof useAuth>["user"];
  activeCanvas: PhaseKey;
  currentStep: Step;
  statements: Statement[];
  analysis: Analysis | null;
  draft: AnalysisDraft | null;
  subStep: SubStep | null;
  open: boolean;
  onToggle: () => void;
  onNavigateSubStep?: (canvas: PhaseKey, subStep: string) => void;
}) {
  const extractedCount = statements.filter((s) => s.status === "extracted").length;
  const analysisDone = analysis?.status === "done";
  const currentIdx = STEP_ORDER.indexOf(currentStep);

  // Container is a div, not a button — past/current beats are individually
  // clickable to jump straight to that sub-step, and the title carries an
  // explicit chevron + hover affordance to signal "opens menu".
  return (
    <div className="flex items-center gap-4 px-3 py-2 rounded-lg bg-muted">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-foreground/5 transition-colors"
        title="Open canvas menu"
      >
        <span className="font-serif text-xl text-foreground leading-none">
          {PHASE_CARD_TITLE[activeCanvas]}
        </span>
        <span
          className={`text-foreground/60 text-sm transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          ▾
        </span>
      </button>
      <ol className="flex items-center gap-1">
        {STEP_ORDER.map((step, i) => {
          const relation: "past" | "current" | "future" =
            i < currentIdx ? "past" : i === currentIdx ? "current" : "future";
          const meta = STEP_LABEL[activeCanvas][step];
          const title = meta.title || (step === "gather" ? "Pulled in" : step);
          const caption = beatCaption(activeCanvas, step, relation, {
            extractedCount,
            analysisDone,
            draft,
            subStep,
          });
          // Permissive: every step in the inline pill timeline is clickable
          // — past/current go through landing → transition → content; future
          // go through landing → "Back to current" (no transition). Single
          // rule via the new navigation module.
          const clickable = !!onNavigateSubStep;
          const handleClick = clickable
            ? () => onNavigateSubStep?.(activeCanvas, step)
            : undefined;
          return (
            <li key={step} className="flex items-center gap-1">
              {i > 0 && <span className="text-foreground/30 text-[11px]">—</span>}
              <BeatStep
                title={title}
                caption={caption}
                relation={relation}
                onClick={handleClick}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function BeatStep({
  title,
  caption,
  relation,
  onClick,
}: {
  title: string;
  caption: string;
  relation: "past" | "current" | "future";
  onClick?: () => void;
}) {
  const base = "flex flex-col items-start px-2 py-1 rounded-md text-left transition-colors";
  const cls =
    relation === "current"
      ? "bg-foreground text-background"
      : relation === "past"
        ? "text-foreground/85"
        : "text-foreground/40";
  const captionCls =
    relation === "current"
      ? "text-background/70"
      : relation === "past"
        ? "text-foreground/55"
        : "text-foreground/30";
  const hoverCls = onClick
    ? relation === "current"
      ? "hover:bg-foreground/90 cursor-pointer"
      : "hover:bg-foreground/10 cursor-pointer"
    : "";
  const body = (
    <>
      <span className="text-[12px] font-medium leading-tight">{title}</span>
      <span className={`text-[10px] leading-tight ${captionCls}`}>{caption}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} ${cls} ${hoverCls}`}
        title={`Jump to ${title}`}
      >
        {body}
      </button>
    );
  }
  return <div className={`${base} ${cls}`}>{body}</div>;
}

function beatCaption(
  canvas: PhaseKey,
  step: Step,
  relation: "past" | "current" | "future",
  ctx: { extractedCount: number; analysisDone: boolean; draft: AnalysisDraft | null; subStep: SubStep | null },
): string {
  if (relation === "future") return "—";
  if (canvas === "picture") {
    if (step === "gather") {
      if (relation === "current") return ctx.extractedCount > 0 ? `${ctx.extractedCount} read` : "ready";
      return "done";
    }
    if (step === "draft") {
      if (relation === "current") return ctx.analysisDone ? "just done" : "writing";
      return "done";
    }
    if (step === "discuss") {
      if (relation === "current") return "in conversation";
      return "done";
    }
    if (step === "live") {
      if (relation === "current") {
        const at = ctx.subStep?.agreedAt ?? ctx.subStep?.startedAt ?? null;
        return at ? `agreed ${formatDate(at as unknown as string)}` : "agreed";
      }
      return "done";
    }
  }
  if (canvas === "analysis") {
    if (step === "gather") return relation === "current" ? "pulling in" : "done";
    if (step === "draft") return relation === "current" ? "thinking" : "done";
    if (step === "discuss") return relation === "current" ? "refining" : "done";
    if (step === "live") {
      if (relation === "current") {
        const at = ctx.draft?.agreedAt ?? ctx.subStep?.agreedAt ?? null;
        return at ? `agreed ${formatDate(at as unknown as string)}` : "agreed";
      }
      return "done";
    }
  }
  return relation === "current" ? "in progress" : "done";
}

function Arc({
  activeCanvas,
  onClose,
  onNavigateSubStep,
}: {
  activeCanvas: PhaseKey;
  onClose: () => void;
  onNavigateSubStep?: (canvas: PhaseKey, subStep: string) => void;
}) {
  const { user } = useAuth();
  const statementsQ = useQuery<Statement[]>({ queryKey: ["/api/statements"] });
  const analysisQ = useQuery<Analysis | null>({ queryKey: ["/api/analysis/latest"] });
  const draftQ = useQuery<AnalysisDraft | null>({ queryKey: ["/api/analysis-draft/current"] });
  const conversationQ = useQuery<{ conversation: { status?: string } | null } | null>({
    queryKey: ["/api/qa/conversation"],
  });
  // Phase 1's current step comes from the sub-step primitive.
  const subStepQ = useQuery<{ subStep: SubStep; messages: SubStepMessage[] } | null>({
    queryKey: ["/api/sub-step/current"],
  });

  // Which canvas's tab the user is currently PEEKING at inside the modal.
  // Independent from the actual active canvas — tab clicks just swap this
  // local view. Navigation only happens when a stage card is clicked.
  const [viewingTab, setViewingTab] = useState<PhaseKey>(activeCanvas);
  useEffect(() => {
    setViewingTab(activeCanvas);
  }, [activeCanvas]);

  const pictureBeat: Step =
    subStepQ.data?.subStep && subStepQ.data.subStep.phaseKey === "picture"
      ? (subStepQ.data.subStep.step as Step)
      : "gather";
  const analysisBeat: Step =
    subStepQ.data?.subStep && subStepQ.data.subStep.phaseKey === "analysis"
      ? (subStepQ.data.subStep.step as Step)
      : "draft";
  const extractedCount = (statementsQ.data ?? []).filter((s) => s.status === "extracted").length;
  const analysisDone = analysisQ.data?.status === "done";
  const draft = draftQ.data ?? null;

  // A canvas counts as "past" (and therefore navigable) once the user has
  // moved past it — even if they later reopen it. Reopen flips the legacy
  // status field back to "active" but doesn't undo downstream state, so we
  // derive "agreed" from the most durable signal:
  //   picture  — any analysis_draft exists (startCanvas2 only fires after
  //              Phase 1 agree), OR the legacy status is still "complete"
  //   analysis — the active draft is agreed
  // This survives Phase 1 reopen so the picture tab stays navigable.
  const agreedPhases = new Set<PhaseKey>();
  if (
    draftQ.data != null ||
    conversationQ.data?.conversation?.status === "complete"
  ) {
    agreedPhases.add("picture");
  }
  if (draft?.status === "agreed") agreedPhases.add("analysis");

  const handleStageClick = onNavigateSubStep
    ? (canvas: PhaseKey, subStep: string) => {
        onNavigateSubStep(canvas, subStep);
        onClose();
      }
    : undefined;

  return (
    <div>
      <CanvasTabs
        viewingTab={viewingTab}
        agreedPhases={agreedPhases}
        onSelect={setViewingTab}
      />
      <div className="px-8 py-8 space-y-6">
        <Narration
          activeCanvas={viewingTab}
          pictureBeat={pictureBeat}
          extractedCount={extractedCount}
          userCreatedAt={user?.createdAt}
        />
        {viewingTab === "picture" && (
          <PictureStages
            currentStep={pictureBeat}
            extractedCount={extractedCount}
            analysisDone={analysisDone}
            onStageClick={handleStageClick}
          />
        )}
        {viewingTab === "analysis" && (
          <AnalysisStages
            currentStep={analysisBeat}
            draft={draft}
            onStageClick={handleStageClick}
          />
        )}
        {viewingTab === "plan" && <PlanStages onStageClick={handleStageClick} />}
        {viewingTab === "progress" && <ProgressStages onStageClick={handleStageClick} />}
      </div>
      <HistoryFooter userCreatedAt={user?.createdAt} onClose={onClose} />
    </div>
  );
}

function CanvasTabs({
  viewingTab,
  agreedPhases,
  onSelect,
}: {
  viewingTab: PhaseKey;
  agreedPhases: ReadonlySet<PhaseKey>;
  onSelect: (k: PhaseKey) => void;
}) {
  const states = phaseStates(viewingTab, agreedPhases);
  return (
    <div className="grid grid-cols-4 border-b border-border pt-8">
      {PHASE_KEYS.map((k) => {
        const state = states[k];
        const isCurrent = state === "current";
        const isPast = state === "past";
        // All tabs interactive — peek any canvas inside the modal. Stage
        // cards are the navigation surface; tabs only switch the in-modal
        // view. Permissive: don't gate by progress state.
        const interactive = true;

        const content = (
          <>
            <div
              className={`font-serif text-base leading-tight ${
                isCurrent ? "text-foreground" : isPast ? "text-foreground/80" : "text-muted-foreground"
              }`}
            >
              {PHASE_CARD_TITLE[k]}
            </div>
            <div
              className={`text-[11px] mt-0.5 ${
                isCurrent ? "text-accent" : "text-muted-foreground/70"
              }`}
            >
              {PHASE_TAB_CAPTION[state]}
            </div>
          </>
        );

        const borderClass = isCurrent
          ? "border-accent"
          : isPast
            ? "border-border/40"
            : "border-transparent";

        if (interactive) {
          return (
            <button
              key={k}
              type="button"
              onClick={() => onSelect(k)}
              className={`px-6 py-5 border-b-2 text-left hover:bg-muted/50 transition-colors ${borderClass}`}
            >
              {content}
            </button>
          );
        }

        return (
          <div key={k} className={`px-6 py-5 border-b-2 ${borderClass}`}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

function Narration({
  activeCanvas,
  pictureBeat,
  extractedCount,
  userCreatedAt,
}: {
  activeCanvas: PhaseKey;
  pictureBeat: Step;
  extractedCount: number;
  userCreatedAt?: string;
}) {
  const paragraphs = narrationFor({ activeCanvas, pictureBeat, extractedCount, userCreatedAt });
  return (
    <div className="space-y-2">
      {paragraphs.map((p, i) => (
        <p key={i} className="text-sm text-foreground/85 leading-relaxed max-w-3xl">
          {p}
        </p>
      ))}
      <p className="text-xs text-muted-foreground">No rush. One thing at a time.</p>
    </div>
  );
}

function narrationFor({
  activeCanvas,
  pictureBeat,
  extractedCount,
  userCreatedAt,
}: {
  activeCanvas: PhaseKey;
  pictureBeat: Step;
  extractedCount: number;
  userCreatedAt?: string;
}): string[] {
  if (activeCanvas === "analysis") {
    return [
      "You've agreed your picture. Now we sit with it together — I write a first-draft analysis, in words and in panels, and we shape it until it lands. No advice yet. Just seeing it clearly.",
      "When we agree this, it becomes the baseline. Your plan is next.",
    ];
  }
  if (activeCanvas === "plan") {
    return ["Your plan comes after we agree the analysis. One thing at a time."];
  }
  if (activeCanvas === "progress") {
    return ["Your progress wakes up once you have a plan in motion."];
  }

  if (pictureBeat === "gather" && extractedCount === 0) {
    return [
      "We're just getting started. Drop your last twelve months of statements on the left whenever you're ready — the more I see, the clearer your picture gets. We'll move through four beats together, ending with an agreed baseline.",
    ];
  }
  if (pictureBeat === "gather") {
    const word = extractedCount === 1 ? "statement" : "statements";
    return [
      `You've uploaded ${extractedCount} ${word} so far. Keep going when you're ready — twelve months gives me a full year to work with.`,
    ];
  }
  if (pictureBeat === "draft") {
    return [
      "I'm reading across everything you've uploaded and writing you a first take. Give me a minute or two — this is the important bit.",
    ];
  }
  if (pictureBeat === "discuss") {
    const since = userCreatedAt ? formatTimeAgo(userCreatedAt) : "a little while";
    return [
      `We've been working on your picture since ${since}. Have a read through the first take, and tell me what I got wrong.`,
      "When it lands right, we'll agree a baseline — the \"you were here\" marker for everything downstream.",
    ];
  }
  // live
  return ["Your picture is agreed. I'm here if you need me."];
}

function PictureStages({
  currentStep,
  extractedCount,
  analysisDone,
  onStageClick,
}: {
  currentStep: Step;
  extractedCount: number;
  analysisDone: boolean;
  onStageClick?: (canvas: PhaseKey, subStep: string) => void;
}) {
  const currentIdx = STEP_ORDER.indexOf(currentStep);

  return (
    <div className="space-y-2">
      <SectionLabel>The four beats of your financial snapshot</SectionLabel>
      <div className="grid grid-cols-4 gap-3">
        {STEP_ORDER.map((step, i) => {
          const relation: "past" | "current" | "next" | "future" =
            i < currentIdx
              ? "past"
              : i === currentIdx
                ? "current"
                : i === currentIdx + 1
                  ? "next"
                  : "future";

          const meta = STEP_LABEL.picture[step];
          const status = pictureStepStatus(step, relation, extractedCount, analysisDone);
          // Permissive: every step clickable — Dashboard's landing/transition
          // flow handles past/current/future variants.
          const clickable = !!onStageClick;
          const handleClick =
            clickable && onStageClick ? () => onStageClick("picture", step) : undefined;

          return (
            <StageCard
              key={step}
              badge={String(i + 1)}
              title={meta.title}
              description={meta.description}
              status={status}
              relation={relation}
              onClick={handleClick}
            />
          );
        })}
      </div>
    </div>
  );
}

function pictureStepStatus(
  step: Step,
  relation: "past" | "current" | "next" | "future",
  extractedCount: number,
  analysisDone: boolean,
): string {
  if (step === "gather") {
    if (relation === "current") {
      const toGo = Math.max(0, 12 - extractedCount);
      return toGo > 0 ? `${extractedCount} read · ${toGo} to go` : `${extractedCount} read`;
    }
    return relation === "past" ? `${extractedCount} · done` : "—";
  }
  if (step === "draft") {
    if (relation === "current") return analysisDone ? "just done" : "writing";
    if (relation === "next") return "opens when Gather is done";
    return relation === "past" ? "done" : "—";
  }
  if (step === "discuss") {
    if (relation === "current") return "in conversation";
    if (relation === "next") return "opens when the first take lands";
    return relation === "past" ? "done" : "—";
  }
  // live
  if (relation === "current") return "agreed";
  if (relation === "next") return "pending your sign-off";
  return relation === "past" ? "superseded" : "—";
}

function StageCard({
  badge,
  title,
  description,
  status,
  relation,
  onClick,
}: {
  badge: string;
  title: string;
  description: string;
  status: string;
  relation: "past" | "current" | "next" | "future";
  onClick?: () => void;
}) {
  const interactive = !!onClick;
  const base = "flex flex-col gap-2 p-4 rounded-lg border text-left min-h-[170px] transition-colors";
  const cls =
    relation === "current"
      ? "border-accent bg-accent/5"
      : relation === "next"
        ? "border-border bg-background"
        : "border-dashed border-border/60 bg-background opacity-65";

  const content = (
    <>
      <div
        className={`font-serif text-5xl leading-none ${
          relation === "current" ? "text-accent" : "text-muted-foreground/60"
        }`}
      >
        {badge}
      </div>
      <div className="font-serif text-xl leading-tight">{title}</div>
      <p className="text-xs text-foreground/75 leading-relaxed">{description}</p>
      <div className="mt-auto text-xs text-muted-foreground">{status}</div>
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} ${cls} hover:bg-muted cursor-pointer`}
      >
        {content}
      </button>
    );
  }
  return <div className={`${base} ${cls}`}>{content}</div>;
}

function HistoryFooter({ userCreatedAt, onClose }: { userCreatedAt?: string; onClose: () => void }) {
  const started = userCreatedAt ? formatDateLong(userCreatedAt) : "—";
  return (
    <div className="border-t border-border px-8 py-4 flex items-center justify-between gap-4">
      <span className="text-xs text-muted-foreground">
        Your history with Ally — 0 baselines to come · 0 plan commitments · Started {started}
      </span>
      <button
        type="button"
        onClick={onClose}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Close ✕
      </button>
    </div>
  );
}

function AnalysisStages({
  currentStep,
  draft,
  onStageClick,
}: {
  currentStep: Step;
  draft: AnalysisDraft | null;
  onStageClick?: (canvas: PhaseKey, subStep: string) => void;
}) {
  const currentIdx = STEP_ORDER.indexOf(currentStep);

  return (
    <div className="space-y-2">
      <SectionLabel>The four beats of our analysis</SectionLabel>
      <div className="grid grid-cols-4 gap-3">
        {STEP_ORDER.map((step, i) => {
          const relation: "past" | "current" | "next" | "future" =
            i < currentIdx
              ? "past"
              : i === currentIdx
                ? "current"
                : i === currentIdx + 1
                  ? "next"
                  : "future";

          const meta = STEP_LABEL.analysis[step];
          // Phase 2's Gather is an invisible pull — if a user opens the menu
          // during it (very short window), show a descriptive placeholder.
          const title = meta.title || "Pulled in";
          const description = meta.description || "Ally pulls in your agreed picture and gets to work.";
          const status = analysisStepStatus(step, relation, draft);
          const clickable = !!onStageClick;
          const handleClick =
            clickable && onStageClick ? () => onStageClick("analysis", step) : undefined;

          return (
            <StageCard
              key={step}
              badge={String(i + 1)}
              title={title}
              description={description}
              status={status}
              relation={relation}
              onClick={handleClick}
            />
          );
        })}
      </div>
    </div>
  );
}

function analysisStepStatus(
  step: Step,
  relation: "past" | "current" | "next" | "future",
  draft: AnalysisDraft | null,
): string {
  if (step === "gather") {
    if (relation === "current") return "Pulling it in";
    if (relation === "past") return "Done";
    return relation === "next" ? "Starts when you agree your picture" : "—";
  }
  if (step === "draft") {
    if (relation === "current") return "Thinking";
    if (relation === "past") return "Done";
    return relation === "next" ? "Opens when pulled in" : "—";
  }
  if (step === "discuss") {
    if (relation === "current") return "Refining together";
    if (relation === "past") return "Done";
    return relation === "next" ? "Opens when ready" : "—";
  }
  // live
  if (relation === "current" && draft?.agreedAt) {
    return `Agreed ${formatDate(draft.agreedAt as unknown as string)}`;
  }
  if (relation === "current") return "Agreed";
  return relation === "next" ? "Pending your sign-off" : "—";
}

// Placeholder stages for canvases not yet built. Cards clickable — clicks
// route through the StepController "Coming up" path which dismisses with
// "Back to current" (no transition into non-existent content).
function PlanStages({
  onStageClick,
}: {
  onStageClick?: (canvas: PhaseKey, subStep: string) => void;
}) {
  return (
    <div className="space-y-2">
      <SectionLabel>The four beats of your plan</SectionLabel>
      <div className="grid grid-cols-4 gap-3">
        {STEP_ORDER.map((step, i) => {
          const meta = STEP_LABEL.plan[step];
          const title = meta.title || (step === "gather" ? "Pulled in" : step);
          const description = meta.description || "Pulls in your agreed analysis.";
          const handleClick = onStageClick ? () => onStageClick("plan", step) : undefined;
          return (
            <StageCard
              key={step}
              badge={String(i + 1)}
              title={title}
              description={description}
              status={step === "live" ? "Pending your sign-off" : "Opens after analysis is agreed"}
              relation="future"
              onClick={handleClick}
            />
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground/70 pt-2 italic">
        Your plan opens after we agree the analysis. We'll work out what to do — together.
      </p>
    </div>
  );
}

function ProgressStages({
  onStageClick,
}: {
  onStageClick?: (canvas: PhaseKey, subStep: string) => void;
}) {
  return (
    <div className="space-y-2">
      <SectionLabel>The four beats of your progress</SectionLabel>
      <div className="grid grid-cols-4 gap-3">
        {STEP_ORDER.map((step, i) => {
          const meta = STEP_LABEL.progress[step];
          const title = meta.title || step;
          const description = meta.description || "—";
          const handleClick = onStageClick ? () => onStageClick("progress", step) : undefined;
          return (
            <StageCard
              key={step}
              badge={String(i + 1)}
              title={title}
              description={description}
              status="Wakes up once you have a plan in motion"
              relation="future"
              onClick={handleClick}
            />
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground/70 pt-2 italic">
        Progress is the long game — it lives quietly until your plan is running, then catches the deltas every month.
      </p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{children}</div>
  );
}
