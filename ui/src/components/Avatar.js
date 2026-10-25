import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Bot, Sparkles, Terminal } from "lucide-react";
import { harnessOf, hue } from "@/lib/board";
import { cn } from "@/lib/utils";
/** A person's initial on a quiet colour, with an optional presence dot and harness badge for agents. */
export function Avatar({ name, agent, harness: harnessProp, size = 24, online, presence = "online", className, }) {
    const channel = name.startsWith("#");
    const letter = channel ? "#" : (name.replace(/^@/, "")[0] ?? "?").toUpperCase();
    const h = hue(name.toLowerCase());
    const harness = harnessProp ?? (agent ? harnessOf(agent) : null);
    const presenceColor = presence === "running"
        ? "bg-[#8db8d5] animate-pulse"
        : presence === "away"
            ? "bg-[#c5b4e3]"
            : online !== undefined
                ? (online ? "bg-online" : "bg-muted-foreground/40")
                : presence === "online"
                    ? "bg-online"
                    : "bg-muted-foreground/40";
    return (_jsxs("span", { className: cn("relative inline-flex shrink-0", className), style: { width: size, height: size }, children: [_jsx("span", { className: "inline-flex size-full items-center justify-center rounded-full font-medium", style: {
                    background: channel ? "var(--accent)" : `hsl(${h} 45% 88%)`,
                    color: channel ? "var(--muted-foreground)" : `hsl(${h} 40% 30%)`,
                    fontSize: Math.round(size * 0.45),
                }, children: letter }), harness ? (_jsx("span", { title: `${harness} harness`, className: "absolute -bottom-1 -right-1 flex items-center justify-center rounded-full border border-background bg-card text-[9px] font-bold text-foreground shadow-xs ring-1 ring-border", style: { width: Math.max(12, size * 0.48), height: Math.max(12, size * 0.48) }, children: harness === "Claude" ? (_jsx(Sparkles, { className: "size-2 text-[#356f96] dark:text-[#8db8d5]" })) : harness === "Codex" ? (_jsx(Terminal, { className: "size-2 text-[#36634d] dark:text-[#a8cbbb]" })) : (_jsx(Bot, { className: "size-2 text-[#604988] dark:text-[#c5b4e3]" })) })) : null, online !== undefined ? (_jsx("span", { className: cn("absolute rounded-full border-2 border-background", harness ? "-top-0.5 -right-0.5" : "-bottom-0.5 -right-0.5", presenceColor), style: { width: Math.max(7, size * 0.32), height: Math.max(7, size * 0.32) }, title: online ? (presence === "running" ? "running" : "online") : "idle / offline" })) : null] }));
}
