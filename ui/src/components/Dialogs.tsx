import { Check, Copy, Hash } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { BoardData } from "@/lib/board";

/** New channel, or join one you are not in. */
export function ChannelDialog({ open, onOpenChange, data, onJoined }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: BoardData | null;
  onJoined: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const others = (data?.channels ?? []).filter((c) => !c.joined);
  const join = async (raw: string) => {
    try {
      const { channel } = await api.channel("join", raw);
      setName("");
      onOpenChange(false);
      onJoined(channel);
    } catch (e) {
      setError(String((e as Error).message));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Channels</DialogTitle>
          <DialogDescription>A channel is a room for a topic. Everyone in it sees what's said; @mention someone to reach their agent.</DialogDescription>
        </DialogHeader>
        <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), name.trim() && void join(name))}>
          <div className="flex flex-1 items-center gap-1 rounded-md border px-2 focus-within:border-ring">
            <Hash className="size-3.5 text-muted-foreground" />
            <input autoFocus value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_#-]/g, "-"))} placeholder="backend" className="h-9 flex-1 bg-transparent outline-none" />
          </div>
          <Button type="submit" disabled={!name.trim()}>Create</Button>
        </form>
        {others.length ? (
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground">Or join one:</p>
            {others.map((c) => (
              <button key={c.name} onClick={() => void join(c.name)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent">
                <Hash className="size-3.5" /> {c.name.slice(1)} <span className="ml-auto text-muted-foreground">{c.members.length} in it</span>
              </button>
            ))}
          </div>
        ) : null}
        {error ? <p className="text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}

/** The admin's join command for a teammate. */
export function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [command, setCommand] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (open) api.invite().then((r) => setCommand(r.command), (e) => setCommand(String(e.message)));
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>Send them this command privately. They run it inside their project, then restart Claude Code.</DialogDescription>
        </DialogHeader>
        <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-[12px] whitespace-pre-wrap break-all">{command}</pre>
        <Button onClick={() => void navigator.clipboard.writeText(command).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy command"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
