export function formatMoney(n: number): string {
  if (n === 0) return "R0";
  if (Math.abs(n) < 0.01) return n < 0 ? "-<R0.01" : "<R0.01";
  const sign = n < 0 ? "-" : "";
  return `${sign}R${Math.abs(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatSignedMoney(n: number): string {
  const formatted = formatMoney(n);
  return n > 0 ? `+${formatted}` : formatted;
}

export function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function formatNumber(n: number, decimals = 1, suffix = ""): string {
  return `${n.toFixed(decimals)}${suffix}`;
}

export function formatTimeAgo(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))}h ago`;
  return date.toLocaleDateString();
}

export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString();
}
