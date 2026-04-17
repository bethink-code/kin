import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Tabs } from "@/components/Tabs";
import { Stat } from "@/components/Stat";
import { LastUpdated } from "@/components/LastUpdated";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateAdmin } from "@/lib/invalidation";
import { formatDate } from "@/lib/formatters";
import { PromptEditor } from "@/components/PromptEditor";
import type { User, InvitedUser, AccessRequest, AuditLog } from "@shared/schema";

type TabKey = "overview" | "users" | "invites" | "requests" | "prompts" | "audit";

export default function Admin() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>("overview");

  if (!user?.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Not authorised.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-serif text-2xl">
            Kin
          </Link>
          <span className="text-sm text-muted-foreground">/ Admin</span>
        </div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          Back to app
        </Link>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <Tabs<TabKey>
          tabs={[
            { key: "overview", label: "Overview" },
            { key: "users", label: "Users" },
            { key: "invites", label: "Invites" },
            { key: "requests", label: "Access requests" },
            { key: "prompts", label: "Prompts" },
            { key: "audit", label: "Audit log" },
          ]}
          active={tab}
          onChange={setTab}
        />

        <div className="mt-8">
          {tab === "overview" && <Overview />}
          {tab === "users" && <Users />}
          {tab === "invites" && <Invites />}
          {tab === "requests" && <AccessRequests />}
          {tab === "prompts" && <PromptEditor />}
          {tab === "audit" && <AuditView />}
        </div>
      </div>
    </div>
  );
}

function Overview() {
  const q = useQuery<{ userCount: number; adminCount: number; inviteCount: number; pendingRequests: number }>({
    queryKey: ["/api/admin/security-overview"],
  });
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <LastUpdated dataUpdatedAt={q.dataUpdatedAt} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><Stat label="Users" value={q.data?.userCount ?? "—"} /></CardContent></Card>
        <Card><CardContent className="pt-6"><Stat label="Admins" value={q.data?.adminCount ?? "—"} /></CardContent></Card>
        <Card><CardContent className="pt-6"><Stat label="Invites" value={q.data?.inviteCount ?? "—"} /></CardContent></Card>
        <Card><CardContent className="pt-6"><Stat label="Pending requests" value={q.data?.pendingRequests ?? "—"} /></CardContent></Card>
      </div>
    </div>
  );
}

function Users() {
  const q = useQuery<User[]>({ queryKey: ["/api/admin/users"] });
  const toggle = useMutation({
    mutationFn: ({ id, isAdmin }: { id: string; isAdmin: boolean }) =>
      apiRequest("PATCH", `/api/admin/users/${id}/admin`, { isAdmin }),
    onSuccess: () => invalidateAdmin(queryClient),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <LastUpdated dataUpdatedAt={q.dataUpdatedAt} />
      </div>
      <Card>
        <CardContent className="pt-6 divide-y divide-border">
          {q.data?.map((u) => (
            <div key={u.id} className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium">{u.firstName} {u.lastName}</div>
                <div className="text-sm text-muted-foreground">{u.email}</div>
              </div>
              <Button
                variant={u.isAdmin ? "destructive" : "outline"}
                size="sm"
                onClick={() => toggle.mutate({ id: u.id, isAdmin: !u.isAdmin })}
              >
                {u.isAdmin ? "Revoke admin" : "Make admin"}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Invites() {
  const q = useQuery<InvitedUser[]>({ queryKey: ["/api/admin/invites"] });
  const [email, setEmail] = useState("");
  const [warning, setWarning] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: (email: string) => apiRequest("POST", "/api/admin/invites", { email }),
    onSuccess: () => { invalidateAdmin(queryClient); setEmail(""); setWarning(null); },
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/invites/${id}`),
    onSuccess: () => invalidateAdmin(queryClient),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) {
      setWarning("Please enter a valid email address.");
      return;
    }
    add.mutate(email.trim().toLowerCase());
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="flex gap-2">
        <Input placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit">Invite</Button>
      </form>
      {warning && (
        <div className="rounded-md border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-900">
          {warning}
        </div>
      )}
      <div className="flex justify-end">
        <LastUpdated dataUpdatedAt={q.dataUpdatedAt} />
      </div>
      <Card>
        <CardContent className="pt-6 divide-y divide-border">
          {q.data?.map((i) => (
            <div key={i.id} className="flex items-center justify-between py-3">
              <div>
                <div>{i.email}</div>
                <div className="text-xs text-muted-foreground">Added {formatDate(i.createdAt)}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => remove.mutate(i.id)}>
                Remove
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function AccessRequests() {
  const q = useQuery<AccessRequest[]>({ queryKey: ["/api/admin/access-requests"] });
  const decide = useMutation({
    mutationFn: ({ id, status }: { id: number; status: "approved" | "declined" }) =>
      apiRequest("PATCH", `/api/admin/access-requests/${id}`, { status }),
    onSuccess: () => invalidateAdmin(queryClient),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <LastUpdated dataUpdatedAt={q.dataUpdatedAt} />
      </div>
      <Card>
        <CardContent className="pt-6 divide-y divide-border">
          {q.data?.length === 0 && <div className="py-6 text-muted-foreground">No access requests yet.</div>}
          {q.data?.map((r) => (
            <div key={r.id} className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium">{r.name}</div>
                <div className="text-sm text-muted-foreground">{r.email}{r.cell ? ` · ${r.cell}` : ""}</div>
                <div className="text-xs text-muted-foreground">Requested {formatDate(r.createdAt)}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">{r.status}</span>
                {r.status === "pending" && (
                  <>
                    <Button size="sm" onClick={() => decide.mutate({ id: r.id, status: "approved" })}>
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: r.id, status: "declined" })}>
                      Decline
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function AuditView() {
  const q = useQuery<AuditLog[]>({ queryKey: ["/api/admin/audit-logs"] });
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <LastUpdated dataUpdatedAt={q.dataUpdatedAt} />
      </div>
      <Card>
        <CardContent className="pt-6 divide-y divide-border">
          {q.data?.map((log) => (
            <div key={log.id} className="py-3">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{log.action}</span>
                <span className="text-muted-foreground">{formatDate(log.createdAt)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {log.userId ?? "anon"} · {log.outcome} {log.ipAddress ? `· ${log.ipAddress}` : ""}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
