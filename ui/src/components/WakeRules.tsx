import { BellRing, Eye, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type WakeEntry, type WakeRule } from "@/lib/api";
import { KIND, people, type BoardData } from "@/lib/board";
import { cn } from "@/lib/utils";

const DEFAULT: WakeRule = { who: "nobody", can: "answer" };
const select = "rounded-md border bg-background px-2 py-1 text-xs outline-none focus:border-ring";

/** One line per thing a woken agent did, from its CLI's JSON events (Claude Code stream-json, Codex --json). */
function describe(event: any): { kind: "say" | "tool" | "done" | "error"; text: string } | null {
  if (event?.type === "assistant") {
    const parts = event.message?.content ?? (event.text ? [{ type: "text", text: event.text }] : []);
    const said = parts.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n").trim();
    const tools = parts.filter((p: any) => p.type === "tool_use").map((p: any) => `${p.name}${p.input?.file_path ? ` ${p.input.file_path}` : p.input?.pattern ? ` ${p.input.pattern}` : ""}`);
    if (tools.length) return { kind: "tool", text: tools.join(", ") };
    return said ? { kind: "say", text: said } : null;
  }
  if (event?.type === "result") return { kind: event.is_error ? "error" : "done", text: event.result || (event.is_error ? "Stopped with an error." : "Done.") };
  if (event?.type === "item.completed" && event.item) {
    const item = event.item;
    if (item.type === "agent_message") return { kind: "say", text: item.text };
    if (item.type === "command_execution") return { kind: "tool", text: item.command };
    if (item.type === "file_change") return { kind: "tool", text: `edited ${(item.changes || []).map((c: any) => c.path).join(", ")}` };
    if (item.type === "mcp_tool_call") return { kind: "tool", text: `${item.server}.${item.tool}` };
  }
  if (event?.type === "stderr" && event.text?.trim()) return { kind: "error", text: event.text.trim() };
  return null;
}

