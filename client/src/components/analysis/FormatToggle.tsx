import { useEffect, useState } from "react";

export type Format = "text" | "visual";

const STORAGE_KEY = "ally.analysis.format";

function read(): Format {
  if (typeof window === "undefined") return "text";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "visual" ? "visual" : "text";
}

function write(format: Format): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, format);
  window.dispatchEvent(new CustomEvent("ally-format-change", { detail: format }));
}

// Shared format preference across all Canvas 2 readers. Persists to localStorage;
// the custom event syncs multiple component instances on the same page.
export function useFormatPreference(): { format: Format; setFormat: (f: Format) => void } {
  const [format, setLocal] = useState<Format>(() => read());

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<Format>).detail;
      if (detail === "text" || detail === "visual") setLocal(detail);
    };
    window.addEventListener("ally-format-change", handler);
    return () => window.removeEventListener("ally-format-change", handler);
  }, []);

  return {
    format,
    setFormat: (f) => write(f),
  };
}

export function FormatToggle() {
  const { format, setFormat } = useFormatPreference();
  return (
    <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span className="uppercase tracking-[0.2em] text-[10px]">format</span>
      <button
        type="button"
        onClick={() => setFormat("text")}
        className={`px-2 py-0.5 rounded ${
          format === "text"
            ? "bg-muted text-foreground font-medium"
            : "hover:text-foreground"
        }`}
      >
        text
      </button>
      <span>▸</span>
      <button
        type="button"
        onClick={() => setFormat("visual")}
        className={`px-2 py-0.5 rounded ${
          format === "visual"
            ? "bg-muted text-foreground font-medium"
            : "hover:text-foreground"
        }`}
      >
        visual
      </button>
    </div>
  );
}
