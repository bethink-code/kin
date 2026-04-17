import { cn } from "@/lib/utils";

interface Tab {
  key: string;
  label: string;
  count?: number | null;
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  align = "start",
}: {
  tabs: Tab[];
  active: T;
  onChange: (key: T) => void;
  align?: "start" | "center";
}) {
  return (
    <div
      className={cn(
        "flex gap-2 border-b border-border",
        align === "center" && "justify-center",
      )}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key as T)}
          className={cn(
            "-mb-px border-b-2 px-4 py-2 text-sm transition-colors",
            active === t.key
              ? "border-primary text-primary font-medium"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
          {t.count != null && t.count > 0 && (
            <span className="ml-2 rounded-full bg-primary/20 px-1.5 py-0.5 text-xs text-primary">
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