/** What a woken agent is doing, or did: refreshed while it runs. */
function RunView({ entry, onClose }: { entry: WakeEntry; onClose: () => void }) {
  const [lines, setLines] = useState<{ kind: string; text: string }[] | null>(null);
  const running = !entry.ended;
  useEffect(() => {
    let stop = false;
    const load = () => api.wakeRun(entry.id).then((r) => !stop && setLines(r.events.map(describe).filter(Boolean) as any), () => !stop && setLines([]));
    load();
    const timer = running ? setInterval(load, 2000) : undefined;
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [entry.id, running]);
  return (
    <div className="rounded-lg border bg-muted/20 p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">
          {entry.agent.split("/")[1]} for {entry.from} {running ? <Loader2 className="ml-1 inline size-3 animate-spin" /> : null}
        </span>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
      </div>
      {lines === null ? <p className="text-muted-foreground">Loading…</p> : !lines.length ? <p className="text-muted-foreground">{running ? "Starting…" : "Nothing recorded."}</p> : (
        <ol className="max-h-64 space-y-1.5 overflow-y-auto">
          {lines.map((line, i) => (
            <li key={i} className={cn("whitespace-pre-wrap break-words", line.kind === "tool" && "font-mono text-[11px] text-muted-foreground", line.kind === "error" && "text-destructive", line.kind === "done" && "border-t pt-1.5 font-medium")}>
              {line.kind === "tool" ? `→ ${line.text}` : line.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Who may wake each of your agents when it isn't running, what it may do then, and what woke them. */
export function WakeRules({ data }: { data: BoardData | null }) {
  const [rules, setRules] = useState<Record<string, WakeRule>>({});
  const [log, setLog] = useState<WakeEntry[]>([]);
  const [watching, setWatching] = useState<WakeEntry | null>(null);
  const [error, setError] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  useEffect(() => {
    api.members().then((r) => setMembers(r.members.map((m) => m.owner)), () => undefined);
  }, []);

  const load = useCallback(() => api.wakeRules().then((r) => { setRules(r.agents); setLog(r.log); }, () => undefined), []);
  useEffect(() => {
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const me = data?.me ?? "";
  const agents = (data?.projects ?? []).flatMap((p) => p.agents.map((a) => ({ ...a, project: p.name }))).filter((a) => a.agent.startsWith(`${me}/`));
  // Everyone in the chamber (its members) and anyone seen in talks or channels.
  const teammates = [...new Set([...members, ...people(data).map((p) => p.owner)])].filter((o) => o && o !== me).sort();

  const save = async (agent: string, rule: WakeRule) => {
    setError("");
    setRules((r) => ({ ...r, [agent]: rule }));
    try {
      const r = await api.setWakeRule(agent, rule);
      setRules(r.agents);
    } catch (e: any) {
      setError(e?.message || "Couldn't save that.");
      void load();
    }
  };

  if (!agents.length) return null;
  return (
    <div className="space-y-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <BellRing className="size-3.5" /> Teammates waking your agents
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          When a teammate's agent messages one of yours that isn't running, Chamber can start it to answer. Only the people you allow, and only as much as you allow. A teammate can wake your agents 3 times an hour.
        </p>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="divide-y rounded-xl border">
        {agents.map((a) => {
          const rule = rules[a.agent] ?? DEFAULT;
          const mode = Array.isArray(rule.who) ? "people" : rule.who;
          const picked = Array.isArray(rule.who) ? rule.who : [];
          return (
            <div key={a.agent} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium">{KIND[a.kind] ?? a.kind} <span className="font-normal text-muted-foreground">in {a.project}</span></span>
                <div className="flex items-center gap-1.5">
                  <select aria-label="Who can wake it" className={select} value={mode} onChange={(e) => save(a.agent, { ...rule, who: e.target.value === "people" ? picked : (e.target.value as "nobody" | "team") })}>
                    <option value="nobody">Only me</option>
                    <option value="team">Whole team</option>
                    <option value="people">Chosen people</option>
                  </select>
                  <select aria-label="What it may do" className={select} value={rule.can} disabled={mode === "nobody"} onChange={(e) => save(a.agent, { ...rule, can: e.target.value as "answer" | "work" })}>
                    <option value="answer">Answer questions</option>
                    <option value="work">Do work (edit files)</option>
                  </select>
                </div>
              </div>
              {mode === "people" ? (
                <div className="flex flex-wrap gap-1.5">
                  {teammates.length ? teammates.map((name) => {
                    const on = picked.includes(name);
                    return (
                      <button key={name} type="button" onClick={() => save(a.agent, { ...rule, who: on ? picked.filter((n) => n !== name) : [...picked, name] })} className={cn("rounded-full border px-2 py-0.5 text-[11px]", on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}>
                        @{name}
                      </button>
                    );
                  }) : <span className="text-[11px] text-muted-foreground">No teammates yet. Invite someone first.</span>}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {watching ? <RunView entry={log.find((e) => e.id === watching.id) ?? watching} onClose={() => setWatching(null)} /> : null}

      {log.length ? (
        <div className="space-y-1">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recent</h4>
          <ul className="divide-y rounded-lg border text-xs">
            {log.slice(0, 12).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <span className={cn("mr-1.5 inline-block size-1.5 rounded-full", e.result === "refused" ? "bg-destructive/70" : e.ended ? "bg-muted-foreground/50" : "bg-[#a8cbbb] animate-pulse")} />
                  <span className="font-medium">{e.from}</span> → {e.agent.split("/")[1]}
                  <span className="ml-1.5 text-muted-foreground">{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  {e.result === "refused" ? <p className="truncate text-[11px] text-muted-foreground">{e.reason}</p> : null}
                </div>
                {e.result === "woke" ? (
                  <button type="button" onClick={() => setWatching(e)} className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                    <Eye className="size-3" /> {e.ended ? "See what it did" : "Watch"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
