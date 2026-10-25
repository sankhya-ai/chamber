import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Shield, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GateCard } from "@/components/GateCard";
export function GatesDialog({ open, onOpenChange, me = "", onChanged }) {
    const [gates, setGates] = useState([]);
    const [loading, setLoading] = useState(false);
    const loadGates = async () => {
        setLoading(true);
        try {
            const res = await api.gates();
            setGates(res.gates || []);
        }
        catch {
            setGates([]);
        }
        finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        if (open)
            loadGates();
    }, [open]);
    return (_jsx(Dialog, { open: open, onOpenChange: onOpenChange, children: _jsxs(DialogContent, { className: "max-w-xl", children: [_jsxs(DialogHeader, { children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Shield, { className: "size-5 text-[#8db8d5]" }), _jsx(DialogTitle, { children: "Approval Gates" })] }), _jsx(DialogDescription, { children: "Review and approve sensitive actions requested by coding agents or workflows." })] }), _jsx("div", { className: "max-h-[70vh] overflow-y-auto py-2 pr-1", children: loading ? (_jsx("p", { className: "py-4 text-center text-xs text-muted-foreground", children: "Checking pending gates..." })) : gates.length === 0 ? (_jsxs("div", { className: "py-8 text-center text-xs text-muted-foreground", children: [_jsx(ShieldAlert, { className: "mx-auto mb-2 size-8 text-muted-foreground/40" }), _jsx("p", { className: "font-medium text-foreground", children: "No pending approval gates" }), _jsx("p", { className: "mt-1 text-muted-foreground", children: "When an agent triggers an action requiring human approval, it will appear here." })] })) : (gates.map((g) => (_jsx(GateCard, { gateId: g.id, description: g.description, action: g.action, requestedBy: g.requestedBy, expiresAt: g.expiresAt, createdAt: g.createdAt, resolvedAt: g.resolvedAt, resolvedBy: g.resolvedBy, lineId: g.lineId, initialStatus: g.status, me: me, onResolved: () => {
                            loadGates();
                            onChanged?.();
                        } }, g.id)))) })] }) }));
}
