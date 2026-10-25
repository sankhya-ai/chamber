import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Check, ChevronDown, ChevronRight, Copy, GitBranch, GitCommit, Play } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
export function PatchCard({ patch, branch, title }) {
    const [open, setOpen] = useState(true);
    const [verifying, setVerifying] = useState(false);
    const [verification, setVerification] = useState(null);
    const [copied, setCopied] = useState(false);
    const [applying, setApplying] = useState(false);
    const [applied, setApplied] = useState(false);
    const [applyError, setApplyError] = useState("");
    const lines = patch.split("\n");
    const additions = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
    const deletions = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
    const handleVerify = async () => {
        setVerifying(true);
        setApplyError("");
        try {
            const res = await api.reviewPatch(patch);
            setVerification(res);
        }
        catch (err) {
            setVerification({ appliesCleanly: false, stat: "", error: err?.message || "Verification failed" });
        }
        finally {
            setVerifying(false);
        }
    };
    const handleApply = async () => {
        setApplying(true);
        setApplyError("");
        try {
            const res = await api.applyPatch(patch);
            if (res.success) {
                setApplied(true);
            }
            else {
                setApplyError(res.output || "Failed to apply");
            }
        }
        catch (err) {
            setApplyError(err?.message || "Failed to apply patch");
        }
        finally {
            setApplying(false);
        }
    };
    const handleCopy = () => {
        navigator.clipboard.writeText(patch);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (_jsxs("div", { className: "my-2 overflow-hidden rounded-lg border bg-muted/30 text-xs shadow-sm", children: [_jsxs("div", { className: "flex items-center justify-between border-b bg-muted/60 px-3 py-2", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("button", { onClick: () => setOpen((v) => !v), className: "flex items-center gap-1.5 font-medium text-foreground hover:text-foreground/80", children: [open ? _jsx(ChevronDown, { className: "size-3.5" }) : _jsx(ChevronRight, { className: "size-3.5" }), _jsx(GitCommit, { className: "size-3.5 text-muted-foreground" }), _jsx("span", { children: title || "Unified Git Patch" })] }), branch ? (_jsxs("span", { className: "inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[11px] text-accent-foreground font-mono", children: [_jsx(GitBranch, { className: "size-3" }), branch] })) : null, _jsxs("span", { className: "text-[11px] font-mono text-emerald-500 font-semibold", children: ["+", additions] }), _jsxs("span", { className: "text-[11px] font-mono text-rose-500 font-semibold", children: ["-", deletions] })] }), _jsxs("div", { className: "flex items-center gap-1.5", children: [verification?.appliesCleanly && !applied ? (_jsxs(Button, { size: "sm", variant: "default", disabled: applying, onClick: handleApply, className: "h-6 px-2 text-[11px] gap-1 font-medium", children: [_jsx(Check, { className: "size-3" }), applying ? "Applying..." : "Apply to Worktree"] })) : null, applied ? (_jsxs("span", { className: "text-[11px] font-semibold text-[#36634d] dark:text-[#a8cbbb] flex items-center gap-1 px-1", children: [_jsx(Check, { className: "size-3" }), " Applied"] })) : null, _jsxs(Button, { size: "sm", variant: "outline", disabled: verifying, onClick: handleVerify, className: "h-6 px-2 text-[11px] gap-1", children: [_jsx(Play, { className: "size-3" }), verifying ? "Checking..." : "Verify Patch"] }), _jsx(Button, { size: "sm", variant: "ghost", onClick: handleCopy, className: "h-6 px-1.5 text-muted-foreground hover:text-foreground", title: "Copy Raw Diff", children: copied ? _jsx(Check, { className: "size-3 text-[#36634d] dark:text-[#a8cbbb]" }) : _jsx(Copy, { className: "size-3" }) })] })] }), verification ? (_jsxs("div", { className: `border-b px-3 py-1.5 text-[11px] flex items-center justify-between ${verification.appliesCleanly
                    ? "bg-[#a8cbbb]/15 text-[#36634d] dark:text-[#a8cbbb]"
                    : "bg-destructive/10 text-destructive"}`, children: [_jsx("span", { children: verification.appliesCleanly
                            ? "✔ Patch applies cleanly to local working tree."
                            : `✖ Conflict: ${verification.error || "Patch does not apply cleanly."}` }), verification.stat ? _jsx("span", { className: "font-mono text-[10px]", children: verification.stat.trim() }) : null] })) : null, applyError ? (_jsx("div", { className: "border-b px-3 py-1.5 text-[11px] bg-destructive/10 text-destructive font-mono", children: applyError })) : null, open ? (_jsx("div", { className: "max-h-64 overflow-y-auto bg-background/50 font-mono text-[11px] leading-tight", children: lines.map((line, idx) => {
                    const isAdd = line.startsWith("+") && !line.startsWith("+++");
                    const isDel = line.startsWith("-") && !line.startsWith("---");
                    const isHunk = line.startsWith("@@");
                    const isFile = line.startsWith("diff --git") || line.startsWith("---") || line.startsWith("+++");
                    return (_jsxs("div", { className: `flex px-2 py-0.5 ${isAdd
                            ? "bg-[#a8cbbb]/20 text-[#36634d] dark:text-[#a8cbbb]"
                            : isDel
                                ? "bg-muted/70 text-muted-foreground"
                                : isHunk
                                    ? "bg-[#8db8d5]/15 text-[#356f96] dark:text-[#8db8d5] font-semibold"
                                    : isFile
                                        ? "text-muted-foreground font-semibold"
                                        : "text-foreground/80"}`, children: [_jsx("span", { className: "w-8 shrink-0 select-none text-muted-foreground/60", children: idx + 1 }), _jsx("span", { className: "select-text whitespace-pre-wrap break-all", children: line || " " })] }, idx));
                }) })) : null] }));
}
