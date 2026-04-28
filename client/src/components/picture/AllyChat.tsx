import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateConversation, invalidateAnalysisConversation } from "@/lib/invalidation";
import { useAuth } from "@/hooks/useAuth";
import { LOADER_COPY, type Phase } from "@/lib/uiCopy";
import type { PhaseKey } from "@/lib/canvasCopy";
import { Button } from "@/components/ui/button";
import { MessageList } from "@/components/conversation/MessageList";
import { ConversationInput } from "@/components/conversation/ConversationInput";
import type { Conversation, ConversationMessage } from "@shared/schema";

type ConversationResponse = {
  conversation: Conversation | null;
  messages: ConversationMessage[];
};

// Endpoint pack per canvas. Chat UI is canvas-shape-agnostic — each canvas supplies
// its own conversation endpoints. Add a new entry here for a future canvas (plan,
// progress) without touching the chat rendering logic.
const SOURCES: Record<PhaseKey, {
  queryKey: string;
  startPath: string;
  messagePath: string;
  invalidate: (qc: typeof queryClient) => void;
}> = {
  picture: {
    queryKey: "/api/qa/conversation",
    startPath: "/api/qa/start",
    messagePath: "/api/qa/message",
    invalidate: invalidateConversation,
  },
  analysis: {
    queryKey: "/api/analysis-conversation",
    startPath: "/api/analysis-conversation/start",
    messagePath: "/api/analysis-conversation/message",
    invalidate: invalidateAnalysisConversation,
  },
  // Plan and progress aren't scoped yet; fall back to picture endpoints so a
  // misconfigured canvas doesn't crash the UI.
  plan: {
    queryKey: "/api/qa/conversation",
    startPath: "/api/qa/start",
    messagePath: "/api/qa/message",
    invalidate: invalidateConversation,
  },
  progress: {
    queryKey: "/api/qa/conversation",
    startPath: "/api/qa/start",
    messagePath: "/api/qa/message",
    invalidate: invalidateConversation,
  },
};

// Chat body for Ally's pane. No drawer, no modal — just the message stream + input.
// Auto-starts the conversation the first time it mounts with no existing conversation,
// unless `canStart` is false (e.g. Phase 2 while the draft is still thinking —
// the server would reject /start until the draft is ready).
// Phase-aware: the endpoints switch based on which canvas the user is currently on.
export function AllyChat({
  canvas = "picture",
  canStart = true,
}: {
  canvas?: PhaseKey;
  canStart?: boolean;
}) {
  const { user } = useAuth();
  const source = SOURCES[canvas];
  const phase: Phase = canvas === "analysis"
    ? "analysis_refining"
    : user?.buildCompletedAt
      ? "first_take_gaps"
      : "bring_it_in";
  const loader = LOADER_COPY[phase];

  const q = useQuery<ConversationResponse>({
    queryKey: [source.queryKey],
  });

  const start = useMutation({
    mutationFn: () => apiRequest("POST", source.startPath),
    onSuccess: () => source.invalidate(queryClient),
  });

  const send = useMutation({
    mutationFn: (content: string) => apiRequest("POST", source.messagePath, { content }),
    onSuccess: () => source.invalidate(queryClient),
  });

  useEffect(() => {
    if (
      canStart &&
      q.data &&
      !q.data.conversation &&
      !start.isPending &&
      !start.isSuccess &&
      !start.isError
    ) {
      start.mutate();
    }
  }, [canStart, q.data, start]);

  const conversation = q.data?.conversation ?? null;
  const messages = q.data?.messages ?? [];
  const isComplete = conversation?.status === "complete";
  const settling = q.isLoading || (!conversation && (start.isPending || (!start.isSuccess && !start.isError)));
  const startError = start.error instanceof Error ? start.error.message : null;
  const sendError = send.error instanceof Error ? send.error.message : null;
  const queryError = q.error instanceof Error ? q.error.message : null;
  const inputLocked = start.isPending || send.isPending || !conversation || isComplete;

  return (
    <div className="flex flex-col h-full min-h-0 bg-muted">
      <main className="flex-1 overflow-y-auto px-6 py-8 min-h-0 shadow-[inset_0_0_0_4px_var(--color-muted)]">
        {settling ? (
          <div className="flex flex-col items-start gap-2">
            <div className="font-serif text-xl text-foreground/80">{loader.title}</div>
            <div className="text-sm text-muted-foreground">{loader.sub}</div>
          </div>
        ) : queryError ? (
          <ErrorBlock title="Couldn't load the conversation." detail={queryError} onRetry={() => q.refetch()} />
        ) : (
          <div className="space-y-6">
            <MessageList messages={messages} awaitingReply={send.isPending} />
            {startError && (
              <ErrorBlock
                title="Ally couldn't open the conversation."
                detail={startError}
                onRetry={() => {
                  start.reset();
                  start.mutate();
                }}
              />
            )}
            {sendError && (
              <ErrorBlock
                title="Ally didn't reply."
                detail={sendError}
                onRetry={() => send.reset()}
              />
            )}
            {isComplete && (
              <div className="text-sm italic text-muted-foreground">Conversation complete.</div>
            )}
          </div>
        )}
      </main>

      <ConversationInput onSend={(content) => send.mutate(content)} disabled={inputLocked} />
    </div>
  );
}

function ErrorBlock({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
      <div className="text-sm font-medium">{title}</div>
      <pre className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{detail}</pre>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
