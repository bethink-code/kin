import { cn } from "@/lib/utils";

export function Stat({
  label,
  value,
  size = "lg",
}: {
  label: string;
  value: string | number;
  size?: "sm" | "lg";
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-semibold", size === "lg" ? "text-2xl" : "text-lg")}>
        {value}
      </div>
    </div>
  );
}
