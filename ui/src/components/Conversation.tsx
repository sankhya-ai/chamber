import { Check, FileText, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/Avatar";
import { Composer } from "@/components/Composer";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { address, ago, defaultRecipient, personOf, who, type Talk } from "@/lib/board";
import { cn } from "@/lib/utils";

/** One talk, Slack-style: messages grouped by sender, a composer, Done. `talkId` null = a new talk. */
export function Conversation({ talkId, me, to: fixedTo, people, onClose, onStarted, onChanged }: {
  talkId: string | null;
  me: string;
  to: string; // where a new talk goes ("" = ask)
  people: string[];
  onClose: () => void;
  onStarted: (thread: string) => void;
  onChanged: () => void;
}) {
  const [talk, setTalk] = useState<Talk | null>(null);
  const [to, setTo] = useState(fixedTo);
  const list = useRef<HTMLDivElement>(null);
  const count = talk?.messages.length ?? 0;

  useEffect(() => {
    setTalk(null);
    if (!talkId) return;
    let live = true;
    const load = () => api.talk(talkId).then((t) => live && setTalk(t), () => undefined);
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [talkId]);

  // Scroll the message list only: scrollIntoView would also scroll the page's own layout.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [count]);

  const send = async (text: string) => {
    if (talkId && talk) {
      await api.say(talkId, defaultRecipient(talk, me), text);
      setTalk(await api.talk(talkId));
    } else {
      const target = address(to);
      if (!target) throw new Error("Who is it for? Type a name, e.g. nitin, or a #channel.");
      onStarted((await api.startTalk(target, text, text.split("\n")[0].slice(0, 80))).thread);
    }
    onChanged();
  };

  const toggleDone = async () => {
    if (!talk) return;
    await api.setDone(talk.id, talk.status !== "done");
    setTalk(await api.talk(talk.id));
    onChanged();
  };

  return (
    <section className="flex min-h-0 w-[440px] shrink-0 flex-col border-l">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium">{talkId ? talk?.title ?? "" : "New talk"}</h2>
          {talk ? <p className="truncate text-[12px] text-muted-foreground">{talk.channel ?? talk.with.map((p) => who(p, me)).join(", ")}</p> : null}
        </div>
        {talk ? (
          <Button variant="outline" size="sm" onClick={() => void toggleDone()}>
            {talk.status === "done" ? <RotateCcw /> : <Check />}
            {talk.status === "done" ? "Reopen" : "Done"}
          </Button>
        ) : null}
        <button aria-label="Close" onClick={onClose} className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-4" />
        </button>
      </header>

      <div ref={list} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {!talkId ? (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
            <span className="text-muted-foreground">To</span>
            <input
              autoFocus={!fixedTo}
              list="people"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="nitin, #general, or an agent"
              className="flex-1 bg-transparent outline-none"
            />
            <datalist id="people">{people.map((p) => <option key={p} value={p} />)}</datalist>
          </div>
        ) : null}
        {talk?.messages.map((m, i) => {
          const prev = talk.messages[i - 1];
          const grouped = prev && prev.from === m.from && m.ts - prev.ts < 5 * 60_000;
          const name = who(m.from, me);
          return (
            <div key={m.id} className={cn("flex gap-3", grouped ? "mt-0.5" : "mt-4 first:mt-0")}>
              <div className="w-7 shrink-0">{grouped ? null : <Avatar name={personOf(m.from, me)} size={28} />}</div>
              <div className="min-w-0 flex-1">
                {grouped ? null : (
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold first-letter:uppercase">{name}</span>
                    {m.to && !m.to.startsWith("#") && m.to !== `${me}/board` ? <span className="text-[12px] text-muted-foreground">to {who(m.to, me)}</span> : null}
                    <span className="text-[12px] text-muted-foreground">{ago(m.ts)}</span>
                  </div>
                )}
                <div className="whitespace-pre-wrap break-words leading-relaxed">{m.text}</div>
                {m.files?.length ? (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {m.files.map((f) => {
                      const chip = (
                        <span className="inline-flex items-center gap-1 rounded-md border bg-muted/60 px-2 py-0.5 text-[12px]">
                          <FileText className="size-3" /> {f.name}
                        </span>
                      );
                      return f.path ? <a key={f.name} href={`/api/board/files?path=${encodeURIComponent(f.path)}`} target="_blank" rel="noreferrer">{chip}</a> : <span key={f.name}>{chip}</span>;
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <Composer
        placeholder={talkId ? `Reply${talk?.channel ? ` in ${talk.channel}` : talk ? ` to ${who(defaultRecipient(talk, me), me)}` : ""}…` : "What do you want to talk about?"}
        people={people.filter((p) => !p.includes("/") && !p.startsWith("#")).map((p) => p.replace(/^@/, ""))}
        onSend={send}
      />
    </section>
  );
}
