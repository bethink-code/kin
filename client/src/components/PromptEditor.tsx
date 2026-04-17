import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidatePrompts } from "@/lib/invalidation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/formatters";
import type { SystemPrompt } from "@shared/schema";

export function PromptEditor() {
  const promptsQuery = useQuery<SystemPrompt[]>({ queryKey: ["/api/admin/prompts"] });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedKey && promptsQuery.data && promptsQuery.data.length > 0) {
      setSelectedKey(promptsQuery.data[0].promptKey);
    }
  }, [promptsQuery.data, selectedKey]);

  if (promptsQuery.isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!promptsQuery.data || promptsQuery.data.length === 0) {
    return <div className="text-muted-foreground">No prompts seeded yet.</div>;
  }

  const selected = promptsQuery.data.find((p) => p.promptKey === selectedKey) ?? promptsQuery.data[0];

  return (
    <div className="flex gap-6">
      <aside className="w-56 space-y-1">
        {promptsQuery.data.map((p) => (
          <button
            key={p.promptKey}
            onClick={() => setSelectedKey(p.promptKey)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm ${
              p.promptKey === selected.promptKey ? "bg-muted font-medium" : "hover:bg-muted"
            }`}
          >
            <div>{p.label}</div>
            <div className="text-xs text-muted-foreground">v{p.version} · {p.model}</div>
          </button>
        ))}
      </aside>

      <div className="flex-1">
        <PromptForm key={selected.id} prompt={selected} />
      </div>
    </div>
  );
}

function PromptForm({ prompt }: { prompt: SystemPrompt }) {
  const [label, setLabel] = useState(prompt.label);
  const [description, setDescription] = useState(prompt.description ?? "");
  const [model, setModel] = useState(prompt.model);
  const [content, setContent] = useState(prompt.content);
  const [warning, setWarning] = useState<string | null>(null);

  const versionsQuery = useQuery<SystemPrompt[]>({
    queryKey: [`/api/admin/prompts/${prompt.promptKey}/versions`],
  });

  const save = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/admin/prompts", {
        promptKey: prompt.promptKey,
        label,
        description,
        model,
        content,
      }),
    onSuccess: () => {
      invalidatePrompts(queryClient);
      queryClient.invalidateQueries({ queryKey: [`/api/admin/prompts/${prompt.promptKey}/versions`] });
      setWarning(null);
    },
  });

  const rollback = useMutation({
    mutationFn: (versionId: number) =>
      apiRequest("POST", `/api/admin/prompts/${prompt.promptKey}/rollback/${versionId}`),
    onSuccess: () => {
      invalidatePrompts(queryClient);
      queryClient.invalidateQueries({ queryKey: [`/api/admin/prompts/${prompt.promptKey}/versions`] });
    },
  });

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) {
      setWarning("Prompt content can't be empty.");
      return;
    }
    if (content === prompt.content && label === prompt.label && model === prompt.model && description === (prompt.description ?? "")) {
      setWarning("Nothing changed — edit something before saving a new version.");
      return;
    }
    save.mutate();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSave} className="space-y-3">
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Label</label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Description</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Model</label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Prompt content</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={16}
            className="w-full rounded-md border border-input bg-card p-3 text-sm font-mono"
          />
        </div>
        {warning && (
          <div className="rounded-md border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-900">{warning}</div>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save as new version"}
          </Button>
          <span className="text-sm text-muted-foreground self-center">
            Currently active: v{prompt.version}
          </span>
        </div>
      </form>

      <Card>
        <CardContent className="pt-6">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Version history</div>
          <div className="divide-y divide-border">
            {versionsQuery.data?.map((v) => (
              <div key={v.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm font-medium">
                    v{v.version} {v.isActive && <span className="text-primary ml-1">(active)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(v.createdAt)} · {v.model}
                  </div>
                </div>
                {!v.isActive && (
                  <Button size="sm" variant="outline" onClick={() => rollback.mutate(v.id)}>
                    Roll back to v{v.version}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
