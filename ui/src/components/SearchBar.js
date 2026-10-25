import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, GitCommit, Search, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
export function SearchBar({ onOpenTalk }) {
    const [query, setQuery] = useState("");
    const [hits, setHits] = useState([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const containerRef = useRef(null);
    useEffect(() => {
        if (!query.trim()) {
            setHits([]);
            setOpen(false);
            return;
        }
        const timer = setTimeout(async () => {
            setLoading(true);
            try {
                const res = await api.search(query.trim());
                setHits(res.hits || []);
                setOpen(true);
                setSelectedIndex(0);
            }
            catch {
                setHits([]);
            }
            finally {
                setLoading(false);
            }
        }, 150);
        return () => clearTimeout(timer);
    }, [query]);
    // Click outside to dismiss dropdown
    useEffect(() => {
        const onMouseDown = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onMouseDown);
        return () => document.removeEventListener("mousedown", onMouseDown);
    }, []);
    const handleSelect = (hit) => {
        setOpen(false);
        setQuery("");
        if (hit.talkId)
            onOpenTalk(hit.talkId);
    };
    const handleKeyDown = (e) => {
        if (!open || !hits.length)
            return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex((prev) => (prev + 1) % hits.length);
        }
        else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex((prev) => (prev - 1 + hits.length) % hits.length);
        }
        else if (e.key === "Enter") {
            e.preventDefault();
            if (hits[selectedIndex])
                handleSelect(hits[selectedIndex]);
        }
        else if (e.key === "Escape") {
            setOpen(false);
        }
    };
    return (_jsxs("div", { ref: containerRef, className: "relative w-72 max-w-sm", children: [_jsxs("div", { className: "relative flex items-center", children: [_jsx(Search, { className: "pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" }), _jsx("input", { value: query, onChange: (e) => setQuery(e.target.value), onFocus: () => query.trim() && setOpen(true), onKeyDown: handleKeyDown, placeholder: "Search talks, incidents, memory...", className: "h-8 w-full rounded-md border bg-muted/40 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:bg-background focus:outline-none" }), query ? (_jsx("button", { onClick: () => {
                            setQuery("");
                            setHits([]);
                            setOpen(false);
                        }, className: "absolute right-2 text-muted-foreground hover:text-foreground", children: _jsx(X, { className: "size-3.5" }) })) : (_jsx("kbd", { className: "pointer-events-none absolute right-2 select-none rounded border bg-muted px-1 text-[10px] text-muted-foreground", children: "\u2318K" }))] }), open && (_jsx("div", { className: "absolute left-0 right-0 top-9 z-50 max-h-80 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg", children: loading ? (_jsx("div", { className: "px-3 py-2 text-xs text-muted-foreground", children: "Searching team memory & talks..." })) : hits.length === 0 ? (_jsx("div", { className: "px-3 py-2 text-xs text-muted-foreground", children: "No matching incidents or talks." })) : (hits.map((hit, idx) => {
                    const isSelected = idx === selectedIndex;
                    const isIncident = hit.type === "incident" || /error|bug|fix/i.test(hit.text);
                    const isPatch = hit.type === "patch";
                    return (_jsxs("button", { onClick: () => handleSelect(hit), className: `flex w-full flex-col items-start gap-1 rounded-md px-3 py-2 text-left text-xs transition-colors ${isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`, children: [_jsxs("div", { className: "flex w-full items-center justify-between gap-2", children: [_jsxs("span", { className: "flex items-center gap-1.5 font-medium truncate", children: [isIncident ? (_jsx(AlertTriangle, { className: "size-3 text-[#c5b4e3]" })) : isPatch ? (_jsx(GitCommit, { className: "size-3 text-[#a8cbbb]" })) : (_jsx(Sparkles, { className: "size-3 text-[#8db8d5]" })), hit.title || hit.citation] }), _jsx("span", { className: "rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase font-mono text-muted-foreground", children: hit.channel || hit.type })] }), _jsx("p", { className: "line-clamp-2 text-[11px] text-muted-foreground leading-normal", children: hit.text.replace(/\n+/g, " ") })] }, hit.id));
                })) }))] }));
}
