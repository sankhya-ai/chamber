import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Bot, Folder, Plus, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { KIND } from "@/lib/board";
import { cn } from "@/lib/utils";
export function AgentInspectorDialog({ open, onOpenChange, data, onChanged, }) {
    const [adding, setAdding] = useState(false);
    const [note, setNote] = useState("");
    const addProject = async () => {
        setAdding(true);
        setNote("");
        try {
            const picked = await api.pickFolder();
            if (!picked.path)
                return;
            await api.addWorkspace(picked.path);
            setNote(`Added ${picked.path.split("/").pop()}. Restart your coding agents in that folder to connect.`);
            onChanged();
        }
        catch (e) {
            setNote(e?.message || "Failed to add folder");
        }
        finally {
            setAdding(false);
        }
    };
    const removeProject = async (path, name) => {
        try {
            await api.removeWorkspace(path);
            setNote(`Removed ${name} from chamber.`);
            onChanged();
        }
        catch (e) {
            setNote(e?.message || "Failed to remove folder");
        }
    };
    const projects = data?.projects || [];
    return (_jsx(Dialog, { open: open, onOpenChange: onOpenChange, children: _jsxs(DialogContent, { className: "max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden", children: [_jsxs(DialogHeader, { className: "px-6 py-4 border-b flex-row items-center justify-between", children: [_jsxs("div", { children: [_jsxs(DialogTitle, { className: "flex items-center gap-2 text-base font-semibold", children: [_jsx(Bot, { className: "size-4 text-primary" }), "Connected Coding Agents & Workspaces"] }), _jsx("p", { className: "text-xs text-muted-foreground mt-0.5", children: "Agents running in your local environments, collaborating across teammates" })] }), _jsxs(Button, { size: "sm", onClick: addProject, disabled: adding, className: "gap-1.5 text-xs h-8", children: [_jsx(Plus, { className: "size-3.5" }), " Add Project Folder"] })] }), note ? (_jsxs("div", { className: "mx-6 mt-3 rounded border border-primary/30 bg-primary/10 p-2.5 text-xs text-primary flex items-center justify-between", children: [_jsx("span", { children: note }), _jsx("button", { onClick: () => setNote(""), className: "text-xs font-semibold hover:opacity-80", children: _jsx(X, { className: "size-3" }) })] })) : null, _jsxs("div", { className: "flex-1 overflow-y-auto px-6 py-4 space-y-4", children: [_jsxs("div", { className: "rounded-lg border bg-muted/20 p-3.5 text-xs space-y-1.5", children: [_jsxs("div", { className: "flex items-center gap-1.5 font-medium text-foreground", children: [_jsx(ShieldCheck, { className: "size-4 text-[#36634d] dark:text-[#a8cbbb]" }), _jsx("span", { children: "Local Execution & Existing Permissions" })] }), _jsx("p", { className: "text-muted-foreground leading-relaxed", children: "Claude Code, Codex, and Antigravity run on your computer inside their respective projects. Chamber coordinates messages and task lifecycles through your team's Cloudflare relay without executing remote code on anyone's machine." })] }), _jsxs("div", { className: "space-y-3", children: [_jsxs("h3", { className: "text-xs font-semibold text-muted-foreground uppercase tracking-wider", children: ["Workspaces (", projects.length, ")"] }), !projects.length ? (_jsx("div", { className: "py-8 text-center text-xs text-muted-foreground rounded-lg border border-dashed p-6", children: "No workspace folders added yet. Click \"Add Project Folder\" to put your coding agents in the chamber." })) : (projects.map((p) => {
                                    const online = p.agents.some((a) => a.online);
                                    return (_jsxs("div", { className: "rounded-xl border bg-card p-4 space-y-3 shadow-2xs", children: [_jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "space-y-0.5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Folder, { className: cn("size-4", online ? "text-[#36634d] dark:text-[#a8cbbb]" : "text-muted-foreground") }), _jsx("h4", { className: "font-semibold text-xs text-foreground", children: p.name }), _jsx("span", { className: cn("rounded px-1.5 py-0.5 text-[10px] font-mono", online
                                                                            ? "bg-[#a8cbbb]/20 text-[#36634d] dark:text-[#a8cbbb] font-medium"
                                                                            : "bg-muted text-muted-foreground"), children: online ? "active" : "offline" })] }), p.path ? (_jsx("p", { className: "text-[11px] font-mono text-muted-foreground pl-6 truncate max-w-md", children: p.path })) : null] }), p.path ? (_jsx(Button, { size: "sm", variant: "ghost", onClick: () => removeProject(p.path, p.name), className: "h-7 px-2 text-xs text-destructive hover:bg-destructive/10", children: "Remove" })) : null] }), _jsx("div", { className: "pl-6 flex flex-wrap gap-2 pt-1 border-t border-border/40", children: p.agents.map((a) => {
                                                    const label = KIND[a.kind] ?? a.kind;
                                                    return (_jsxs("div", { className: cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs", a.online
                                                            ? "bg-[#a8cbbb]/15 border-[#a8cbbb]/30 text-[#36634d] dark:text-[#a8cbbb] font-medium"
                                                            : "bg-muted/40 border-border text-muted-foreground"), children: [_jsx("span", { className: cn("size-1.5 rounded-full", a.online ? "bg-[#a8cbbb] animate-pulse" : "bg-muted-foreground/40") }), _jsx("span", { children: label }), _jsxs("span", { className: "text-[10px] text-muted-foreground font-mono", children: ["(", a.agent.split("/")[1], ")"] })] }, a.agent));
                                                }) })] }, p.path || p.name));
                                }))] })] })] }) }));
}
