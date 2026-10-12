import { ArrowUp } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** Slack's composer: Enter sends, Shift+Enter is a new line, "@" suggests people. */
export function Composer({ placeholder, people, onSend, disabled }: {
  placeholder: string;
  people: string[];
  onSend: (text: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pick, setPick] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);

  // The "@word" being typed at the cursor, if any.
  const caret = area.current?.selectionStart ?? text.length;
  const typing = /(?:^|\s)@([a-z0-9._-]*)$/i.exec(text.slice(0, caret));
  const matches = typing ? people.filter((p) => p.startsWith(typing[1].toLowerCase())).slice(0, 6) : [];

  const complete = (name: string) => {
    if (!typing) return;
    const start = caret - typing[1].length;
    const next = `${text.slice(0, start)}${name} ${text.slice(caret)}`;
    setText(next);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(start + name.length + 1, start + name.length + 1);
    });
  };

  const send = async () => {
    const body = text.trim();
    if (!body || busy || disabled) return;
    setBusy(true);
    setError("");
    try {
      await onSend(body);
      setText("");
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative px-4 pb-4">
      {matches.length ? (
        <div className="absolute bottom-full left-4 mb-1 w-56 overflow-hidden rounded-lg border bg-popover p-1 shadow-md">
          {matches.map((p, i) => (
            <button key={p} onMouseDown={(e) => (e.preventDefault(), complete(p))} className={cn("flex w-full items-center rounded-md px-2 py-1 text-left", i === pick % matches.length && "bg-accent")}>
              @{p}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex items-end gap-2 rounded-xl border bg-background px-3 py-2 shadow-xs focus-within:border-ring">
        <textarea
          ref={area}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => (setText(e.target.value), setPick(0))}
          onKeyDown={(e) => {
            if (matches.length && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
              e.preventDefault();
              complete(matches[pick % matches.length]);
            } else if (matches.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setPick((v) => v + (e.key === "ArrowDown" ? 1 : matches.length - 1));
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          className="max-h-48 min-h-6 flex-1 resize-none bg-transparent leading-6 outline-none [field-sizing:content] placeholder:text-muted-foreground"
        />
        <button onClick={() => void send()} disabled={!text.trim() || busy || disabled} aria-label="Send" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-30">
          <ArrowUp className="size-4" />
        </button>
      </div>
      {error ? <p className="mt-1 text-[12px] text-destructive">{error}</p> : null}
    </div>
  );
}
