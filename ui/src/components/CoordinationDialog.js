import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Bot, Check, GitBranch, Layers, Sparkles, ArrowRight, ShieldCheck, Cpu } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
// Strict 4 Tura Pastel Colors
// Blue: #8db8d5, Mint: #a8cbbb, Lilac: #c5b4e3, Sand: #dfd7ca
const OP_COLORS = {
    ask: "bg-[#8db8d5]/15 text-[#356f96] dark:text-[#8db8d5] border-[#8db8d5]/30",
    delegate: "bg-[#c5b4e3]/15 text-[#604988] dark:text-[#c5b4e3] border-[#c5b4e3]/30",
    review: "bg-[#dfd7ca]/30 text-[#685c4a] dark:text-[#dfd7ca] border-[#dfd7ca]/40",
    propose: "bg-[#8db8d5]/15 text-[#356f96] dark:text-[#8db8d5] border-[#8db8d5]/30",
    resolve: "bg-[#a8cbbb]/20 text-[#36634d] dark:text-[#a8cbbb] border-[#a8cbbb]/30",
    handoff: "bg-[#c5b4e3]/15 text-[#604988] dark:text-[#c5b4e3] border-[#c5b4e3]/30",
};
const STATUS_BADGES = {
    requested: "bg-[#8db8d5]/15 text-[#356f96] dark:text-[#8db8d5]",
    claimed: "bg-[#8db8d5]/20 text-[#356f96] dark:text-[#8db8d5]",
    in_progress: "bg-[#c5b4e3]/20 text-[#604988] dark:text-[#c5b4e3]",
    resolved: "bg-[#a8cbbb]/25 text-[#36634d] dark:text-[#a8cbbb]",
    rejected: "bg-muted text-muted-foreground",
    timed_out: "bg-muted text-muted-foreground",
};
export function CoordinationDialog({ open, onOpenChange, me, }) {
    const [tasks, setTasks] = useState([]);
    const [quota, setQuota] = useState(null);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState("all");
    const [resolvingId, setResolvingId] = useState(null);
    const [resolutionText, setResolutionText] = useState("");
    const [acting, setActing] = useState(false);
    const load = async () => {
        setLoading(true);
        try {
            const [taskRes, quotaRes] = await Promise.all([
                api.coordinationTasks(),
                api.quota().catch(() => null),
            ]);
            setTasks(taskRes.tasks || []);
            setQuota(quotaRes);
        }
        catch { }
        setLoading(false);
    };
    useEffect(() => {
        if (open)
            void load();
    }, [open]);
    const filteredTasks = tasks.filter((t) => {
        if (filter === "all")
            return true;
        if (filter === "active")
            return t.status === "requested" || t.status === "claimed" || t.status === "in_progress";
        return t.status === filter;
    });
    const activeCount = tasks.filter((t) => t.status === "requested" || t.status === "claimed" || t.status === "in_progress").length;
    const completedCount = tasks.filter((t) => t.status === "resolved").length;
    const declinedCount = tasks.filter((t) => t.status === "rejected").length;
    const handleClaim = async (id) => {
        setActing(true);
        try {
            await api.claimCoordination(id, `${me}/board`);
            await load();
        }
        finally {
            setActing(false);
        }
    };
    const handleResolve = async (id) => {
        if (!resolutionText.trim())
            return;
        setActing(true);
        try {
            await api.resolveCoordination(id, resolutionText.trim());
            setResolvingId(null);
            setResolutionText("");
            await load();
        }
        finally {
            setActing(false);
        }
    };
    const handleReject = async (id) => {
        setActing(true);
        try {
            await api.rejectCoordination(id, "Declined from desktop app");
            await load();
        }
        finally {
            setActing(false);
        }
    };
    return (_jsx(Dialog, { open: open, onOpenChange: onOpenChange, children: _jsxs(DialogContent, { className: "w-[820px] max-w-[94vw] sm:max-w-[820px] h-[600px] max-h-[85vh] flex flex-col p-0 overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl", children: [_jsxs(DialogHeader, { className: "px-6 py-4 border-b flex-row items-center justify-between", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs(DialogTitle, { className: "flex items-center gap-2 text-base font-semibold text-foreground", children: [_jsx(Cpu, { className: "size-4 text-primary" }), "Agent Tasks"] }), _jsx("span", { className: "rounded-full bg-[#c5b4e3]/20 px-2 py-0.5 text-[10px] font-medium text-[#604988] dark:text-[#c5b4e3]", children: "Workflows & Delegations" })] }), _jsx("p", { className: "text-xs text-muted-foreground mt-0.5", children: "Automated work, code reviews, and delegations between your AI teammates" })] }), quota ? (_jsxs("div", { className: "flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-[11px] font-mono", children: [_jsx("span", { className: cn("size-2 rounded-full", quota.warning ? "bg-primary" : "bg-[#a8cbbb]") }), _jsxs("span", { children: ["DO: ", quota.dailyRequests.toLocaleString(), " / ", quota.dailyRequestsLimit.toLocaleString(), " reqs"] })] })) : null] }), _jsxs("div", { className: "grid grid-cols-3 divide-x border-b bg-muted/15 text-xs", children: [_jsxs("div", { className: "px-4 py-2.5 flex items-center gap-2", children: [_jsx("span", { className: "size-5 rounded-full bg-[#8db8d5]/20 text-[#356f96] dark:text-[#8db8d5] flex items-center justify-center font-bold text-[10px]", children: "1" }), _jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "font-medium text-foreground text-[11px] truncate", children: "Cross-Repo Delegations" }), _jsx("p", { className: "text-[10px] text-muted-foreground truncate", children: "Agents hand off sub-tasks" })] })] }), _jsxs("div", { className: "px-4 py-2.5 flex items-center gap-2", children: [_jsx("span", { className: "size-5 rounded-full bg-[#c5b4e3]/20 text-[#604988] dark:text-[#c5b4e3] flex items-center justify-center font-bold text-[10px]", children: "2" }), _jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "font-medium text-foreground text-[11px] truncate", children: "Automated Reviews" }), _jsx("p", { className: "text-[10px] text-muted-foreground truncate", children: "Diffs & contract verification" })] })] }), _jsxs("div", { className: "px-4 py-2.5 flex items-center gap-2", children: [_jsx("span", { className: "size-5 rounded-full bg-[#a8cbbb]/25 text-[#36634d] dark:text-[#a8cbbb] flex items-center justify-center font-bold text-[10px]", children: "3" }), _jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "font-medium text-foreground text-[11px] truncate", children: "Team Memory" }), _jsx("p", { className: "text-[10px] text-muted-foreground truncate", children: "Outcomes recorded to repo" })] })] })] }), _jsx("div", { className: "flex items-center gap-1.5 px-6 py-2.5 border-b bg-muted/20 text-xs", children: [
                        { id: "all", label: "All Tasks", count: tasks.length },
                        { id: "active", label: "In Progress", count: activeCount },
                        { id: "resolved", label: "Completed", count: completedCount },
                        { id: "rejected", label: "Declined", count: declinedCount },
                    ].map((f) => (_jsxs("button", { onClick: () => setFilter(f.id), className: cn("rounded-md px-3 py-1 transition-colors font-medium text-xs flex items-center gap-1.5", filter === f.id
                            ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"), children: [_jsx("span", { children: f.label }), _jsx("span", { className: cn("rounded-full px-1.5 py-0.2 text-[10px] font-mono", filter === f.id
                                    ? "bg-primary-foreground/20 text-primary-foreground"
                                    : "bg-muted text-muted-foreground"), children: f.count })] }, f.id))) }), _jsx("div", { className: "flex-1 overflow-y-auto px-6 py-4 space-y-3", children: loading && !tasks.length ? (_jsx("div", { className: "py-12 text-center text-xs text-muted-foreground", children: "Loading tasks\u2026" })) : !filteredTasks.length ? (_jsxs("div", { className: "py-8 text-center flex flex-col items-center justify-center max-w-lg mx-auto", children: [_jsx("div", { className: "size-12 rounded-2xl bg-[#c5b4e3]/20 flex items-center justify-center text-[#604988] dark:text-[#c5b4e3] mb-3 shadow-xs", children: _jsx(Bot, { className: "size-6" }) }), _jsx("h3", { className: "text-sm font-semibold text-foreground", children: filter === "all" ? "No active agent tasks yet" : `No ${filter} tasks` }), _jsx("p", { className: "text-xs text-muted-foreground mt-1 max-w-md leading-relaxed", children: "Chamber coordinates background work between Claude Code, Codex, and Antigravity so you don't have to monitor agent chats. When an agent delegates a task or proposes a diff, it appears here." }), _jsxs("div", { className: "mt-6 grid grid-cols-1 sm:grid-cols-3 gap-2.5 w-full text-left", children: [_jsxs("div", { className: "rounded-xl border border-border/80 bg-card p-3 shadow-2xs", children: [_jsx("div", { className: "size-6 rounded-md bg-[#8db8d5]/20 text-[#356f96] dark:text-[#8db8d5] flex items-center justify-center mb-2", children: _jsx(Sparkles, { className: "size-3.5" }) }), _jsx("h4", { className: "text-[11px] font-semibold text-foreground", children: "Mention in Chat" }), _jsx("p", { className: "text-[10px] text-muted-foreground mt-0.5 leading-normal", children: "Ask `@claude coordinate with @codex on API schema`" })] }), _jsxs("div", { className: "rounded-xl border border-border/80 bg-card p-3 shadow-2xs", children: [_jsx("div", { className: "size-6 rounded-md bg-[#c5b4e3]/20 text-[#604988] dark:text-[#c5b4e3] flex items-center justify-center mb-2", children: _jsx(Layers, { className: "size-3.5" }) }), _jsx("h4", { className: "text-[11px] font-semibold text-foreground", children: "Auto-Handoff" }), _jsx("p", { className: "text-[10px] text-muted-foreground mt-0.5 leading-normal", children: "Agents use local MCP tools to delegate subtasks across repos" })] }), _jsxs("div", { className: "rounded-xl border border-border/80 bg-card p-3 shadow-2xs", children: [_jsx("div", { className: "size-6 rounded-md bg-[#a8cbbb]/25 text-[#36634d] dark:text-[#a8cbbb] flex items-center justify-center mb-2", children: _jsx(ShieldCheck, { className: "size-3.5" }) }), _jsx("h4", { className: "text-[11px] font-semibold text-foreground", children: "Track Outcomes" }), _jsx("p", { className: "text-[10px] text-muted-foreground mt-0.5 leading-normal", children: "Review test evidence and commit outcomes in one click" })] })] })] })) : (filteredTasks.map((t) => {
                        const isResolving = resolvingId === t.id;
                        return (_jsxs("div", { className: "rounded-xl border bg-card p-3.5 shadow-2xs hover:border-border transition-all flex flex-col gap-2.5", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx("span", { className: cn("rounded-md border px-1.5 py-0.5 text-[10px] font-mono uppercase font-semibold", OP_COLORS[t.op] || "bg-muted"), children: t.op }), _jsx("span", { className: cn("rounded px-1.5 py-0.5 text-[10px] font-mono capitalize", STATUS_BADGES[t.status] || "bg-muted"), children: t.status.replace("_", " ") }), _jsx("h4", { className: "font-semibold text-xs text-foreground truncate max-w-sm", children: t.title }), t.branch ? (_jsxs("span", { className: "inline-flex items-center gap-1 rounded bg-[#dfd7ca]/30 px-1.5 py-0.5 text-[10px] font-mono text-foreground", children: [_jsx(GitBranch, { className: "size-2.5" }), " ", t.branch] })) : null] }), _jsxs("span", { className: "text-[10px] text-muted-foreground font-mono shrink-0", children: ["#", t.id.slice(0, 8)] })] }), t.description ? (_jsx("p", { className: "text-xs text-muted-foreground/90 whitespace-pre-wrap", children: t.description })) : null, t.resolution ? (_jsxs("div", { className: "rounded-lg bg-[#a8cbbb]/10 border border-[#a8cbbb]/20 p-2.5 text-xs text-foreground", children: [_jsx("span", { className: "font-semibold block mb-0.5 text-[#36634d] dark:text-[#a8cbbb]", children: "\u2714 Outcome:" }), t.resolution] })) : null, isResolving ? (_jsxs("div", { className: "mt-2 flex flex-col gap-2 rounded-lg border bg-muted/30 p-2.5", children: [_jsx("textarea", { autoFocus: true, rows: 2, value: resolutionText, onChange: (e) => setResolutionText(e.target.value), placeholder: "Outcome or findings to commit to team memory...", className: "w-full text-xs rounded-md border bg-background p-2 outline-none focus:border-ring" }), _jsxs("div", { className: "flex items-center justify-end gap-2", children: [_jsx(Button, { size: "sm", variant: "outline", onClick: () => setResolvingId(null), className: "h-8 text-xs", children: "Cancel" }), _jsxs(Button, { size: "sm", variant: "default", disabled: acting || !resolutionText.trim(), onClick: () => handleResolve(t.id), className: "h-8 text-xs gap-1 font-medium", children: [_jsx(Check, { className: "size-3" }), " Commit & Resolve"] })] })] })) : (_jsxs("div", { className: "mt-1 flex items-center justify-between text-[11px] text-muted-foreground pt-2 border-t border-border/50", children: [_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("span", { className: "font-medium text-foreground", children: t.from }), _jsx(ArrowRight, { className: "size-3 text-muted-foreground" }), _jsx("span", { className: "font-medium text-foreground", children: t.to }), t.claimedBy ? (_jsxs("span", { className: "text-[10px] text-muted-foreground", children: ["(", t.claimedBy, ")"] })) : null] }), t.status === "requested" || t.status === "claimed" || t.status === "in_progress" ? (_jsxs("div", { className: "flex items-center gap-1.5", children: [t.status === "requested" ? (_jsx(Button, { size: "sm", variant: "outline", disabled: acting, onClick: () => handleClaim(t.id), className: "h-7 px-2.5 text-xs font-medium", children: "Claim" })) : null, _jsx(Button, { size: "sm", variant: "default", onClick: () => {
                                                        setResolvingId(t.id);
                                                        setResolutionText("");
                                                    }, className: "h-7 px-2.5 text-xs font-medium", children: "Resolve" }), _jsx(Button, { size: "sm", variant: "outline", disabled: acting, onClick: () => handleReject(t.id), className: "h-7 px-2 text-xs", children: "Decline" })] })) : null] }))] }, t.id));
                    })) })] }) }));
}
