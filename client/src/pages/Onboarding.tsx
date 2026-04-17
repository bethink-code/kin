import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { ProgressRing } from "@/components/ProgressRing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateAuth } from "@/lib/invalidation";
import { resizePhoto } from "@/lib/resizePhoto";

type Step = "photo" | "name" | "contact" | "review";
const ORDER: Step[] = ["photo", "name", "contact", "review"];

export default function Onboarding() {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>("photo");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [cell, setCell] = useState("");

  const submit = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/user/onboard", {
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        cell: cell.trim() || undefined,
        photoDataUrl: photoDataUrl ?? undefined,
      }),
    onSuccess: () => invalidateAuth(queryClient),
  });

  const stepIndex = ORDER.indexOf(step);
  // Ring fills as steps get completed. Photo step starts at 0, contact submission = 1.0
  const completedSteps = submit.isSuccess ? ORDER.length : stepIndex;
  const progress = completedSteps / ORDER.length;

  const initials = (firstName || user?.firstName || user?.email || "?").slice(0, 1).toUpperCase();

  function goNext() {
    const nextIndex = stepIndex + 1;
    if (nextIndex < ORDER.length) setStep(ORDER[nextIndex]);
  }

  function goBack() {
    const prevIndex = stepIndex - 1;
    if (prevIndex >= 0) setStep(ORDER[prevIndex]);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg space-y-10">
        <div className="flex justify-center">
          <ProgressRing progress={progress} size={240}>
            {photoDataUrl ? (
              <img src={photoDataUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center font-serif text-6xl text-muted-foreground">
                {initials}
              </div>
            )}
          </ProgressRing>
        </div>

        <div className="min-h-[200px]">
          {step === "photo" && (
            <PhotoStep
              onPhoto={(dataUrl) => setPhotoDataUrl(dataUrl)}
              onContinue={goNext}
              hasPhoto={!!photoDataUrl}
            />
          )}
          {step === "name" && (
            <NameStep
              firstName={firstName}
              lastName={lastName}
              onChangeFirst={setFirstName}
              onChangeLast={setLastName}
              onBack={goBack}
              onContinue={goNext}
            />
          )}
          {step === "contact" && (
            <ContactStep
              email={user?.email ?? ""}
              cell={cell}
              onChangeCell={setCell}
              onBack={goBack}
              onContinue={goNext}
            />
          )}
          {step === "review" && (
            <ReviewStep
              firstName={firstName}
              lastName={lastName}
              email={user?.email ?? ""}
              cell={cell}
              hasPhoto={!!photoDataUrl}
              onBack={goBack}
              onSubmit={() => submit.mutate()}
              submitting={submit.isPending}
              error={submit.error instanceof Error ? submit.error.message : null}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function PhotoStep({
  onPhoto,
  onContinue,
  hasPhoto,
}: {
  onPhoto: (dataUrl: string) => void;
  onContinue: () => void;
  hasPhoto: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please pick an image file (JPG or PNG).");
      return;
    }
    setError(null);
    setWorking(true);
    try {
      const dataUrl = await resizePhoto(file);
      onPhoto(dataUrl);
    } catch {
      setError("We couldn't read that image. Try another one.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-5 text-center">
      <div>
        <h1 className="font-serif text-3xl">Let's start with you.</h1>
        <p className="mt-2 text-muted-foreground">
          Upload a photo so this feels like yours. You'll see it every time you come back.
        </p>
      </div>

      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

      {error && (
        <div className="rounded-md border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-900">{error}</div>
      )}

      <div className="flex flex-col items-center gap-2">
        <Button onClick={() => inputRef.current?.click()} disabled={working}>
          {working ? "Resizing…" : hasPhoto ? "Pick a different photo" : "Upload a photo"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onContinue}>
          {hasPhoto ? "Continue" : "Skip for now"}
        </Button>
      </div>
    </div>
  );
}

function NameStep({
  firstName,
  lastName,
  onChangeFirst,
  onChangeLast,
  onBack,
  onContinue,
}: {
  firstName: string;
  lastName: string;
  onChangeFirst: (v: string) => void;
  onChangeLast: (v: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [warning, setWarning] = useState<string | null>(null);

  function next() {
    if (!firstName.trim()) {
      setWarning("We need your first name — that's how we'll speak to you.");
      return;
    }
    setWarning(null);
    onContinue();
  }

  return (
    <div className="space-y-5 text-center">
      <div>
        <h1 className="font-serif text-3xl">What should we call you?</h1>
        <p className="mt-2 text-muted-foreground">
          Your story will be written with your name, not "user".
        </p>
      </div>

      <div className="space-y-3">
        <Input
          placeholder="First name"
          value={firstName}
          onChange={(e) => onChangeFirst(e.target.value)}
          autoFocus
        />
        <Input
          placeholder="Last name (optional)"
          value={lastName}
          onChange={(e) => onChangeLast(e.target.value)}
        />
      </div>

      {warning && (
        <div className="rounded-md border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-900">{warning}</div>
      )}

      <StepNav onBack={onBack} onNext={next} />
    </div>
  );
}

function ContactStep({
  email,
  cell,
  onChangeCell,
  onBack,
  onContinue,
}: {
  email: string;
  cell: string;
  onChangeCell: (v: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-5 text-center">
      <div>
        <h1 className="font-serif text-3xl">How can we reach you?</h1>
        <p className="mt-2 text-muted-foreground">
          Only if something actually matters. No newsletters.
        </p>
      </div>

      <div className="space-y-3 text-left">
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Email</label>
          <div className="mt-1 rounded-md border border-border bg-muted/60 px-3 py-2 text-sm">{email}</div>
          <div className="mt-1 text-xs text-muted-foreground">This is the email you signed in with.</div>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Mobile number (optional)</label>
          <Input
            className="mt-1"
            placeholder="e.g. 082 123 4567"
            value={cell}
            onChange={(e) => onChangeCell(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      <StepNav onBack={onBack} onNext={onContinue} />
    </div>
  );
}

function ReviewStep({
  firstName,
  lastName,
  email,
  cell,
  hasPhoto,
  onBack,
  onSubmit,
  submitting,
  error,
}: {
  firstName: string;
  lastName: string;
  email: string;
  cell: string;
  hasPhoto: boolean;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}) {
  return (
    <div className="space-y-5 text-center">
      <div>
        <h1 className="font-serif text-3xl">Ready when you are.</h1>
        <p className="mt-2 text-muted-foreground">
          Here's what we have. You can change anything later.
        </p>
      </div>

      <div className="rounded-md border border-border bg-card p-4 text-left text-sm">
        <ReviewRow label="Photo" value={hasPhoto ? "Uploaded" : "None — you can add one later"} />
        <ReviewRow label="Name" value={`${firstName}${lastName ? " " + lastName : ""}`} />
        <ReviewRow label="Email" value={email} />
        <ReviewRow label="Mobile" value={cell || "Not provided"} />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</div>
      )}

      <div className="flex items-center justify-center gap-3">
        <Button variant="ghost" onClick={onBack} disabled={submitting}>
          Back
        </Button>
        <Button onClick={onSubmit} disabled={submitting}>
          {submitting ? "Saving…" : "Begin my story"}
        </Button>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-2 last:border-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground self-center">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function StepNav({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="flex items-center justify-center gap-3 pt-2">
      <Button variant="ghost" onClick={onBack}>
        Back
      </Button>
      <Button onClick={onNext}>Continue</Button>
    </div>
  );
}
