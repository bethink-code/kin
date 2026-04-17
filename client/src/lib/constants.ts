export const STATUS_INDICATORS: Record<string, { dot: string; label: string }> = {
  active: { dot: "bg-primary animate-pulse", label: "Active" },
  pending: { dot: "bg-amber-400", label: "Pending" },
  approved: { dot: "bg-primary", label: "Approved" },
  declined: { dot: "bg-destructive", label: "Declined" },
  idle: { dot: "bg-muted-foreground", label: "Idle" },
  error: { dot: "bg-destructive", label: "Error" },
};
