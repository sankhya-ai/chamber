import { Check, GitBranch, Layers } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type CoordinationTask, type QuotaInfo } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const OP_COLORS: Record<string, string> = {
  ask: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20",
  delegate: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
  review: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/20",
  propose: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
  resolve: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  handoff: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
};

const STATUS_BADGES: Record<string, string> = {
  requested: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  claimed: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  in_progress: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 animate-pulse",
  resolved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  rejected: "bg-destructive/15 text-destructive",
  timed_out: "bg-muted text-muted-foreground",
};

export function CoordinationDialog({
  open,
  onOpenChange,
  me,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: string;
}) {
  const [tasks, setTasks] = useState<CoordinationTask[]>([]);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionText, setResolutionText] = useState("");
  const [acting, setActing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [taskRes, quotaRes] = await Promise.all([
        api.coordinationTasks(),
        api.quota().catch(() => null),
      ]);
      setTasks(taskRes.tasks || []);
      setQuota(quotaRes);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const filteredTasks = tasks.filter((t) => {
    if (filter === "all") return true;
    if (filter === "active") return t.status === "requested" || t.status === "claimed" || t.status === "in_progress";
    return t.status === filter;
  });

  const handleClaim = async (id: string) => {
    setActing(true);
    try {
      await api.claimCoordination(id, `${me}/board`);
      await load();
    } finally {
      setActing(false);
    }
  };

  const handleResolve = async (id: string) => {
    if (!resolutionText.trim()) return;
    setActing(true);
    try {
      await api.resolveCoordination(id, resolutionText.trim());
      setResolvingId(null);
      setResolutionText("");
      await load();
    } finally {
      setActing(false);
    }
  };

  const handleReject = async (id: string) => {
    setActing(true);
    try {
      await api.rejectCoordination(id, "Declined from desktop app");
      await load();
    } finally {
      setActing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b flex-row items-center justify-between">
          <div>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <Layers className="size-4 text-primary" />
              Agent Coordination Protocol (ACP)
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Typed collaboration tickets between coding agents across repositories
            </p>
          </div>
          {quota ? (
            <div className="flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-[11px] font-mono">
              <span className={cn("size-2 rounded-full", quota.warning ? "bg-amber-500" : "bg-emerald-500")} />
              <span>Cloudflare DO: {quota.dailyRequests.toLocaleString()} / {quota.dailyRequestsLimit.toLocaleString()} reqs</span>
            </div>
          ) : null}
        </DialogHeader>

        {/* Filter bar */}
        <div className="flex items-center gap-1 px-6 py-2 border-b bg-muted/20 text-xs">
          {["all", "active", "resolved", "rejected"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-2.5 py-1 capitalize transition-colors font-medium",
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {f}
            </button>
          ))}
          <span className="ml-auto text-muted-foreground text-[11px]">
            {filteredTasks.length} task{filteredTasks.length === 1 ? "" : "s"}
          </span>
        </div>

        {/* Tasks list */}
        <div className="flex-1 overflow-y-auto px-6 py-3 space-y-3">
          {loading && !tasks.length ? (
            <div className="py-12 text-center text-xs text-muted-foreground">Loading coordination tasks…</div>
          ) : !filteredTasks.length ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              No {filter !== "all" ? filter : ""} coordination tasks in this chamber yet.
            </div>
          ) : (
            filteredTasks.map((t) => {
              const isResolving = resolvingId === t.id;
              return (
                <div
                  key={t.id}
                  className="rounded-lg border bg-card p-3 shadow-2xs hover:border-border transition-all flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-mono uppercase font-semibold", OP_COLORS[t.op] || "bg-muted")}>
                        {t.op}
                      </span>
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-mono capitalize", STATUS_BADGES[t.status] || "bg-muted")}>
                        {t.status.replace("_", " ")}
                      </span>
                      <h4 className="font-semibold text-xs text-foreground truncate max-w-sm">{t.title}</h4>
                      {t.branch ? (
                        <span className="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-mono text-accent-foreground">
                          <GitBranch className="size-2.5" /> {t.branch}
                        </span>
                      ) : null}
                      {t.contract ? (
                        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                          contract: {t.contract}
                        </span>
                      ) : null}
                    </div>

                    <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                      #{t.id.slice(0, 8)}
                    </span>
                  </div>

                  {t.description ? (
                    <p className="text-xs text-muted-foreground/90 leading-relaxed whitespace-pre-wrap">
                      {t.description}
                    </p>
                  ) : null}

                  {t.resolution ? (
                    <div className="rounded bg-emerald-500/10 border border-emerald-500/20 p-2 text-xs text-emerald-800 dark:text-emerald-300">
                      <span className="font-semibold block mb-0.5">✔ Resolution:</span>
                      {t.resolution}
                      {t.evidence ? (
                        <div className="mt-1 pt-1 border-t border-emerald-500/20 text-[10px] font-mono text-emerald-700 dark:text-emerald-400">
                          Evidence attached: {JSON.stringify(t.evidence)}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Actions / Resolving form */}
                  {isResolving ? (
                    <div className="mt-2 flex flex-col gap-2 rounded border bg-muted/30 p-2.5">
                      <textarea
                        autoFocus
                        rows={2}
                        value={resolutionText}
                        onChange={(e) => setResolutionText(e.target.value)}
                        placeholder="Verified outcome, schema contract, or findings..."
                        className="w-full text-xs rounded border bg-background p-2 outline-none focus:border-ring"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setResolvingId(null)} className="h-7 text-xs">
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          disabled={acting || !resolutionText.trim()}
                          onClick={() => handleResolve(t.id)}
                          className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                        >
                          <Check className="size-3" /> Commit & Resolve
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/50">
                      <span>
                        <span className="font-medium text-foreground">{t.from}</span> → <span className="font-medium text-foreground">{t.to}</span>
                        {t.claimedBy ? ` (claimed by ${t.claimedBy})` : ""}
                      </span>

                      {t.status === "requested" || t.status === "claimed" || t.status === "in_progress" ? (
                        <div className="flex items-center gap-1.5">
                          {t.status === "requested" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={acting}
                              onClick={() => handleClaim(t.id)}
                              className="h-6 px-2 text-[10px] gap-1"
                            >
                              Claim
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => {
                              setResolvingId(t.id);
                              setResolutionText("");
                            }}
                            className="h-6 px-2 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            Resolve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={acting}
                            onClick={() => handleReject(t.id)}
                            className="h-6 px-1.5 text-[10px] text-destructive hover:bg-destructive/10"
                          >
                            Reject
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
