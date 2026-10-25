import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { ChevronRight, FileText, Folder, Moon, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { ago } from "@/lib/board";
import { cn } from "@/lib/utils";
/** Paths into a folder tree: folders first, then files, alphabetical. */
function tree(files) {
    const folders = new Map();
    const top = [];
    for (const f of files) {
        const slash = f.path.lastIndexOf("/");
        if (slash < 0)
            top.push(f);
        else {
            const dir = f.path.slice(0, slash);
            folders.set(dir, [...(folders.get(dir) ?? []), f]);
        }
    }
    const entry = top.find((f) => f.path === "MEMORY.md");
    return { entry, top: top.filter((f) => f !== entry), folders: [...folders].sort(([a], [b]) => a.localeCompare(b)) };
}
function FileButton({ open, onOpen, label }) {
    return (_jsxs("button", { onClick: onOpen, className: cn("flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-muted-foreground hover:bg-accent hover:text-foreground", open && "bg-accent font-medium text-foreground"), children: [_jsx(FileText, { className: "size-3.5 shrink-0" }), _jsx("span", { className: "truncate", children: label })] }));
}
function Files({ onTalk }) {
    const [files, setFiles] = useState([]);
    const [open, setOpen] = useState("MEMORY.md");
    const [text, setText] = useState(null);
    const [query, setQuery] = useState("");
    const [hits, setHits] = useState(null);
    const [closed, setClosed] = useState(new Set());
    useEffect(() => {
        const load = () => api.memory().then((r) => setFiles((prev) => (JSON.stringify(prev) === JSON.stringify(r.files) ? prev : r.files)), () => undefined);
        void load();
        const timer = setInterval(load, 5000);
        return () => clearInterval(timer);
    }, []);
    const version = files.find((f) => f.path === open)?.version ?? 0;
    useEffect(() => {
        api.memoryFile(open).then((f) => setText(f.text), () => setText(null));
    }, [open, version]);
    useEffect(() => {
        if (!query.trim())
            return setHits(null);
        const t = setTimeout(() => api.memorySearch(query).then((r) => setHits(r.hits), () => setHits([])), 250);
        return () => clearTimeout(t);
    }, [query]);
    const { entry, top, folders } = useMemo(() => tree(files), [files]);
    const meta = files.find((f) => f.path === open);
    const openLink = (target) => setOpen(target.endsWith(".md") ? target : `${target}.md`);
    return (_jsxs("div", { className: "flex min-h-0 flex-1", children: [_jsxs("aside", { className: "scroll-thin flex w-60 shrink-0 flex-col gap-px overflow-y-auto border-r p-2", children: [_jsxs("div", { className: "mb-2 flex h-7 items-center gap-2 rounded-md border bg-background px-2 focus-within:border-ring", children: [_jsx(Search, { className: "size-3.5 text-muted-foreground" }), _jsx("input", { value: query, onChange: (e) => setQuery(e.target.value), placeholder: "Search memory", className: "min-w-0 flex-1 bg-transparent outline-none" })] }), entry ? _jsx(FileButton, { file: entry, open: open === entry.path, onOpen: () => setOpen(entry.path), label: "MEMORY.md" }) : null, folders.map(([dir, inside]) => (_jsxs("div", { children: [_jsxs("button", { onClick: () => setClosed((s) => (s.has(dir) ? new Set([...s].filter((d) => d !== dir)) : new Set(s).add(dir))), className: "flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-muted-foreground hover:bg-accent hover:text-foreground", children: [_jsx(ChevronRight, { className: cn("size-3 transition-transform", !closed.has(dir) && "rotate-90") }), _jsx(Folder, { className: "size-3.5" }), " ", dir] }), !closed.has(dir) ? _jsx("div", { className: "pl-4", children: inside.map((f) => _jsx(FileButton, { file: f, open: open === f.path, onOpen: () => setOpen(f.path), label: f.path.slice(dir.length + 1) }, f.path)) }) : null] }, dir))), top.map((f) => _jsx(FileButton, { file: f, open: open === f.path, onOpen: () => setOpen(f.path), label: f.path }, f.path)), !files.length ? _jsx("p", { className: "px-2 py-4 text-muted-foreground", children: "Empty so far. Agents remember decisions, contracts and owners as they talk." }) : null] }), _jsx("div", { className: "scroll-thin min-w-0 flex-1 overflow-y-auto px-8 py-6", children: hits ? (_jsxs("div", { className: "flex flex-col gap-1", children: [_jsxs("p", { className: "mb-2 text-muted-foreground", children: [hits.length, " match", hits.length === 1 ? "" : "es"] }), hits.map((h) => (_jsxs("button", { onClick: () => (setQuery(""), setOpen(h.path)), className: "flex flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-accent", children: [_jsxs("span", { className: "font-mono text-[11px] text-muted-foreground", children: [h.path, ":", h.line] }), _jsx("span", { children: h.text })] }, `${h.path}:${h.line}`)))] })) : text ? (_jsxs(_Fragment, { children: [_jsxs("p", { className: "mb-4 font-mono text-[11px] text-muted-foreground", children: [open, meta ? ` · v${meta.version} · ${meta.author} · ${ago(meta.ts)}` : ""] }), _jsx(Markdown, { text: text, onLink: openLink, onSource: onTalk })] })) : (_jsx(SuggestedMemoriesView, { onTalk: onTalk, onMemoryCreated: () => {
                        api.memory().then((r) => setFiles(r.files));
                    } })) })] }));
}
function SuggestedMemoriesView({ onTalk, onMemoryCreated }) {
    const [suggestions, setSuggestions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [accepting, setAccepting] = useState(null);
    useEffect(() => {
        setLoading(true);
        api.search("decision OR contract OR schema OR policy OR test OR port OR model", "", "")
            .then((res) => {
            setSuggestions((res.hits || []).slice(0, 5));
        })
            .catch(() => setSuggestions([]))
            .finally(() => setLoading(false));
    }, []);
    const handleAccept = async (hit) => {
        setAccepting(hit.id);
        try {
            const today = new Date().toISOString().slice(0, 10);
            const entry = `\n\n## ${hit.title || "Decision / Architecture Contract"}\n\n${hit.text}\n\n[source: talk/${hit.talkId}#${hit.messageId}; by: ${hit.sender}; added: ${today}]`;
            const current = await api.memoryFile("MEMORY.md").catch(() => ({ text: "" }));
            const baseText = current?.text || "# Team Memory\n\nCore decisions, contracts, and conventions remembered by the team.\n";
            await api.saveMemoryFile("MEMORY.md", baseText + entry, `Accept decision from talk/${hit.talkId}`);
            onMemoryCreated();
        }
        catch (err) {
            console.error(err);
        }
        finally {
            setAccepting(null);
        }
    };
    const handleDismiss = (id) => {
        setSuggestions((s) => s.filter((item) => item.id !== id));
    };
    if (loading) {
        return (_jsx("div", { className: "flex h-64 items-center justify-center text-xs text-muted-foreground", children: "Scanning talks for proposed decisions and contracts\u2026" }));
    }
    return (_jsxs("div", { className: "w-full max-w-5xl py-2", children: [_jsx("div", { className: "mb-6 rounded-xl border bg-muted/30 p-5", children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx(Sparkles, { className: "mt-0.5 size-5 text-dot shrink-0" }), _jsxs("div", { children: [_jsx("h3", { className: "font-semibold text-foreground", children: "Suggested Memories (Pending Human Review)" }), _jsx("p", { className: "mt-1 text-xs text-muted-foreground leading-relaxed", children: "Chamber extracts proposed decisions, architectural contracts, and conventions from talks. Unlike automated databases, team memory is human-reviewed: accept what belongs in shared repo memory, or dismiss one-offs." })] })] }) }), suggestions.length === 0 ? (_jsxs("div", { className: "py-12 text-center text-xs text-muted-foreground border rounded-xl border-dashed p-8", children: [_jsx("p", { className: "font-medium text-foreground text-sm", children: "Nothing remembered yet" }), _jsx("p", { className: "mt-1.5 max-w-md mx-auto text-muted-foreground", children: "As your agents discuss code, decisions and contracts will be extracted here with source citations for you to review and commit." })] })) : (_jsx("div", { className: "flex flex-col gap-3", children: suggestions.map((s) => (_jsxs("div", { className: "rounded-lg border bg-card p-4 shadow-xs", children: [_jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsx("span", { className: "font-semibold text-[13px] text-foreground", children: s.title || "Architectural Decision" }), _jsxs("button", { onClick: () => onTalk(s.talkId), className: "inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground bg-muted px-1.5 py-0.5 rounded", title: "Open source talk", children: ["\u2197 talk/", s.talkId.slice(0, 8)] })] }), _jsxs("blockquote", { className: "my-2.5 border-l-2 border-dot/60 pl-3 text-xs italic text-muted-foreground/90 leading-relaxed", children: ["\"", s.text.slice(0, 200), s.text.length > 200 ? "…" : "", "\""] }), _jsxs("div", { className: "flex items-center justify-between pt-2 border-t border-border/40 text-[11px]", children: [_jsxs("span", { className: "text-muted-foreground", children: ["From ", _jsx("strong", { className: "font-medium text-foreground", children: s.sender })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { onClick: () => handleDismiss(s.id), className: "text-muted-foreground hover:text-foreground px-2 py-1 rounded", children: "Dismiss" }), _jsx(Button, { size: "sm", variant: "default", disabled: accepting === s.id, onClick: () => handleAccept(s), className: "h-7 text-xs font-medium", children: accepting === s.id ? "Saving…" : "Accept into Memory" })] })] })] }, s.id))) }))] }));
}
function History() {
    const [commits, setCommits] = useState([]);
    const [shown, setShown] = useState(null);
    useEffect(() => {
        api.memoryHistory().then((r) => setCommits(r.commits), () => undefined);
    }, []);
    return (_jsxs("div", { className: "flex min-h-0 flex-1", children: [_jsxs("div", { className: "scroll-thin w-[420px] shrink-0 overflow-y-auto border-r", children: [commits.map((c) => (_jsxs("div", { className: "border-b px-4 py-3", children: [_jsxs("div", { className: "flex items-baseline gap-2", children: [c.message.startsWith("dream:") ? _jsx(Sparkles, { className: "size-3.5 shrink-0 text-dot" }) : null, _jsx("span", { className: "min-w-0 flex-1", children: c.message.replace(/^dream:\s*/, "") }), _jsx("span", { className: "shrink-0 text-[12px] text-muted-foreground", children: ago(c.ts) })] }), _jsx("div", { className: "mt-1 text-[12px] text-muted-foreground", children: c.author }), _jsx("div", { className: "mt-1.5 flex flex-wrap gap-1", children: c.changes.map((ch) => (_jsxs("button", { onClick: () => void api.memoryFile(ch.path, ch.to).then(setShown), className: "rounded border px-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground", children: [ch.deleted ? "−" : ch.from ? "~" : "+", " ", ch.path] }, ch.path))) })] }, c.seq))), !commits.length ? _jsx("p", { className: "p-6 text-muted-foreground", children: "No changes yet." }) : null] }), _jsx("div", { className: "scroll-thin min-w-0 flex-1 overflow-y-auto px-8 py-6", children: shown ? (_jsxs(_Fragment, { children: [_jsxs("p", { className: "mb-4 font-mono text-[11px] text-muted-foreground", children: [shown.path, " \u00B7 as of v", shown.version] }), shown.text ? _jsx(Markdown, { text: shown.text }) : _jsx("p", { className: "text-muted-foreground", children: "Deleted in this version." })] })) : (_jsx("p", { className: "text-muted-foreground", children: "Pick a file in a change to see it as it was." })) })] }));
}
function Dreams() {
    const [list, setList] = useState([]);
    const [running, setRunning] = useState(null);
    const [cfg, setCfg] = useState(null);
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
    return (_jsx("div", { className: "scroll-thin min-h-0 flex-1 overflow-y-auto px-8 py-6", children: _jsxs("div", { className: "flex w-full max-w-5xl flex-col gap-4", children: [_jsxs("div", { className: "flex items-start gap-3 rounded-xl border bg-muted/40 p-4", children: [_jsx(Moon, { className: "mt-0.5 size-4 text-dot" }), _jsxs("div", { className: "flex-1", children: [_jsx("p", { className: "font-medium", children: "Dreaming tidies the team's memory" }), _jsx("p", { className: "text-muted-foreground", children: "It reads what your agents talked about since the last dream, saves what's durable, merges duplicates and drops what's outdated. It runs every 4 hours on the admin's board when there's something new, or now." }), cfg && !cfg.hasKey ? (_jsxs("form", { className: "mt-3 flex gap-2", onSubmit: (e) => (e.preventDefault(), void api.saveSettings({ openrouterKey: key, dreamModel: model }).then(load, (er) => setError(String(er.message)))), children: [_jsx("input", { type: "password", value: key, onChange: (e) => setKey(e.target.value), placeholder: "OpenRouter key (sk-or-\u2026)", className: "h-8 flex-1 rounded-md border bg-background px-2 outline-none focus:border-ring" }), _jsx(Button, { size: "sm", type: "submit", disabled: !key.trim(), children: "Save" })] })) : (_jsxs("div", { className: "mt-3 flex items-center gap-2", children: [_jsxs(Button, { size: "sm", onClick: () => void start(), disabled: Boolean(running), children: [_jsx(Sparkles, {}), " ", running ? "Dreaming…" : "Dream now"] }), _jsx("input", { value: model, onChange: (e) => setModel(e.target.value), onBlur: () => void api.saveSettings({ dreamModel: model }), className: "h-8 w-64 rounded-md border bg-background px-2 font-mono text-[12px] outline-none focus:border-ring", title: "The model dreams use (any OpenRouter model)" }), cfg?.lastDream ? _jsxs("span", { className: "text-muted-foreground", children: ["last ", ago(cfg.lastDream)] }) : null] })), error ? _jsx("p", { className: "mt-2 text-destructive", children: error }) : null] })] }), running ? (_jsxs("div", { className: "rounded-xl border p-4 font-mono text-[12px]", children: [running.log.map((l, i) => (_jsxs("div", { className: l.kind === "write" ? "text-foreground" : "text-muted-foreground", children: [l.kind === "write" ? "✎" : "·", " ", l.text] }, i))), _jsx("div", { className: "text-muted-foreground", children: "\u2026" })] })) : null, list.map((d) => (_jsxs("div", { className: "rounded-xl border p-4", children: [_jsxs("div", { className: "flex items-baseline gap-2", children: [_jsx("span", { className: cn("size-2 shrink-0 rounded-full", d.ok ? "bg-online" : "bg-waiting") }), _jsx("span", { className: "flex-1", children: d.ok ? d.message : d.reason }), _jsx("span", { className: "text-[12px] text-muted-foreground", children: ago(d.ts) })] }), _jsxs("p", { className: "mt-1 text-[12px] text-muted-foreground", children: [d.inbox, " new message", d.inbox === 1 ? "" : "s", " \u00B7 ", d.steps, " steps \u00B7 ", (d.ms / 1000).toFixed(0), "s", d.cost ? ` · $${d.cost.toFixed(4)}` : "", " \u00B7 ", d.model] }), d.changes.length ? _jsx("div", { className: "mt-2 flex flex-wrap gap-1", children: d.changes.map((c) => _jsx("span", { className: "rounded border px-1.5 font-mono text-[11px] text-muted-foreground", children: c }, c)) }) : null] }, d.ts)))] }) }));
}
/** Memory: the team's shared, linked notes. Files · History · Dreams. */
export function MemoryView({ onTalk }) {
    const [tab, setTab] = useState("files");
    return (_jsxs("div", { className: "flex min-h-0 flex-1 flex-col", children: [_jsx("div", { className: "flex h-10 shrink-0 items-center gap-1 border-b px-3", children: ["files", "history"].map((t) => (_jsx("button", { onClick: () => setTab(t), className: cn("h-7 rounded-md px-3 capitalize text-muted-foreground hover:text-foreground", tab === t && "bg-accent text-foreground"), children: t }, t))) }), tab === "files" ? _jsx(Files, { onTalk: onTalk }) : tab === "history" ? _jsx(History, {}) : _jsx(Dreams, {})] }));
}
