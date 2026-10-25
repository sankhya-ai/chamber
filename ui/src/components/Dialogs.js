import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Check, Copy, Hash, UserMinus } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { people } from "@/lib/board";
/** New channel, or join one you are not in. */
export function ChannelDialog({ open, onOpenChange, data, onJoined }) {
    const [name, setName] = useState("");
    const [error, setError] = useState("");
    const others = (data?.channels ?? []).filter((c) => !c.joined);
    const join = async (raw) => {
        try {
            const { channel } = await api.channel("join", raw);
            setName("");
            onOpenChange(false);
            onJoined(channel);
        }
        catch (e) {
            setError(String(e.message));
        }
    };
    return (_jsx(Dialog, { open: open, onOpenChange: onOpenChange, children: _jsxs(DialogContent, { className: "sm:max-w-md", children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: "Channels" }), _jsx(DialogDescription, { children: "A channel is a room for a topic. Everyone in it sees what's said; @mention someone to reach their agent." })] }), _jsxs("form", { className: "flex gap-2", onSubmit: (e) => (e.preventDefault(), name.trim() && void join(name)), children: [_jsxs("div", { className: "flex flex-1 items-center gap-1 rounded-md border px-2 focus-within:border-ring", children: [_jsx(Hash, { className: "size-3.5 text-muted-foreground" }), _jsx("input", { autoFocus: true, value: name, onChange: (e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_#-]/g, "-")), placeholder: "backend", className: "h-9 flex-1 bg-transparent outline-none" })] }), _jsx(Button, { type: "submit", disabled: !name.trim(), children: "Create" })] }), others.length ? (_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("p", { className: "text-muted-foreground", children: "Or join one:" }), others.map((c) => (_jsxs("button", { onClick: () => void join(c.name), className: "flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent", children: [_jsx(Hash, { className: "size-3.5" }), " ", c.name.slice(1), " ", _jsxs("span", { className: "ml-auto text-muted-foreground", children: [c.members.length, " in it"] })] }, c.name)))] })) : null, error ? _jsx("p", { className: "text-destructive", children: error }) : null] }) }));
}
/** The admin's join command for a teammate. */
export function InviteDialog({ open, onOpenChange }) {
    const [command, setCommand] = useState("");
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (open)
            api.invite().then((r) => setCommand(r.command), (e) => setCommand(String(e.message)));
    }, [open]);
    return (_jsx(Dialog, { open: open, onOpenChange: onOpenChange, children: _jsxs(DialogContent, { className: "sm:max-w-lg", children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: "Invite a teammate" }), _jsx(DialogDescription, { children: "A personal key for one teammate: send it to them privately. They run it inside their project, then restart Claude Code. Each time you open this, it makes a new one." })] }), _jsx("pre", { className: "overflow-x-auto rounded-md border bg-muted p-3 font-mono text-[12px] whitespace-pre-wrap break-all", children: command }), _jsxs(Button, { onClick: () => void navigator.clipboard.writeText(command).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500))), children: [copied ? _jsx(Check, {}) : _jsx(Copy, {}), " ", copied ? "Copied" : "Copy command"] })] }) }));
}
/** Who is in the chamber; the admin removes people (their invite and name stop working) or lets a name back. */
export function MembersDialog({ open, onOpenChange, admin, me, data: board, onChanged }) {
    const [data, setData] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [error, setError] = useState("");
    const load = () => api.members().then(setData, (e) => setError(String(e.message)));
    useEffect(() => {
        if (open) {
            setConfirm(null);
            setError("");
            void load();
        }
    }, [open]);
    const act = async (work) => {
        try {
            await work();
            setConfirm(null);
            await load();
            onChanged();
        }
        catch (e) {
            setError(String(e.message));
        }
    };
    const memberNames = new Set((data?.members ?? []).map((m) => m.owner));
    const removed = new Set((data?.removed ?? []).map((r) => r.owner));
    // People seen in talks or channels who never joined with a personal invite (e.g. from before invites were personal).
    const others = people(board).filter((p) => !memberNames.has(p.owner) && !removed.has(p.owner));
    const row = (owner, online, note) => (_jsxs("div", { className: "flex h-9 items-center gap-2 rounded-md px-2 hover:bg-accent/60", children: [_jsx(Avatar, { name: owner, size: 22, online: online }), _jsx("span", { className: "capitalize", children: owner }), owner === me ? _jsx("span", { className: "text-muted-foreground", children: "you" }) : note ? _jsx("span", { className: "text-muted-foreground", children: note }) : null, admin && owner !== me ? (confirm === owner ? (_jsxs("span", { className: "ml-auto flex gap-1", children: [_jsxs(Button, { size: "sm", variant: "destructive", onClick: () => void act(() => api.revoke(owner)), children: ["Remove ", owner] }), _jsx(Button, { size: "sm", variant: "ghost", onClick: () => setConfirm(null), children: "Cancel" })] })) : (_jsxs(Button, { size: "sm", variant: "ghost", className: "ml-auto text-muted-foreground", onClick: () => setConfirm(owner), children: [_jsx(UserMinus, {}), " Remove"] }))) : null] }, owner));
    return (_jsx(Dialog, { open: open, onOpenChange: onOpenChange, children: _jsxs(DialogContent, { className: "sm:max-w-md", children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: "Members" }), _jsx(DialogDescription, { children: data && !data.personal ? "This chamber has no personal invites yet: anyone with its key may join." : "Everyone in this chamber. Removing someone disconnects them at once; their invite and name stop working." })] }), _jsx("div", { className: "flex flex-col gap-1", children: (data?.members ?? []).map((m) => row(m.owner, m.online)) }), others.length ? (_jsxs("div", { className: "flex flex-col gap-1 border-t pt-3", children: [_jsx("p", { className: "text-muted-foreground", children: "Seen here, without a personal invite" }), others.map((p) => row(p.owner, p.online, "no invite"))] })) : null, admin && removed.size ? (_jsxs("div", { className: "flex flex-col gap-1 border-t pt-3", children: [_jsx("p", { className: "text-muted-foreground", children: "Removed" }), [...removed].map((owner) => (_jsxs("div", { className: "flex h-9 items-center gap-2 rounded-md px-2 text-muted-foreground", children: [_jsx(Avatar, { name: owner, size: 22 }), _jsx("span", { className: "capitalize line-through", children: owner }), _jsx(Button, { size: "sm", variant: "ghost", className: "ml-auto", onClick: () => void act(() => api.revoke(owner, "restore")), children: "Restore" })] }, owner)))] })) : null, error ? _jsx("p", { className: "text-destructive", children: error }) : null] }) }));
}
/** A channel's members (Slack's "People in #channel"): add teammates, or leave. */
export function ChannelMembersDialog({ open, onOpenChange, data, channel, onLeft, onChanged }) {
    const [error, setError] = useState("");
    const me = data?.me ?? "";
    const members = data?.channels.find((c) => c.name === channel)?.members ?? [];
    const online = new Set((data?.agents ?? []).map((a) => a.agent.split("/")[0]));
    const others = people(data).filter((p) => !members.includes(p.owner));
    const act = async (work) => {
        try {
            setError("");
            await work();
            onChanged();
        }
        catch (e) {
            setError(String(e.message));
        }
    };
    return (_jsx(Dialog, { open: open, onOpenChange: onOpenChange, children: _jsxs(DialogContent, { className: "sm:max-w-md", children: [_jsxs(DialogHeader, { children: [_jsxs(DialogTitle, { children: ["People in ", channel] }), _jsx(DialogDescription, { children: "Everyone here sees the channel on their board; @mention someone to reach their agent." })] }), _jsx("div", { className: "flex flex-col gap-1", children: members.map((m) => (_jsxs("div", { className: "group flex h-9 items-center gap-2 rounded-md px-2 hover:bg-accent/60", children: [_jsx(Avatar, { name: m, size: 22, online: online.has(m) }), _jsx("span", { className: "capitalize", children: m }), m === me ? _jsx("span", { className: "text-muted-foreground", children: "you" }) : null, m !== me && members.includes(me) ? (_jsx(Button, { size: "sm", variant: "ghost", className: "ml-auto hidden text-muted-foreground group-hover:inline-flex", onClick: () => void act(() => api.channel("leave", channel, m)), children: "Remove" })) : null] }, m))) }), others.length ? (_jsxs("div", { className: "flex flex-col gap-1 border-t pt-3", children: [_jsx("p", { className: "text-muted-foreground", children: "Add a teammate" }), others.map((p) => (_jsxs("button", { onClick: () => void act(() => api.channel("add", channel, p.owner)), className: "flex h-9 items-center gap-2 rounded-md px-2 text-left hover:bg-accent", children: [_jsx(Avatar, { name: p.owner, size: 22, online: p.online }), _jsx("span", { className: "capitalize", children: p.owner }), _jsx("span", { className: "ml-auto text-muted-foreground", children: "Add" })] }, p.owner)))] })) : (_jsx("p", { className: "border-t pt-3 text-muted-foreground", children: "Everyone in the chamber is here. Invite more people to the chamber first." })), channel !== "#general" ? (_jsxs(Button, { variant: "ghost", className: "self-start text-muted-foreground", onClick: () => void act(async () => (await api.channel("leave", channel), onOpenChange(false), onLeft())), children: ["Leave ", channel] })) : null, error ? _jsx("p", { className: "text-destructive", children: error }) : null] }) }));
}
