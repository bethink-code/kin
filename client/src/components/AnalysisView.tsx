import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { formatMoney, formatPercent } from "@/lib/formatters";
import { StoryRotator } from "@/components/StoryRotator";
import { useAuth } from "@/hooks/useAuth";
import type { Analysis } from "@shared/schema";

type AnalysisResult = {
  lifeSnapshot: string;
  income: {
    summary: string;
    monthlyAverage: number | null;
    regularity: "steady" | "variable" | "irregular";
    sources: { description: string; monthlyAverage: number; frequency: string }[];
  };
  spending: {
    summary: string;
    monthlyAverage: number | null;
    byCategory: { category: string; monthlyAverage: number; percentOfSpend: number; examples: string[] }[];
  };
  savings: {
    summary: string;
    monthlyAverageSaved: number | null;
    observation: string;
  };
  recurring: { description: string; amount: number; frequency: string; category: string }[];
  gaps: { key: string; label: string; whyItMatters: string; questionToAsk: string }[];
  notes?: string;
};

export function AnalysisView({ onGoBack }: { onGoBack?: () => void }) {
  const { user } = useAuth();
  const firstName = user?.firstName ?? user?.email.split("@")[0] ?? "";
  const q = useQuery<Analysis | null>({ queryKey: ["/api/analysis/latest"] });
  const run = useMutation({
    mutationFn: () => apiRequest("POST", "/api/analysis/run"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/analysis/latest"] }),
  });

  if (q.isLoading) return null;

  const latest = q.data;
  const hasDoneResult = latest?.status === "done" && latest.result;

  // If a previous analysis is done, always show it (even if the user is re-running).
  if (hasDoneResult) {
    const result = latest!.result as AnalysisResult;
    return (
      <AnalysisContent
        result={result}
        onRerun={() => run.mutate()}
        rerunning={run.isPending}
        onGoBack={onGoBack}
      />
    );
  }

  // Analysing in progress (either via mutation, or a prior server-side run that hasn't finished).
  if (latest?.status === "analysing" || run.isPending) {
    return (
      <div className="flex flex-col items-center justify-center space-y-6 text-center py-8">
        <div>
          <h2 className="font-serif text-4xl">
            {firstName ? `Reading your year, ${firstName}…` : "Reading across everything you've shared…"}
          </h2>
          <p className="mt-3 text-muted-foreground">This takes a minute.</p>
        </div>
        <div className="w-full max-w-2xl pt-4">
          <StoryRotator label="While I read · a short story" />
        </div>
      </div>
    );
  }

  // No analysis yet, or last attempt failed.
  const hasFailure = latest?.status === "failed";
  return (
    <div className="flex flex-col items-center justify-center space-y-6 text-center py-8">
      <div>
        <h2 className="font-serif text-4xl">
          {firstName ? `${firstName}, let me look at what you've shared.` : "Let me look at what you've shared."}
        </h2>
        <p className="mt-3 text-muted-foreground max-w-md mx-auto">
          I'll read across all your statements and write back with the patterns I can see — and the things I can't.
        </p>
      </div>
      {hasFailure && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          Last attempt failed: {latest!.errorMessage ?? "unknown error"}
        </div>
      )}
      <div className="flex flex-col items-center gap-2">
        <Button onClick={() => run.mutate()}>Look at my picture</Button>
        {onGoBack && (
          <Button variant="ghost" size="sm" onClick={onGoBack}>
            Go back and add more
          </Button>
        )}
      </div>
    </div>
  );
}

