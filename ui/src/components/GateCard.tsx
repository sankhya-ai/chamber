import { Check, Clock, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { api, type Gate } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface GateCardProps {
  gateId: string;
  description?: string;
  requestedBy?: string;
  initialStatus?: "pending" | "approved" | "rejected" | "expired";
  onResolved?: (gate: Gate) => void;
}

export function GateCard({ gateId, description, requestedBy, initialStatus = "pending", onResolved }: GateCardProps) {
  const [status, setStatus] = useState<string>(initialStatus);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleDecision = async (decision: "approve" | "reject") => {
    setLoading(true);
    setError("");
    try {
      const res = await api.resolveGate(gateId, decision);
      setStatus(res.gate.status);
      onResolved?.(res.gate);
    } catch (err: any) {
      setError(err?.message || "Failed to resolve gate");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="my-2 rounded-lg border bg-card p-3 shadow-sm transition-all hover:border-amber-500/40">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {status === "approved" ? (
            <ShieldCheck className="size-4 text-emerald-500" />
          ) : status === "rejected" ? (
            <X className="size-4 text-destructive" />
          ) : (
            <ShieldAlert className="size-4 text-amber-500" />
          )}
          <span className="text-[13px] font-semibold tracking-tight">
            Approval Gate: <span className="font-mono text-[12px] text-muted-foreground">{gateId.slice(0, 8)}</span>
          </span>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
            status === "approved"
              ? "bg-emerald-500/10 text-emerald-500"
              : status === "rejected"
              ? "bg-destructive/10 text-destructive"
              : "bg-amber-500/10 text-amber-500"
          }`}
        >
          {status === "pending" ? <Clock className="size-3" /> : null}
          {status}
        </span>
      </div>

      <p className="mt-1.5 text-[13px] text-foreground/90 font-medium">{description || "Action paused for review."}</p>

      {requestedBy ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Requested by <span className="font-medium text-foreground">{requestedBy}</span>
        </p>
      ) : null}

      {error ? <p className="mt-1 text-[11px] text-destructive">{error}</p> : null}

      {status === "pending" ? (
        <div className="mt-2.5 flex items-center gap-2">
          <Button
            size="sm"
            disabled={loading}
            onClick={() => handleDecision("approve")}
            className="h-7 bg-emerald-600 px-3 text-[12px] text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            <Check className="mr-1 size-3.5" /> Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => handleDecision("reject")}
            className="h-7 border-destructive/30 px-3 text-[12px] text-destructive hover:bg-destructive/10"
          >
            <X className="mr-1 size-3.5" /> Reject
          </Button>
        </div>
      ) : null}
    </div>
  );
}
