import { ArrowUp, Check, FileText, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../lib/api.ts";
import { address, ago, defaultRecipient, isMine, recipients, who, type Talk } from "../lib/board.ts";

interface Props {
  talkId: string | null; // null: a new talk
  me: string;
  agents: { agent: string }[];
  known: string[]; // everyone your agents have talked with
  onClose: () => void;
  onStarted: (thread: string) => void;
  onChanged: () => void;
}

/** One conversation: what was said, and a box to say something into it. */
export function TalkPanel({ talkId, me, agents, known, onClose, onStarted, onChanged }: Props) {
  const [talk, setTalk] = useState<Talk | null>(null);
  const [text, setText] = useState("");
  const [to, setTo] = useState<string | null>(null); // null: the default recipient
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const count = talk?.messages.length ?? 0;

  useEffect(() => {
    setTalk(null);
    setTo(null);
    setError("");
    if (!talkId) return;
    let live = true;
    const load = () => api.talk(talkId).then((t) => live && setTalk(t), (e) => live && setError(String(e.message)));
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [talkId]);

  // Scroll the message list only: scrollIntoView would also scroll the page's own layout out of view.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [count]);

  const options = recipients(talk, me, agents, known);
  const typed = to ?? (talk ? defaultRecipient(talk, me) : "");
  const target = address(typed);

  const send = async () => {
    const body = text.trim();
    if (!body || !target || sending) return;
    setSending(true);
    setError("");
    try {
      if (talkId) {
        await api.say(talkId, target, body);
        setTalk(await api.talk(talkId));
      } else {
        const started = await api.startTalk(target, body, body.split("\n")[0].slice(0, 80));
        onStarted(started.thread);
      }
      setText("");
      onChanged();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setSending(false);
    }
  };

  const toggleDone = async () => {
    if (!talk) return;
    await api.setDone(talk.id, talk.status !== "done");
    setTalk(await api.talk(talk.id));
    onChanged();
  };

  return (
    <section className="talkPanel">
      <header className="talkHead">
        <h2>{talkId ? talk?.title ?? "" : "New talk"}</h2>
        {talk ? (
          <button className="boardPill" onClick={() => void toggleDone()}>
            {talk.status === "done" ? <RotateCcw size={13} /> : <Check size={13} />}
            {talk.status === "done" ? "Reopen" : "Done"}
          </button>
        ) : null}
        <button className="boardIconBtn" title="Close" onClick={onClose}>
          <X size={15} />
        </button>
      </header>

      <div className="talkMessages scroll" ref={list}>
        {talk?.messages.map((m) => (
          <div key={m.id} className={`talkMsg ${isMine(m.from, me) ? "mine" : ""}`}>
            <div className="talkMeta">
              <span>{who(m.from, me)}</span>
              <span className="talkArrow">→ {who(m.to, me)}</span>
              <span className="talkTime">{ago(m.ts)}</span>
            </div>
            <div className="talkText">{m.text}</div>
            {m.files?.map((f) =>
              f.path ? (
                <a key={f.name} className="talkFile" href={`/api/board/files?path=${encodeURIComponent(f.path)}`} target="_blank" rel="noreferrer">
                  <FileText size={12} /> {f.name}
                </a>
              ) : (
                <span key={f.name} className="talkFile">
                  <FileText size={12} /> {f.name}
                </span>
              ),
            )}
          </div>
        ))}
      </div>

      <form className="talkComposer" onSubmit={(e) => (e.preventDefault(), void send())}>
        <div className="talkTo">
          <span>to</span>
          <input list="talk-recipients" placeholder="a name, e.g. nitin" value={typed} onChange={(e) => setTo(e.target.value)} />
          <datalist id="talk-recipients">
            {options.map((a) => (
              <option key={a} value={a}>
                {who(a, me)}
              </option>
            ))}
          </datalist>
          {target ? <span className="talkWho">{who(target, me)}</span> : null}
        </div>
        <div className="talkInput">
          <textarea
            rows={2}
            autoFocus
            placeholder={talkId ? "Say something…" : "What do you want to talk about?"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className="talkSend" disabled={!text.trim() || !target || sending} title="Send">
            <ArrowUp size={16} />
          </button>
        </div>
        {error ? <p className="boardNote">{error}</p> : null}
      </form>
    </section>
  );
}
