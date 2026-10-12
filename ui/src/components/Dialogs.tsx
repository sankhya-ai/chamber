import { Check, Copy, Hash, UserMinus } from "lucide-react";

import { Avatar } from "@/components/Avatar";
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
          <DialogDescription>A personal key for one teammate: send it to them privately. They run it inside their project, then restart Claude Code. Each time you open this, it makes a new one.</DialogDescription>
        </DialogHeader>
        <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-[12px] whitespace-pre-wrap break-all">{command}</pre>
        <Button onClick={() => void navigator.clipboard.writeText(command).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy command"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/** Who is in the chamber; the admin can remove someone (their invite stops working at once). */
export function MembersDialog({ open, onOpenChange, admin, me, onChanged }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  admin: boolean;
  me: string;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.members>> | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = () => api.members().then(setData, (e) => setError(String(e.message)));
  useEffect(() => {
    if (open) {
      setConfirm(null);
      void load();
    }
  }, [open]);
  const remove = async (owner: string) => {
    try {
      await api.revoke(owner);
      setConfirm(null);
      await load();
      onChanged();
    } catch (e) {
      setError(String((e as Error).message));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Members</DialogTitle>
          <DialogDescription>
            {data && !data.personal ? "This chamber has no personal invites yet: anyone with its key may join. Re-run create.sh to add them." : "Everyone with a personal invite to this chamber."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          {(data?.members ?? []).map((m) => (
            <div key={m.owner} className="flex h-9 items-center gap-2 rounded-md px-2 hover:bg-accent/60">
              <Avatar name={m.owner} size={22} online={m.online} />
              <span className="capitalize">{m.owner}</span>
              {m.owner === me ? <span className="text-muted-foreground">you</span> : null}
              {admin && m.owner !== me ? (
                confirm === m.owner ? (
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="destructive" onClick={() => void remove(m.owner)}>Remove {m.owner}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" onClick={() => setConfirm(m.owner)}>
                    <UserMinus /> Remove
                  </Button>
                )
              ) : null}
            </div>
          ))}
        </div>
        {error ? <p className="text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
