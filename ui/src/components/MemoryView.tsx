import { ChevronRight, FileText, Folder, Moon, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { api, type Dream } from "@/lib/api";
import { ago } from "@/lib/board";
import { cn } from "@/lib/utils";

// The team's memory (after supermemory's memoryrepo): files, history, and dreams.

type Tab = "files" | "history" | "dreams";
type FileRow = { path: string; version: number; author: string; ts: number };

/** Paths into a folder tree: folders first, then files, alphabetical. */
function tree(files: FileRow[]) {
  const folders = new Map<string, FileRow[]>();
  const top: FileRow[] = [];
  for (const f of files) {
    const slash = f.path.lastIndexOf("/");
    if (slash < 0) top.push(f);
    else {
      const dir = f.path.slice(0, slash);
      folders.set(dir, [...(folders.get(dir) ?? []), f]);
    }
  }
  const entry = top.find((f) => f.path === "MEMORY.md");
  return { entry, top: top.filter((f) => f !== entry), folders: [...folders].sort(([a], [b]) => a.localeCompare(b)) };
}

function FileButton({ open, onOpen, label }: { file: FileRow; open: boolean; onOpen: () => void; label: string }) {
  return (
    <button onClick={onOpen} className={cn("flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-muted-foreground hover:bg-accent hover:text-foreground", open && "bg-accent font-medium text-foreground")}>
      <FileText className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function Files({ onTalk }: { onTalk: (id: string) => void }) {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [open, setOpen] = useState("MEMORY.md");
  const [text, setText] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ path: string; line: number; text: string }[] | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = () => api.memory().then((r) => setFiles(r.files), () => undefined);
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);
  const version = files.find((f) => f.path === open)?.version ?? 0;
  useEffect(() => {
    api.memoryFile(open).then((f) => setText(f.text), () => setText(null));
  }, [open, version]);
  useEffect(() => {
    if (!query.trim()) return setHits(null);
    const t = setTimeout(() => api.memorySearch(query).then((r) => setHits(r.hits), () => setHits([])), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { entry, top, folders } = useMemo(() => tree(files), [files]);
  const meta = files.find((f) => f.path === open);
  const openLink = (target: string) => setOpen(target.endsWith(".md") ? target : `${target}.md`);

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="scroll-thin flex w-60 shrink-0 flex-col gap-px overflow-y-auto border-r p-2">
        <div className="mb-2 flex h-7 items-center gap-2 rounded-md border bg-background px-2 focus-within:border-ring">
          <Search className="size-3.5 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search memory" className="min-w-0 flex-1 bg-transparent outline-none" />
        </div>
        {entry ? <FileButton file={entry} open={open === entry.path} onOpen={() => setOpen(entry.path)} label="MEMORY.md" /> : null}
        {folders.map(([dir, inside]) => (
          <div key={dir}>
            <button onClick={() => setClosed((s) => (s.has(dir) ? new Set([...s].filter((d) => d !== dir)) : new Set(s).add(dir)))} className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-muted-foreground hover:bg-accent hover:text-foreground">
              <ChevronRight className={cn("size-3 transition-transform", !closed.has(dir) && "rotate-90")} />
              <Folder className="size-3.5" /> {dir}
            </button>
            {!closed.has(dir) ? <div className="pl-4">{inside.map((f) => <FileButton key={f.path} file={f} open={open === f.path} onOpen={() => setOpen(f.path)} label={f.path.slice(dir.length + 1)} />)}</div> : null}
          </div>
        ))}
        {top.map((f) => <FileButton key={f.path} file={f} open={open === f.path} onOpen={() => setOpen(f.path)} label={f.path} />)}
        {!files.length ? <p className="px-2 py-4 text-muted-foreground">Empty so far. Agents remember decisions, contracts and owners as they talk.</p> : null}
      </aside>

      <div className="scroll-thin min-w-0 flex-1 overflow-y-auto px-8 py-6">
        {hits ? (
          <div className="flex flex-col gap-1">
            <p className="mb-2 text-muted-foreground">{hits.length} match{hits.length === 1 ? "" : "es"}</p>
            {hits.map((h) => (
              <button key={`${h.path}:${h.line}`} onClick={() => (setQuery(""), setOpen(h.path))} className="flex flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-accent">
                <span className="font-mono text-[11px] text-muted-foreground">{h.path}:{h.line}</span>
                <span>{h.text}</span>
              </button>
            ))}
          </div>
        ) : text ? (
          <>
            <p className="mb-4 font-mono text-[11px] text-muted-foreground">
              {open}
              {meta ? ` · v${meta.version} · ${meta.author} · ${ago(meta.ts)}` : ""}
            </p>
            <Markdown text={text} onLink={openLink} onSource={onTalk} />
          </>
        ) : (
          <p className="text-muted-foreground">{files.length ? `No file ${open}.` : "Nothing remembered yet."}</p>
        )}
      </div>
    </div>
  );
}

function History() {
  const [commits, setCommits] = useState<Awaited<ReturnType<typeof api.memoryHistory>>["commits"]>([]);
  const [shown, setShown] = useState<{ path: string; version: number; text: string | null } | null>(null);
  useEffect(() => {
    api.memoryHistory().then((r) => setCommits(r.commits), () => undefined);
  }, []);
  return (
    <div className="flex min-h-0 flex-1">
      <div className="scroll-thin w-[420px] shrink-0 overflow-y-auto border-r">
        {commits.map((c) => (
          <div key={c.seq} className="border-b px-4 py-3">
            <div className="flex items-baseline gap-2">
              {c.message.startsWith("dream:") ? <Sparkles className="size-3.5 shrink-0 text-dot" /> : null}
              <span className="min-w-0 flex-1">{c.message.replace(/^dream:\s*/, "")}</span>
              <span className="shrink-0 text-[12px] text-muted-foreground">{ago(c.ts)}</span>
            </div>
            <div className="mt-1 text-[12px] text-muted-foreground">{c.author}</div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {c.changes.map((ch) => (
                <button key={ch.path} onClick={() => void api.memoryFile(ch.path, ch.to).then(setShown)} className="rounded border px-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground">
                  {ch.deleted ? "−" : ch.from ? "~" : "+"} {ch.path}
                </button>
              ))}
            </div>
          </div>
        ))}
        {!commits.length ? <p className="p-6 text-muted-foreground">No changes yet.</p> : null}
      </div>
      <div className="scroll-thin min-w-0 flex-1 overflow-y-auto px-8 py-6">
        {shown ? (
          <>
            <p className="mb-4 font-mono text-[11px] text-muted-foreground">{shown.path} · as of v{shown.version}</p>
            {shown.text ? <Markdown text={shown.text} /> : <p className="text-muted-foreground">Deleted in this version.</p>}
          </>
        ) : (
          <p className="text-muted-foreground">Pick a file in a change to see it as it was.</p>
        )}
      </div>
    </div>
  );
}

function Dreams() {
  const [list, setList] = useState<Dream[]>([]);
  const [running, setRunning] = useState<Awaited<ReturnType<typeof api.dreams>>["running"]>(null);
  const [cfg, setCfg] = useState<{ hasKey: boolean; dreamModel: string; lastDream: number } | null>(null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const load = () => {
    api.dreams().then((r) => (setList(r.dreams), setRunning(r.running)), () => undefined);
    api.settings().then((s) => (setCfg(s), setModel((m) => m || s.dreamModel)), () => undefined);
  };
  useEffect(() => {
    load();
    const timer = setInterval(load, 1500);
    return () => clearInterval(timer);
  }, []);
  const start = () => api.dream().then(load, (e) => setError(String(e.message)));
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-8 py-6">
      <div className="flex max-w-2xl flex-col gap-4">
        <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-4">
          <Moon className="mt-0.5 size-4 text-dot" />
          <div className="flex-1">
            <p className="font-medium">Dreaming tidies the team's memory</p>
            <p className="text-muted-foreground">
              It reads what your agents talked about since the last dream, saves what's durable, merges duplicates and drops what's outdated. It runs every 4 hours on the admin's board when there's something new, or now.
            </p>
            {cfg && !cfg.hasKey ? (
              <form className="mt-3 flex gap-2" onSubmit={(e) => (e.preventDefault(), void api.saveSettings({ openrouterKey: key, dreamModel: model }).then(load, (er) => setError(String(er.message))))}>
                <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="OpenRouter key (sk-or-…)" className="h-8 flex-1 rounded-md border bg-background px-2 outline-none focus:border-ring" />
                <Button size="sm" type="submit" disabled={!key.trim()}>Save</Button>
              </form>
            ) : (
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" onClick={() => void start()} disabled={Boolean(running)}>
                  <Sparkles /> {running ? "Dreaming…" : "Dream now"}
                </Button>
                <input value={model} onChange={(e) => setModel(e.target.value)} onBlur={() => void api.saveSettings({ dreamModel: model })} className="h-8 w-64 rounded-md border bg-background px-2 font-mono text-[12px] outline-none focus:border-ring" title="The model dreams use (any OpenRouter model)" />
                {cfg?.lastDream ? <span className="text-muted-foreground">last {ago(cfg.lastDream)}</span> : null}
              </div>
            )}
            {error ? <p className="mt-2 text-destructive">{error}</p> : null}
          </div>
        </div>

        {running ? (
          <div className="rounded-xl border p-4 font-mono text-[12px]">
            {running.log.map((l, i) => (
              <div key={i} className={l.kind === "write" ? "text-foreground" : "text-muted-foreground"}>{l.kind === "write" ? "✎" : "·"} {l.text}</div>
            ))}
            <div className="text-muted-foreground">…</div>
          </div>
        ) : null}

        {list.map((d) => (
          <div key={d.ts} className="rounded-xl border p-4">
            <div className="flex items-baseline gap-2">
              <span className={cn("size-2 shrink-0 rounded-full", d.ok ? "bg-online" : "bg-waiting")} />
              <span className="flex-1">{d.ok ? d.message : d.reason}</span>
              <span className="text-[12px] text-muted-foreground">{ago(d.ts)}</span>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {d.inbox} new message{d.inbox === 1 ? "" : "s"} · {d.steps} steps · {(d.ms / 1000).toFixed(0)}s{d.cost ? ` · $${d.cost.toFixed(4)}` : ""} · {d.model}
            </p>
            {d.changes.length ? <div className="mt-2 flex flex-wrap gap-1">{d.changes.map((c) => <span key={c} className="rounded border px-1.5 font-mono text-[11px] text-muted-foreground">{c}</span>)}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Memory: the team's shared, linked notes. Files · History · Dreams. */
export function MemoryView({ onTalk }: { onTalk: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>("files");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
        {(["files", "history"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("h-7 rounded-md px-3 capitalize text-muted-foreground hover:text-foreground", tab === t && "bg-accent text-foreground")}>
            {t}
          </button>
        ))}
      </div>
      {tab === "files" ? <Files onTalk={onTalk} /> : tab === "history" ? <History /> : <Dreams />}
    </div>
  );
}
