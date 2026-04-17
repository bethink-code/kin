import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";

export default function Landing() {
  const [requestMode, setRequestMode] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", cell: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urlError = new URLSearchParams(window.location.search).get("error");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim() || !form.email.trim()) {
      setError("Please enter your name and email.");
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/request-access", form);
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center space-y-3">
          <h1 className="text-5xl">Kin</h1>
          <p className="text-muted-foreground">A warm, honest mirror for your money.</p>
        </div>

        {urlError === "not_invited" && (
          <div className="rounded-md border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-900">
            You don't have access yet. Request an invitation below.
          </div>
        )}

        {!requestMode ? (
          <div className="space-y-4">
            <a
              href="/auth/google"
              className="block w-full rounded-md bg-primary px-4 py-3 text-center text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Sign in with Google
            </a>
            <button
              onClick={() => setRequestMode(true)}
              className="w-full text-sm text-muted-foreground hover:text-foreground"
            >
              Don't have an invitation? Request access
            </button>
          </div>
        ) : submitted ? (
          <div className="space-y-4 text-center">
            <p>Thanks — we'll be in touch.</p>
            <button
              onClick={() => setRequestMode(false)}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Input
              placeholder="Your name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Input
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <Input
              placeholder="Mobile (optional)"
              value={form.cell}
              onChange={(e) => setForm({ ...form, cell: e.target.value })}
            />
            {error && (
              <div className="rounded-md border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-900">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Sending…" : "Request access"}
            </Button>
            <button
              type="button"
              onClick={() => setRequestMode(false)}
              className="w-full text-sm text-muted-foreground hover:text-foreground"
            >
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
