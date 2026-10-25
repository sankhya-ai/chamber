import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Clock, Code, FileText, Lock, ShieldAlert, ShieldCheck, Terminal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ago, ownerOf } from "@/lib/board";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
export function GateCard({ gateId, description, action, requestedBy = "", expiresAt, createdAt, resolvedAt, resolvedBy, lineId, initialStatus = "pending", me = "", onResolved, }) {
    const [status, setStatus] = useState(initialStatus);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [showDiff, setShowDiff] = useState(false);
    const [timeLeft, setTimeLeft] = useState("");
    // Countdown timer
    useEffect(() => {
        if (!expiresAt || status !== "pending")
            return;
        const updateTimer = () => {
            const remaining = expiresAt - Date.now();
            if (remaining <= 0) {
                setTimeLeft("Expired");
                setStatus("expired");
                return;
            }
            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            setTimeLeft(`${minutes}m ${seconds.toString().padStart(2, "0")}s`);
        };
        updateTimer();
        const interval = setInterval(updateTimer, 1000);
        return () => clearInterval(interval);
    }, [expiresAt, status]);
    const handleDecision = async (decision) => {
        setLoading(true);
        setError("");
        try {
            const res = await api.resolveGate(gateId, decision);
            setStatus(res.gate.status);
            onResolved?.(res.gate);
        }
        catch (err) {
            setError(err?.message || "Failed to resolve gate");
        }
        finally {
            setLoading(false);
        }
    };
    const actionObj = typeof action === "object" ? action : null;
    const command = actionObj?.command || (typeof action === "string" ? action : "");
    const diff = actionObj?.diff;
    const files = actionObj?.files || [];
    const environment = actionObj?.environment || "local worktree";
    const approvers = actionObj?.approvers || [];
    // Check self-approval policy: if requester's owner is the same as current logged in user
    const isSelfRequest = me && requestedBy && ownerOf(requestedBy) === me;
    return (_jsxs("div", { className: "my-2.5 rounded-lg border bg-card p-3.5 shadow-sm transition-all hover:border-border/80", children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { className: "flex items-center gap-2", children: [status === "approved" ? (_jsx(ShieldCheck, { className: "size-4.5 text-emerald-500 shrink-0" })) : status === "rejected" ? (_jsx(X, { className: "size-4.5 text-destructive shrink-0" })) : (_jsx(ShieldAlert, { className: "size-4.5 text-foreground shrink-0" })), _jsx("div", { children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-[13px] font-semibold tracking-tight", children: "Approval Gate" }), _jsx("span", { className: "font-mono text-[11px] text-muted-foreground bg-muted px-1.5 py-0.2 rounded", children: gateId.slice(0, 8) })] }) })] }), _jsxs("div", { className: "flex items-center gap-2", children: [timeLeft && status === "pending" ? (_jsxs("span", { className: "flex items-center gap-1 text-[11px] text-muted-foreground font-mono", children: [_jsx(Clock, { className: "size-3" }), timeLeft] })) : null, _jsx("span", { className: cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", status === "approved"
                                    ? "bg-[#a8cbbb]/20 text-[#36634d] dark:text-[#a8cbbb]"
                                    : status === "rejected"
                                        ? "bg-destructive/10 text-destructive"
                                        : "bg-muted text-foreground"), children: status })] })] }), _jsx("p", { className: "mt-2 text-[13px] font-medium text-foreground/95 leading-relaxed", children: description || "Action paused pending human verification." }), command ? (_jsxs("div", { className: "mt-2 rounded-md bg-muted/70 p-2 font-mono text-[12px] border border-border/50 text-foreground", children: [_jsxs("div", { className: "flex items-center gap-1.5 text-muted-foreground text-[10px] uppercase font-semibold tracking-wider mb-1", children: [_jsx(Terminal, { className: "size-3" }), " Target Command"] }), _jsxs("code", { className: "text-foreground break-all select-all font-mono", children: ["$ ", command] })] })) : null, files.length > 0 ? (_jsxs("div", { className: "mt-2 flex flex-wrap items-center gap-1.5", children: [_jsx("span", { className: "text-[11px] text-muted-foreground", children: "Files touched:" }), files.map((f) => (_jsxs("span", { className: "inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-foreground", children: [_jsx(FileText, { className: "size-2.5 text-muted-foreground" }), " ", f] }, f)))] })) : null, diff ? (_jsxs("div", { className: "mt-2", children: [_jsxs("button", { onClick: () => setShowDiff((v) => !v), className: "flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground", children: [showDiff ? _jsx(ChevronDown, { className: "size-3" }) : _jsx(ChevronRight, { className: "size-3" }), _jsx(Code, { className: "size-3" }), _jsx("span", { children: showDiff ? "Hide changes" : "View proposed diff" })] }), showDiff ? (_jsx("pre", { className: "mt-1.5 max-h-48 overflow-y-auto rounded bg-muted/60 p-2 font-mono text-[11px] text-muted-foreground border", children: diff })) : null] })) : null, _jsxs("div", { className: "mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground", children: [_jsxs("span", { children: ["Target: ", _jsx("strong", { className: "font-mono text-foreground", children: environment })] }), lineId ? _jsxs("span", { children: ["\u00B7 Chamber Line: ", _jsx("strong", { className: "font-mono text-foreground", children: lineId.slice(0, 10) })] }) : null, approvers.length > 0 ? _jsxs("span", { children: ["\u00B7 Policy approvers: ", _jsx("strong", { className: "font-mono text-foreground", children: approvers.join(", ") })] }) : null] }), isSelfRequest && status === "pending" ? (_jsxs("div", { className: "mt-2 flex items-center gap-1.5 rounded-lg bg-muted/40 border px-2.5 py-1.5 text-[11px] text-muted-foreground", children: [_jsx(AlertTriangle, { className: "size-3.5 shrink-0 text-muted-foreground" }), _jsxs("span", { children: [_jsx("strong", { children: "Self-Approval Policy:" }), " Requested by your agent (", requestedBy, "). Standard policy recommends approval by a second teammate."] })] })) : null, error ? _jsx("p", { className: "mt-2 text-[11px] text-destructive font-medium", children: error }) : null, status === "pending" ? (_jsxs("div", { className: "mt-3 flex items-center gap-2 pt-2 border-t border-border/40", children: [_jsxs(Button, { size: "sm", variant: "default", disabled: loading, onClick: () => handleDecision("approve"), className: "h-8 px-3.5 text-xs font-medium", children: [_jsx(Check, { className: "mr-1.5 size-3.5" }), " Approve Action"] }), _jsxs(Button, { size: "sm", variant: "outline", disabled: loading, onClick: () => handleDecision("reject"), className: "h-8 px-3 text-xs", children: [_jsx(X, { className: "mr-1.5 size-3.5" }), " Reject"] })] })) : null, _jsxs("div", { className: "mt-2.5 flex items-center justify-between text-[10px] text-muted-foreground/75 border-t border-border/30 pt-1.5 font-mono", children: [_jsxs("span", { className: "flex items-center gap-1", children: [_jsx(Lock, { className: "size-2.5 text-emerald-500" }), _jsx("span", { children: "E2EE Sealed \u00B7 Ed25519 Verified" })] }), _jsx("span", { children: status === "pending"
                            ? `Requested by ${requestedBy || "agent"}${createdAt ? ` · ${ago(createdAt)}` : ""}`
                            : `Resolved by ${resolvedBy || "admin"} ${resolvedAt ? ago(resolvedAt) : ""}` })] })] }));
}
