import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowUp, FileText, Paperclip, UploadCloud, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
function formatSize(bytes) {
    if (!bytes)
        return "";
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function DropZoneOverlay() {
    return (_jsx("div", { className: "pointer-events-none absolute inset-x-4 inset-y-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-[1px] animate-in fade-in duration-150", children: _jsxs("span", { className: "flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-background shadow-md", children: [_jsx(UploadCloud, { "aria-hidden": "true", className: "size-4" }), _jsx("span", { children: "Drop files to attach" })] }) }));
}
/** Slack & Buzz-style composer: Enter sends, Shift+Enter is a new line, "@" mentions, file attachments & paste. */
export function Composer({ placeholder, people, onSend, disabled, }) {
    const [text, setText] = useState("");
    const [attachments, setAttachments] = useState([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [pick, setPick] = useState(0);
    const [dragging, setDragging] = useState(false);
    const area = useRef(null);
    const fileInputRef = useRef(null);
    // The "@word" being typed at the cursor, if any.
    const caret = area.current?.selectionStart ?? text.length;
    const typing = /(?:^|\s)@([a-z0-9._-]*)$/i.exec(text.slice(0, caret));
    const matches = typing ? people.filter((p) => p.startsWith(typing[1].toLowerCase())).slice(0, 6) : [];
    const complete = (name) => {
        if (!typing)
            return;
        const start = caret - typing[1].length;
        const next = `${text.slice(0, start)}${name} ${text.slice(caret)}`;
        setText(next);
        requestAnimationFrame(() => {
            area.current?.focus();
            area.current?.setSelectionRange(start + name.length + 1, start + name.length + 1);
        });
    };
    const processFiles = async (fileList) => {
        const files = Array.from(fileList);
        if (!files.length)
            return;
        setError("");
        const newAttachments = [];
        for (const file of files) {
            if (file.size > 25 * 1024 * 1024) {
                setError(`"${file.name}" exceeds 25 MB limit.`);
                continue;
            }
            const isImage = file.type.startsWith("image/");
            const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
            try {
                const base64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const res = String(reader.result || "");
                        resolve(res.includes(",") ? res.split(",")[1] : res);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
                newAttachments.push({
                    name: file.name,
                    data: base64,
                    size: file.size,
                    previewUrl,
                    isImage,
                });
            }
            catch {
                setError(`Failed to read "${file.name}"`);
            }
        }
        setAttachments((prev) => [...prev, ...newAttachments]);
    };
    const removeAttachment = (index) => {
        setAttachments((prev) => {
            const removed = prev[index];
            if (removed?.previewUrl)
                URL.revokeObjectURL(removed.previewUrl);
            return prev.filter((_, i) => i !== index);
        });
    };
    useEffect(() => {
        return () => {
            for (const a of attachments) {
                if (a.previewUrl)
                    URL.revokeObjectURL(a.previewUrl);
            }
        };
    }, []);
    const handlePaste = (e) => {
        if (e.clipboardData.files && e.clipboardData.files.length > 0) {
            e.preventDefault();
            void processFiles(e.clipboardData.files);
        }
    };
    const send = async () => {
        const body = text.trim();
        if ((!body && !attachments.length) || busy || disabled)
            return;
        setBusy(true);
        setError("");
        try {
            const outgoingFiles = attachments.map(({ name, data, size }) => ({ name, data, size }));
            await onSend(body || (outgoingFiles[0] ? `Attached: ${outgoingFiles.map((f) => f.name).join(", ")}` : ""), outgoingFiles);
            setText("");
            for (const a of attachments) {
                if (a.previewUrl)
                    URL.revokeObjectURL(a.previewUrl);
            }
            setAttachments([]);
        }
        catch (e) {
            setError(String(e.message));
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("div", { className: "relative px-4 pb-4", onDragOver: (e) => {
            e.preventDefault();
            setDragging(true);
        }, onDragLeave: () => setDragging(false), onDrop: (e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files)
                void processFiles(e.dataTransfer.files);
        }, children: [dragging ? _jsx(DropZoneOverlay, {}) : null, matches.length ? (_jsx("div", { className: "absolute bottom-full left-4 mb-1 w-56 overflow-hidden rounded-lg border bg-popover p-1 shadow-md z-30", children: matches.map((p, i) => (_jsxs("button", { onMouseDown: (e) => (e.preventDefault(), complete(p)), className: cn("flex w-full items-center rounded-md px-2 py-1 text-left text-sm", i === pick % matches.length && "bg-accent"), children: ["@", p] }, p))) })) : null, _jsxs("div", { className: cn("flex flex-col rounded-xl border bg-background px-3 py-2 shadow-xs transition-colors focus-within:border-ring", dragging && "border-primary bg-accent/20"), children: [attachments.length ? (_jsx("div", { className: "mb-2 flex flex-wrap gap-2 pt-1 border-b pb-2", children: attachments.map((file, i) => (_jsxs("div", { className: "group relative flex items-center gap-1.5 rounded-lg border bg-muted/60 py-1 pl-1.5 pr-2 text-xs shadow-2xs hover:bg-muted transition-colors", children: [file.isImage && file.previewUrl ? (_jsx("img", { src: file.previewUrl, alt: file.name, className: "size-6 rounded object-cover border" })) : (_jsx(FileText, { className: "size-4 text-muted-foreground" })), _jsx("span", { className: "max-w-[140px] truncate font-medium text-foreground", children: file.name }), _jsxs("span", { className: "text-[10px] text-muted-foreground", children: ["(", formatSize(file.size), ")"] }), _jsx("button", { type: "button", onClick: () => removeAttachment(i), title: `Remove ${file.name}`, className: "ml-1 flex size-4 items-center justify-center rounded-full bg-muted-foreground/15 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors", children: _jsx(X, { className: "size-2.5" }) })] }, `${file.name}-${i}`))) })) : null, _jsxs("div", { className: "flex items-end gap-2", children: [_jsx("input", { type: "file", multiple: true, ref: fileInputRef, onChange: (e) => {
                                    if (e.target.files)
                                        void processFiles(e.target.files);
                                    e.target.value = "";
                                }, className: "hidden" }), _jsx("button", { type: "button", onClick: () => fileInputRef.current?.click(), title: "Attach files (images, code, documents up to 25 MB)", className: "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", children: _jsx(Paperclip, { className: "size-4" }) }), _jsx("textarea", { ref: area, rows: 1, value: text, disabled: disabled, placeholder: attachments.length ? "Add a message or press enter to send…" : placeholder, onChange: (e) => (setText(e.target.value), setPick(0)), onPaste: handlePaste, onKeyDown: (e) => {
                                    if (matches.length && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
                                        e.preventDefault();
                                        complete(matches[pick % matches.length]);
                                    }
                                    else if (matches.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                                        e.preventDefault();
                                        setPick((v) => v + (e.key === "ArrowDown" ? 1 : matches.length - 1));
                                    }
                                    else if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        void send();
                                    }
                                }, className: "max-h-48 min-h-6 flex-1 resize-none bg-transparent leading-6 outline-none [field-sizing:content] placeholder:text-muted-foreground" }), _jsx("button", { onClick: () => void send(), disabled: (!text.trim() && !attachments.length) || busy || disabled, "aria-label": "Send", className: "inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-30 transition-opacity", children: _jsx(ArrowUp, { className: "size-4" }) })] })] }), error ? _jsx("p", { className: "mt-1 text-[12px] text-destructive", children: error }) : null] }));
}
