import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Bot, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
const PRESETS = [
    "In a meeting",
    "At lunch",
    "Deep work",
    "On vacation",
];
export function AwayDialog({ open, onOpenChange, me, onChanged }) {
    const [running, setRunning] = useState(false);
    const [status, setStatus] = useState("in a meeting");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        if (open) {
            api.awayStatus().then((s) => {
                setRunning(s.running);
                if (s.status)
                    setStatus(s.status);
            }).catch(() => { });
        }
    }, [open]);
    const handleToggle = async (nextState) => {
        setLoading(true);
        setError("");
        try {
            const res = await api.setAway(nextState, status.trim() || "away from desk");
            setRunning(res.running);
            if (res.status)
                setStatus(res.status);
            onChanged?.();
            onOpenChange(false);
        }
        catch (err) {
            setError(err?.message || "Failed to update away status");
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsx(Dialog, { open: open, onOpenChange: onOpenChange, children: _jsxs(DialogContent, { className: "max-w-md", children: [_jsxs(DialogHeader, { children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Bot, { className: "size-5 text-foreground" }), _jsx(DialogTitle, { children: "Away Mode Responder" })] }), _jsxs(DialogDescription, { children: ["Let your personal agent (", _jsxs("code", { children: ["@", me, "/away"] }), ") answer teammates and coding agents from local repo memory while you are away."] })] }), _jsxs("div", { className: "flex flex-col gap-4 py-2", children: [_jsxs("div", { className: "rounded-xl border bg-muted/20 p-3.5 space-y-1", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: cn("size-2.5 rounded-full", running ? "bg-[#8db8d5] animate-pulse" : "bg-[#a8cbbb]") }), _jsx("span", { className: "text-xs font-semibold text-foreground", children: running ? "Away Mode is Currently Active" : "You are Currently Active & Available" })] }), _jsx("p", { className: "text-[11px] text-muted-foreground pl-4.5", children: running
                                        ? `@${me}/away is auto-answering questions from your local codebase.`
                                        : "You receive all notifications and mentions normally." })] }), _jsxs("div", { className: "flex flex-col gap-2", children: [_jsx("label", { className: "text-xs font-medium text-foreground", children: running ? "Current Away Note" : "Away Note (shown to teammates)" }), _jsx("input", { value: status, onChange: (e) => setStatus(e.target.value), placeholder: "e.g. In a meeting, Deep work until 4pm...", className: "h-8.5 rounded-md border bg-background px-3 text-xs text-foreground outline-none focus:border-ring transition-colors" }), _jsxs("div", { className: "flex flex-wrap items-center gap-1.5 pt-0.5", children: [_jsx("span", { className: "text-[10px] text-muted-foreground mr-1", children: "Presets:" }), PRESETS.map((p) => (_jsx("button", { type: "button", onClick: () => setStatus(p), className: cn("rounded-md border px-2 py-0.5 text-[11px] transition-colors", status === p
                                                ? "bg-primary text-primary-foreground font-medium border-primary"
                                                : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border-border/70"), children: p }, p)))] })] }), error ? _jsx("p", { className: "text-xs text-destructive", children: error }) : null, _jsxs("div", { className: "rounded-lg border bg-muted/20 p-2.5 text-xs text-muted-foreground flex items-center gap-2", children: [_jsx(Sparkles, { className: "size-3.5 text-muted-foreground shrink-0" }), _jsx("span", { children: "Responses run locally on your machine with zero key leaks." })] })] }), _jsxs(DialogFooter, { className: "gap-2 sm:justify-between", children: [_jsx(Button, { variant: "outline", size: "sm", onClick: () => onOpenChange(false), className: "h-8 text-xs", children: "Cancel" }), _jsx("div", { className: "flex items-center gap-2", children: running ? (_jsxs(_Fragment, { children: [_jsx(Button, { size: "sm", variant: "outline", disabled: loading, onClick: () => handleToggle(true), className: "h-8 text-xs", children: loading ? "Updating..." : "Update Note" }), _jsx(Button, { size: "sm", variant: "default", disabled: loading, onClick: () => handleToggle(false), className: "h-8 text-xs font-medium", children: loading ? "Turning off..." : "Set as Active (I'm Back)" })] })) : (_jsx(Button, { size: "sm", variant: "default", disabled: loading, onClick: () => handleToggle(true), className: "h-8 text-xs font-medium", children: loading ? "Activating..." : "Set as Away" })) })] })] }) }));
}
