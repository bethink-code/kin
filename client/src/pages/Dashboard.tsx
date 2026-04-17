import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useStatementQueue } from "@/hooks/useStatementQueue";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs } from "@/components/Tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateAuth } from "@/lib/invalidation";
import { StatementUpload } from "@/components/StatementUpload";
import { StoryRotator } from "@/components/StoryRotator";
import { ProgressRing } from "@/components/ProgressRing";
import { AnalysisView } from "@/components/AnalysisView";
import { formatDate, formatMoney } from "@/lib/formatters";
import type { Statement } from "@shared/schema";

const TARGET_STATEMENTS = 12;

type TabKey = "story" | "statements" | "upload";

export default function Dashboard() {
  const { user } = useAuth();
  const statementsQ = useQuery<Statement[]>({ queryKey: ["/api/statements"] });
  const queueState = useStatementQueue();

  const statements = statementsQ.data ?? [];
  const hasAny = statements.length > 0;
  const [tab, setTab] = useState<TabKey>(hasAny ? "statements" : "upload");

  const completeBuild = useMutation({
    mutationFn: () => apiRequest("POST", "/api/user/build-complete"),
    onSuccess: () => invalidateAuth(queryClient),
  });

  const reopenBuild = useMutation({
    mutationFn: () => apiRequest("POST", "/api/user/build-reopen"),
    onSuccess: () => invalidateAuth(queryClient),
  });

  if (!user) return null;

  async function logout() {
    await apiRequest("POST", "/auth/logout");
    window.location.href = "/";
  }

  const firstName = user.firstName ?? user.email.split("@")[0];
  const extractedCount = statements.filter((s) => s.status === "extracted").length;
  const progress = Math.min(extractedCount / TARGET_STATEMENTS, 1);
  const photoSrc = user.photoDataUrl ?? user.profileImageUrl;
  const initial = (user.firstName ?? user.email).slice(0, 1).toUpperCase();
  const buildDone = !!user.buildCompletedAt;

  const subcopy = buildDone
    ? "You've given us enough. The next part — understanding what it means — is coming."
    : extractedCount === 0
      ? "This is the beginning of your story. Every statement you add builds the picture."
      : extractedCount < TARGET_STATEMENTS
        ? `${extractedCount} of ${TARGET_STATEMENTS} statements so far. The more you add, the clearer it gets.`
        : "You've given us a full year. Your picture is ready.";

  return (
    <div className="min-h-screen">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <span className="font-serif text-2xl">Kin</span>
        <div className="flex items-center gap-3">
          {user.isAdmin && (
            <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
              Admin
            </Link>
          )}
          <Button variant="ghost" size="sm" onClick={logout}>
            Sign out
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 space-y-10">
        <section className="flex flex-col items-center text-center space-y-6">
          <ProgressRing progress={buildDone ? 1 : progress} size={240}>
            {photoSrc ? (
              <img src={photoSrc} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center font-serif text-6xl text-muted-foreground">
                {initial}
              </div>
            )}
          </ProgressRing>

          {!buildDone && (
            <>
              <div className="space-y-2">
                <h1 className="font-serif text-4xl">Welcome, {firstName}.</h1>
                <p className="text-muted-foreground max-w-md">{subcopy}</p>
              </div>

              {extractedCount > 0 && (
                <Button
                  variant="outline"
                  onClick={() => completeBuild.mutate()}
                  disabled={completeBuild.isPending || queueState.anyBusy}
                >
                  {completeBuild.isPending ? "Saving…" : "I'm done — show me my picture"}
                </Button>
              )}
            </>
          )}
        </section>

        {buildDone ? (
          <AnalysisView onGoBack={() => reopenBuild.mutate()} />
        ) : (
          <div>
            <Tabs<TabKey>
              tabs={[
                { key: "story", label: "Stories" },
                { key: "upload", label: "Add statements" },
                { key: "statements", label: "Your statements", count: statements.length || null },
              ]}
              active={tab}
              onChange={setTab}
              align="center"
            />
            <div className="mt-6">
              {tab === "story" && (
                <StoryRotator
                  label={queueState.anyBusy ? "While we read · a short story" : "A short story"}
                />
              )}
              {tab === "statements" &&
                (hasAny ? (
                  <div className="space-y-4">
                    <StatementsSummary statements={statements} />
                    <StatementsPanel statements={statements} />
                  </div>
                ) : (
                  <EmptyStatementsPanel onGoToUpload={() => setTab("upload")} />
                ))}
              {tab === "upload" && <UploadPanel queueState={queueState} />}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function UploadPanel({ queueState }: { queueState: ReturnType<typeof useStatementQueue> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add statements</CardTitle>
        <CardDescription>
          Drop PDFs here — up to 12 months. We'll read and structure them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <StatementUpload
          queue={queueState.queue}
          anyBusy={queueState.anyBusy}
          rejectWarning={queueState.rejectWarning}
          onStageFiles={queueState.stageFiles}
          onClearFinished={queueState.clearFinished}
        />
      </CardContent>
    </Card>
  );
}

function EmptyStatementsPanel({ onGoToUpload }: { onGoToUpload: () => void }) {
  return (
    <Card>
      <CardContent className="pt-6 text-center space-y-3">
        <p className="text-muted-foreground">Nothing here yet — this is where your statements will live once we've read them.</p>
        <Button onClick={onGoToUpload}>Add your first one</Button>
      </CardContent>
    </Card>
  );
}

function StatementsSummary({ statements }: { statements: Statement[] }) {
  const summary = useMemo(() => {
    const extracted = statements.filter((s) => s.status === "extracted");
    let totalTransactions = 0;
    let earliest: string | null = null;
    let latest: string | null = null;
    const banks = new Set<string>();
    for (const s of extracted) {
      const r = s.extractionResult as ExtractionShape | null;
      if (!r) continue;
      totalTransactions += r.transactions?.length ?? 0;
      if (r.bankName) banks.add(r.bankName);
      if (r.statementPeriodStart && (!earliest || r.statementPeriodStart < earliest)) earliest = r.statementPeriodStart;
      if (r.statementPeriodEnd && (!latest || r.statementPeriodEnd > latest)) latest = r.statementPeriodEnd;
    }
    return { count: extracted.length, totalTransactions, earliest, latest, banks: Array.from(banks) };
  }, [statements]);

  if (summary.count === 0) return null;

  const range =
    summary.earliest && summary.latest ? `${summary.earliest} → ${summary.latest}` : null;

  return (
    <div className="rounded-md border border-border bg-card/60 px-4 py-3 text-sm text-muted-foreground">
      {summary.count} statement{summary.count === 1 ? "" : "s"}
      {range && <> · {range}</>}
      {summary.totalTransactions > 0 && <> · {summary.totalTransactions} transactions</>}
      {summary.banks.length > 0 && <> · {summary.banks.join(", ")}</>}
    </div>
  );
}

function StatementsPanel({ statements }: { statements: Statement[] }) {
  return (
    <div className="rounded-lg border border-border bg-card divide-y divide-border">
      {statements.map((s) => (
        <StatementRow key={s.id} statement={s} />
      ))}
    </div>
  );
}

function StatementRow({ statement }: { statement: Statement }) {
  const [open, setOpen] = useState(false);
  const result = statement.extractionResult as ExtractionShape | null;

  const summary = useMemo(() => {
    if (!result) return null;
    const txCount = result.transactions?.length ?? 0;
    const debits = result.transactions?.filter((t) => t.direction === "debit").length ?? 0;
    const credits = result.transactions?.filter((t) => t.direction === "credit").length ?? 0;
    return { txCount, debits, credits };
  }, [result]);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/40"
      >
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{statement.filename}</div>
          <div className="text-xs text-muted-foreground">
            {formatDate(statement.createdAt)}
            {result?.bankName && <> · {result.bankName}</>}
            {result?.statementPeriodStart && result?.statementPeriodEnd && (
              <> · {result.statementPeriodStart} → {result.statementPeriodEnd}</>
            )}
            {summary && <> · {summary.txCount} transactions</>}
          </div>
        </div>
        <StatusBadge status={statement.status} />
      </button>

      {open && result && (
        <div className="border-t border-border bg-muted/20 px-4 py-4 space-y-4 text-sm">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Account holder" value={result.accountHolderName ?? "—"} />
            <Field label="Account" value={result.accountNumberMasked ?? "—"} />
            <Field label="Opening" value={formatBalance(result.openingBalance)} />
            <Field label="Closing" value={formatBalance(result.closingBalance)} />
          </div>
          {result.notes && (
            <div className="rounded-md border border-amber-400/40 bg-amber-50 p-3 text-xs text-amber-900">
              {result.notes}
            </div>
          )}
          {result.transactions && result.transactions.length > 0 && (
            <div>
              <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                First 10 transactions
              </div>
              <div className="divide-y divide-border rounded-md border border-border bg-card">
                {result.transactions.slice(0, 10).map((t, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate">{t.description}</div>
                      <div className="text-xs text-muted-foreground">{t.date}</div>
                    </div>
                    <div className={t.direction === "credit" ? "text-primary" : "text-foreground"}>
                      {t.direction === "debit" ? "−" : "+"}
                      {formatMoney(t.amount)}
                    </div>
                  </div>
                ))}
              </div>
              {result.transactions.length > 10 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  …and {result.transactions.length - 10} more.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    extracting: "text-muted-foreground",
    extracted: "text-primary",
    failed: "text-destructive",
  };
  return <span className={`ml-3 text-xs ${map[status] ?? "text-muted-foreground"}`}>{status}</span>;
}

function formatBalance(n: number | null | undefined): string {
  if (n == null) return "—";
  return formatMoney(n);
}

type ExtractionShape = {
  accountHolderName: string | null;
  accountNumberMasked: string | null;
  bankName: string | null;
  statementPeriodStart: string | null;
  statementPeriodEnd: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  transactions: { date: string; description: string; amount: number; direction: "debit" | "credit" }[];
  notes?: string;
};
