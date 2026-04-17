import { useEffect, useRef, useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateStatements } from "@/lib/invalidation";
import { readFileAsBase64 } from "@/lib/readFileAsBase64";
import { hashFile } from "@/lib/hashFile";
import type { Statement } from "@shared/schema";

export type QueueStatus = "hashing" | "queued" | "uploading" | "done" | "duplicate" | "failed";

export type QueuedFile = {
  id: string;
  file: File;
  status: QueueStatus;
  contentHash?: string;
  result?: Statement;
  error?: string;
};

type UploadResponse = Statement & { wasDuplicate?: boolean };

const MAX_BYTES = 18 * 1024 * 1024;

export function useStatementQueue() {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [rejectWarning, setRejectWarning] = useState<string | null>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    if (processingRef.current) return;
    const next = queue.find((q) => q.status === "queued");
    if (!next || !next.contentHash) return;

    processingRef.current = true;
    (async () => {
      setQueue((prev) => prev.map((q) => (q.id === next.id ? { ...q, status: "uploading" } : q)));
      try {
        const pdfBase64 = await readFileAsBase64(next.file);
        const result = (await apiRequest("POST", "/api/statements/upload", {
          filename: next.file.name,
          sizeBytes: next.file.size,
          contentHash: next.contentHash,
          pdfBase64,
        })) as UploadResponse;

        setQueue((prev) =>
          prev.map((q) =>
            q.id === next.id
              ? { ...q, status: result.wasDuplicate ? "duplicate" : "done", result }
              : q,
          ),
        );
        invalidateStatements(queryClient);
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown_error";
        setQueue((prev) => prev.map((q) => (q.id === next.id ? { ...q, status: "failed", error: message } : q)));
      } finally {
        processingRef.current = false;
        setQueue((prev) => [...prev]);
      }
    })();
  }, [queue]);

  function stageFiles(files: File[]) {
    setRejectWarning(null);
    const rejected: string[] = [];
    const staged: QueuedFile[] = [];

    for (const f of files) {
      if (!f.name.toLowerCase().endsWith(".pdf")) {
        rejected.push(`${f.name} (not a PDF)`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        rejected.push(`${f.name} (over 18 MB)`);
        continue;
      }
      staged.push({
        id: `${Date.now()}-${f.name}-${f.size}-${Math.random()}`,
        file: f,
        status: "hashing",
      });
    }

    if (rejected.length > 0) setRejectWarning(`Skipped: ${rejected.join(", ")}`);
    if (staged.length === 0) return;

    setQueue((prev) => [...prev, ...staged]);

    for (const item of staged) {
      hashFile(item.file).then((contentHash) => {
        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status: "queued", contentHash } : q)),
        );
      });
    }
  }

  function clearFinished() {
    setQueue((prev) =>
      prev.filter((q) => q.status === "hashing" || q.status === "queued" || q.status === "uploading"),
    );
  }

  const anyBusy = queue.some(
    (q) => q.status === "hashing" || q.status === "queued" || q.status === "uploading",
  );

  return { queue, stageFiles, clearFinished, anyBusy, rejectWarning };
}
