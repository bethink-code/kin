import { db } from "./db";
import { auditLogs } from "@shared/schema";
import type { Request } from "express";

type AuditInput = {
  req?: Request;
  userId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  outcome?: "success" | "failure";
  detail?: Record<string, unknown>;
};

// Fire-and-forget — never block a response on audit logging
export function audit(input: AuditInput): void {
  const userId = input.userId ?? (input.req?.user as { id?: string } | undefined)?.id ?? null;
  const ipAddress =
    (input.req?.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    input.req?.socket.remoteAddress ??
    null;

  db.insert(auditLogs)
    .values({
      userId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      outcome: input.outcome ?? "success",
      detail: input.detail as unknown as object,
      ipAddress,
    })
    .catch((err) => {
      console.error("[audit] failed to write log:", err);
    });
}
