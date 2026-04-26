import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PaneHeader } from "@/components/layout/PaneHeader";
import { AllyAvatar } from "@/components/layout/Avatars";
import { AllyChat } from "./AllyChat";
import { AllyQuips } from "./AllyQuips";
import { ConversationInput } from "@/components/conversation/ConversationInput";
import { ExplainPane } from "@/components/analysis/ExplainPane";
import { NotesPane } from "@/components/analysis/NotesPane";
import type { CanvasKey } from "@/lib/canvasCopy";
import type { AnalysisDraft as AnalysisDraftRow } from "@shared/schema";

type Mode = "chat" | "explain" | "notes";

const stateLineByMode: Record<Mode, { label: string; tone: string }> = {
  chat: { label: "in chat", tone: "text-emerald-700" },
  explain: { label: "explaining", tone: "text-amber-700" },
  notes: { label: "notes", tone: "text-purple-700" },
};

// Ally's pane — right side of the two-pane layout. Always present, structurally
// identical across sub-steps. Three modes: chat / explain / notes.
//
// Mode switches come from:
//   - the pill switcher in the header
//   - external annotation clicks via window event "ally-pane-mode" with
//     { detail: { mode, anchorId } } — fired from AnnotatedText on the left.
export function AllyPane({ canvas = "picture" }: { canvas?: CanvasKey }) {
  const [mode, setMode] = useState<Mode>("chat");
  const [anchorId, setAnchorId] = useState<string | null>(null);

  // Canvas 2 chat auto-starts only once the draft is ready. During the thinking
  // phase we render a quiet holding-space message instead of trying to /start
  // (which would error with no_ready_draft).
  const draftQ = useQuery<AnalysisDraftRow | null>({
    queryKey: ["/api/analysis-draft/current"],
    enabled: canvas === "analysis",
  });
  const draftStatus = draftQ.data?.status ?? null;
  const chatReady =
    canvas !== "analysis" || (draftStatus === "ready" || draftStatus === "agreed");

  const stateLine =
    mode === "chat" && canvas === "analysis" && !chatReady
      ? { label: "writing", tone: "text-amber-700" }
      : stateLineByMode[mode];

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ mode: Mode; anchorId?: string }>).detail;
      if (!detail) return;
      if (detail.mode === "explain" || detail.mode === "notes" || detail.mode === "chat") {
        setMode(detail.mode);
        setAnchorId(detail.anchorId ?? null);
      }
    }
    window.addEventListener("ally-pane-mode", handler);
    return () => window.removeEventListener("ally-pane-mode", handler);
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      <PaneHeader
        avatar={<AllyAvatar />}
        name="Ally"
        statusLine={<span className={stateLine.tone}>{stateLine.label}</span>}
        right={<ModeSwitcher mode={mode} onChange={(m) => { setMode(m); setAnchorId(null); }} />}
      />
      <div className="flex-1 min-h-0 flex flex-col">
        {mode === "chat" && canvas === "analysis" && !chatReady && (
          <>
            <div className="flex-1 min-h-0">
              <ChatHoldingSpace />
            </div>
            {/* Bar placeholder so the dark footer spans across both panes during thinking. */}
            <ConversationInput onSend={() => {}} disabled />
          </>
        )}
        {mode === "chat" && chatReady && <AllyChat canvas={canvas} canStart={chatReady} />}
        {mode === "explain" && (
          <ExplainPane
            canvas={canvas}
            anchorId={anchorId}
            onBack={() => setMode("chat")}
          />
        )}
        {mode === "notes" && (
          <NotesPane
            highlightedAnchorId={anchorId}
            onBack={() => setMode("chat")}
          />
        )}
      </div>
    </div>
  );
}

// Shown during Canvas 2 `thinking` — Ally holds the space while the draft is
// generating. Visibly active (pulsing dots) and voiced (rotating quips) so the
// person feels her presence, not just a static message.
function ChatHoldingSpace() {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-6">
      <ThinkingDots />
      <AllyQuips />
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        Ally · writing
      </p>
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5" aria-label="Ally is thinking">
      <span className="h-2 w-2 rounded-full bg-accent/70 animate-pulse [animation-delay:0ms]" />
      <span className="h-2 w-2 rounded-full bg-accent/70 animate-pulse [animation-delay:200ms]" />
      <span className="h-2 w-2 rounded-full bg-accent/70 animate-pulse [animation-delay:400ms]" />
    </div>
  );
}

function ModeSwitcher({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-background/80 p-1 text-xs">
      <ModePill label="chat" active={mode === "chat"} onClick={() => onChange("chat")} />
      <ModePill label="explain" active={mode === "explain"} onClick={() => onChange("explain")} />
      <ModePill label="notes" active={mode === "notes"} onClick={() => onChange("notes")} />
    </div>
  );
}

function ModePill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded transition-colors ${
        active
          ? "bg-foreground text-background font-medium"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
