import { Bot, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface AwayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: string;
  onChanged?: () => void;
}

export function AwayDialog({ open, onOpenChange, me, onChanged }: AwayDialogProps) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("away in a meeting");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      api.awayStatus().then((s) => {
        setRunning(s.running);
        if (s.status) setStatus(s.status);
      }).catch(() => {});
    }
  }, [open]);

  const handleToggle = async (nextState: boolean) => {
    setLoading(true);
    setError("");
    try {
      const res = await api.setAway(nextState, status.trim() || "away from desk");
      setRunning(res.running);
      if (res.status) setStatus(res.status);
      onChanged?.();
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message || "Failed to update away status");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Bot className="size-5 text-amber-500" />
            <DialogTitle>Away Mode Responder</DialogTitle>
          </div>
          <DialogDescription>
            Let your personal agent (<code>@{me}/away</code>) answer teammates and coding agents from local repo memory while you are away.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3">
            <div className="flex items-center gap-2.5">
              <span className={`size-3 rounded-full ${running ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`} />
              <div>
                <p className="text-xs font-semibold text-foreground">
                  Status: {running ? "Away Mode Active" : "Active & Available"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {running
                    ? `Auto-answering with @${me}/away`
                    : "You are marked active and receive notifications"}
                </p>
              </div>
            </div>

            <Button
              size="sm"
              variant={running ? "destructive" : "default"}
              disabled={loading}
              onClick={() => handleToggle(!running)}
              className="h-7 text-xs"
            >
              {running ? "Turn Off" : "Turn On"}
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground">
              Away Status Note
            </label>
            <input
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="e.g. Away at lunch, Deep work until 4pm, On vacation..."
              className="h-8 rounded-md border bg-background px-2.5 text-xs text-foreground outline-none focus:border-ring"
            />
            <span className="text-[10px] text-muted-foreground">
              This note is shared with teammates when they mention or direct-message you.
            </span>
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5 text-[11px] text-muted-foreground leading-relaxed">
            <p className="font-medium text-foreground mb-0.5 flex items-center gap-1">
              <Sparkles className="size-3 text-amber-500" /> E2EE Auto-Reply
            </p>
            Your away responder runs entirely on your local machine, reading contracts, schemas, and <code>MEMORY.md</code> to synthesize verified answers with zero leaks to third-party relays.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="h-7 text-xs">
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={loading}
            onClick={() => handleToggle(true)}
            className="h-7 text-xs bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500"
          >
            {loading ? "Saving..." : "Save & Set Away"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
