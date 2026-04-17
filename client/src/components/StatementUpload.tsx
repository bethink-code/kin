import { useRef, useState } from "react";
import type { QueuedFile } from "@/hooks/useStatementQueue";

type Props = {
  queue: QueuedFile[];
  anyBusy: boolean;
  rejectWarning: string | null;
  onStageFiles: (files: File[]) => void;
  onClearFinished: () => void;
};

export function StatementUpload({
  queue,
  anyBusy,
  rejectWarning,
  onStageFiles,
  onClearFinished,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function pick() {
    inputRef.current?.click();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) onStageFiles(files);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) onStageFiles(files);
  }

  const doneCount = queue.filter((q) => q.status === "done").length;
  const duplicateCount = queue.filter((q) => q.status === "duplicate").length;
  const failedCount = queue.filter((q) => q.status === "failed").length;
  const totalFinished = doneCount + duplicateCount + failedCount;

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={onChange}
      />

      <div
        onClick={pick}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`cursor-pointer rounded-md border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/60 hover:bg-muted/40"
        }`}
      >
        <div className="text-sm">
          {dragging ? "Drop your statements here" : "Drop statements here, or click to choose"}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          PDF, up to 18 MB each. Drop up to 12 at once — we'll read them one at a time.
        </div>
      </div>

      {rejectWarning && (
        <div className="rounded-md border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-900">
          {rejectWarning}
        </div>
      )}

      {queue.length > 0 && (
        <div className="rounded-md border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2 text-sm">
            <div>
              {anyBusy
                ? `Reading ${totalFinished + 1} of ${queue.length}…`
                : `Done — ${doneCount} new${duplicateCount > 0 ? `, ${duplicateCount} already in your picture` : ""}${failedCount > 0 ? `, ${failedCount} failed` : ""}`}
            </div>
            {!anyBusy && (
              <button onClick={onClearFinished} className="text-xs text-muted-foreground hover:text-foreground">
                Clear
              </button>
            )}
          </div>
          <ul className="divide-y divide-border">
            {queue.map((q) => (
              <QueueRow key={q.id} item={q} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function QueueRow({ item }: { item: QueuedFile }) {
  return (
    <li className="flex items-center justify-between px-4 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate">{item.file.name}</div>
        {item.status === "failed" && (
          <div className="mt-0.5 text-xs text-destructive">{item.error}</div>
        )}
      </div>
      <StatusBadge status={item.status} />
    </li>
  );
}

function StatusBadge({ status }: { status: QueuedFile["status"] }) {
  const map: Record<QueuedFile["status"], { label: string; className: string }> = {
    hashing: { label: "Checking…", className: "text-muted-foreground" },
    queued: { label: "Queued", className: "text-muted-foreground" },
    uploading: { label: "Reading…", className: "text-primary" },
    done: { label: "Done", className: "text-primary" },
    duplicate: { label: "Already in your picture", className: "text-muted-foreground" },
    failed: { label: "Failed", className: "text-destructive" },
  };
  const { label, className } = map[status];
  return <span className={`ml-3 text-xs ${className}`}>{label}</span>;
}