function AnalysisContent({
  result,
  onRerun,
  rerunning,
  onGoBack,
}: {
  result: AnalysisResult;
  onRerun: () => void;
  rerunning: boolean;
  onGoBack?: () => void;
}) {
  return (
    <article className="space-y-12">
      <section>
        <h2 className="font-serif text-3xl">Your money, as I see it.</h2>
        <p className="mt-4 text-lg leading-relaxed text-foreground/90">{result.lifeSnapshot}</p>
      </section>

      <Section title="Your income">
        <p className="leading-relaxed">{result.income.summary}</p>
        {result.income.monthlyAverage != null && (
          <div className="pt-4">
            <BigNumber label="About what comes in, on average" value={formatMoney(result.income.monthlyAverage)} />
          </div>
        )}
        {result.income.sources.length > 1 && (
          <div className="pt-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Sources</div>
            {result.income.sources.map((s, i) => (
              <div key={i} className="flex justify-between py-2 border-b border-border last:border-0">
                <div>
                  <div>{s.description}</div>
                  <div className="text-xs text-muted-foreground">{s.frequency}</div>
                </div>
                <div>{formatMoney(s.monthlyAverage)}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="How your money moves">
        <p className="leading-relaxed">{result.spending.summary}</p>
        {result.spending.monthlyAverage != null && (
          <div className="pt-4">
            <BigNumber label="About what goes out, on average" value={formatMoney(result.spending.monthlyAverage)} />
          </div>
        )}
        <div className="pt-6 space-y-4">
          {result.spending.byCategory.map((c) => (
            <div key={c.category} className="border-b border-border pb-3 last:border-0">
              <div className="flex justify-baseline justify-between">
                <div>
                  <div className="text-lg">{c.category}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{formatPercent(c.percentOfSpend)} of your spend</div>
                </div>
                <div className="text-lg font-serif">{formatMoney(c.monthlyAverage)}</div>
              </div>
              {c.examples.length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  e.g. {c.examples.slice(0, 4).join(" · ")}
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="What's being set aside">
        <p className="leading-relaxed">{result.savings.summary}</p>
        {result.savings.monthlyAverageSaved != null && (
          <div className="pt-4">
            <BigNumber
              label={result.savings.monthlyAverageSaved >= 0 ? "About what's being saved, on average" : "What's going down, on average"}
              value={formatMoney(Math.abs(result.savings.monthlyAverageSaved))}
            />
          </div>
        )}
        <p className="pt-4 text-sm italic text-muted-foreground">{result.savings.observation}</p>
      </Section>

      {result.recurring.length > 0 && (
        <Section title="What's going out every month, like clockwork">
          <div className="divide-y divide-border">
            {result.recurring.map((r, i) => (
              <div key={i} className="flex justify-between py-3">
                <div>
                  <div>{r.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.frequency} · {r.category}
                  </div>
                </div>
                <div>{formatMoney(r.amount)}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="What I can't see from here">
        <p className="leading-relaxed">
          Your statements show me the money that moves through this account. They don't show me everything. Here's what's missing — and why it matters.
        </p>
        <div className="pt-6 space-y-5">
          {result.gaps.map((g) => (
            <div key={g.key} className="border-l-2 border-accent/60 pl-4">
              <div className="font-serif text-xl">{g.label}</div>
              <p className="mt-1 text-sm text-muted-foreground">{g.whyItMatters}</p>
              <p className="mt-2 italic text-foreground/80">"{g.questionToAsk}"</p>
            </div>
          ))}
        </div>
        <div className="pt-6">
          <Button disabled>Let's fill these in (coming soon)</Button>
        </div>
      </Section>

      {result.notes && (
        <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          <span className="font-medium">Note:</span> {result.notes}
        </div>
      )}

      <div className="pt-8 border-t border-border flex justify-between items-center">
        {onGoBack ? (
          <Button variant="ghost" size="sm" onClick={onGoBack}>
            Go back and add more
          </Button>
        ) : <span />}
        <Button variant="ghost" size="sm" onClick={onRerun} disabled={rerunning}>
          {rerunning ? "Reading again…" : "Run the analysis again"}
        </Button>
      </div>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-serif text-2xl mb-4">{title}</h3>
      <div className="space-y-2 text-foreground/90">{children}</div>
    </section>
  );
}

function BigNumber({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-serif text-5xl text-accent mt-1">{value}</div>
    </div>
  );
}
