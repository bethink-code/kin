import { useRef, useState } from "react";
import { Plus, ArrowUp } from "lucide-react";

export function ConversationInput({
  onSend,
  disabled,
  onAttach,
}: {
  onSend: (content: string) => void;
  disabled: boolean;
  onAttach?: () => void;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const content = value.trim();
    if (!content || disabled) return;
    onSend(content);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function onInput(e: React.FormEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
    setValue(el.value);
  }

  const canSend = !disabled && value.trim().length > 0;

  return (
    <div className="shrink-0 px-4 pb-4 pt-2">
      <div className="rounded-2xl border border-border bg-background shadow-sm px-4 pt-3 pb-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onInput={onInput}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={disabled}
          placeholder="Your answer…"
          className="block w-full resize-none bg-transparent text-sm leading-normal focus:outline-none disabled:opacity-60 placeholder:text-muted-foreground"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onAttach}
            disabled={disabled}
            title="Attach a document"
            aria-label="Attach"
            className="h-8 w-8 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-60 transition-colors"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Send"
            className="h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center disabled:opacity-40 transition-opacity"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
