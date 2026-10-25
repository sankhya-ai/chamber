import { Bot, Check, Cloud, Copy, Key, Keyboard, User } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type QuotaInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KIND, type BoardData } from "@/lib/board";
import { cn } from "@/lib/utils";

const STATUS_PRESETS = [
  { emoji: "💬", text: "In a code review" },
  { emoji: "⚡", text: "Deep focus mode" },
  { emoji: "🌴", text: "Away / Vacation" },
  { emoji: "🎧", text: "Coding with music" },
  { emoji: "🚀", text: "Shipping release" },
];

export function SettingsDialog({
  open,
  onOpenChange,
  data,
  me,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: BoardData | null;
  me: string;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<"profile" | "relay" | "agents" | "security" | "shortcuts">("profile");
  const [statusEmoji, setStatusEmoji] = useState("💬");
  const [statusText, setStatusText] = useState("");
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [inviteCommand, setInviteCommand] = useState("");
  const [savedNote, setSavedNote] = useState("");

  useEffect(() => {
    if (open) {
      api.getUserStatus().then(
        (s) => {
          if (s.emoji) setStatusEmoji(s.emoji);
          if (s.text) setStatusText(s.text);
        },
        () => undefined
      );
      api.quota().then((q) => setQuota(q), () => undefined);
      if (data?.admin) {
        api.invite().then(
          (res: { command: string }) => setInviteCommand(res.command),
          () => undefined
        );
      }
    }
  }, [open, data?.admin]);

  const saveStatus = async () => {
    try {
      await api.setUserStatus(statusEmoji, statusText.trim());
      setSavedNote("Status updated");
      setTimeout(() => setSavedNote(""), 2000);
      onChanged();
    } catch {}
  };

  const copyInvite = () => {
    if (!inviteCommand) return;
    navigator.clipboard.writeText(inviteCommand);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="text-base font-semibold">Chamber Desktop Settings</DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure your desktop app, agent connections, and Cloudflare relay
          </p>
        </DialogHeader>

        <div className="flex flex-1 min-h-[420px] overflow-hidden">
          {/* Settings Sidebar */}
          <nav className="w-48 border-r bg-muted/20 p-2 space-y-1 text-xs">
            <button
              onClick={() => setTab("profile")}
              className={cn(
                "w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 font-medium transition-colors text-left",
                tab === "profile" ? "bg-accent text-accent-foreground font-semibold" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <User className="size-3.5" /> Profile & Status
            </button>
            <button
              onClick={() => setTab("relay")}
              className={cn(
                "w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 font-medium transition-colors text-left",
                tab === "relay" ? "bg-accent text-accent-foreground font-semibold" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <Cloud className="size-3.5" /> Cloudflare Relay
            </button>
            <button
              onClick={() => setTab("agents")}
              className={cn(
                "w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 font-medium transition-colors text-left",
                tab === "agents" ? "bg-accent text-accent-foreground font-semibold" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <Bot className="size-3.5" /> Coding Agents
            </button>
            <button
              onClick={() => setTab("security")}
              className={cn(
                "w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 font-medium transition-colors text-left",
                tab === "security" ? "bg-accent text-accent-foreground font-semibold" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <Key className="size-3.5" /> Security & Keys
            </button>
            <button
              onClick={() => setTab("shortcuts")}
              className={cn(
                "w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 font-medium transition-colors text-left",
                tab === "shortcuts" ? "bg-accent text-accent-foreground font-semibold" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <Keyboard className="size-3.5" /> Shortcuts
            </button>
          </nav>

          {/* Settings Content Area */}
          <div className="flex-1 overflow-y-auto p-6 text-xs">
            {tab === "profile" && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Your Profile</h3>
                  <p className="text-muted-foreground mt-0.5">Teammates reach you as @{me}</p>
                </div>

                <div className="space-y-3">
                  <label className="block font-medium text-foreground">Custom Status</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={statusEmoji}
                      onChange={(e) => setStatusEmoji(e.target.value.slice(0, 2))}
                      className="size-9 text-center text-base rounded-md border bg-background outline-none focus:border-ring"
                      title="Emoji icon"
                    />
                    <input
                      type="text"
                      value={statusText}
                      onChange={(e) => setStatusText(e.target.value)}
                      placeholder="What are you working on?"
                      className="flex-1 h-9 rounded-md border bg-background px-3 text-xs outline-none focus:border-ring"
                    />
                    <Button size="sm" onClick={saveStatus} className="h-9 px-3">
                      Save
                    </Button>
                  </div>

                  {savedNote ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">{savedNote}</span>
                  ) : null}

                  {/* Preset quick picks */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {STATUS_PRESETS.map((p) => (
                      <button
                        key={p.text}
                        onClick={() => {
                          setStatusEmoji(p.emoji);
                          setStatusText(p.text);
                        }}
                        className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 text-[11px] hover:bg-accent"
                      >
                        <span>{p.emoji}</span>
                        <span>{p.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === "relay" && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Cloudflare Relay Status</h3>
                  <p className="text-muted-foreground mt-0.5">
                    Serverless relay operating inside your team's Cloudflare account
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border bg-card p-3.5 space-y-1">
                    <span className="text-muted-foreground font-medium block">Daily DO Requests</span>
                    <span className="text-lg font-bold font-mono text-foreground">
                      {quota ? quota.dailyRequests.toLocaleString() : "0"}
                      <span className="text-xs text-muted-foreground font-normal ml-1">/ 100,000</span>
                    </span>
                    <div className="w-full bg-muted rounded-full h-1.5 mt-2 overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", (quota?.requestsPercentage || 0) > 80 ? "bg-amber-500" : "bg-primary")}
                        style={{ width: `${Math.min(100, quota?.requestsPercentage || 1)}%` }}
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border bg-card p-3.5 space-y-1">
                    <span className="text-muted-foreground font-medium block">R2 Encrypted Storage</span>
                    <span className="text-lg font-bold font-mono text-foreground">
                      {quota ? Math.round(quota.r2StorageBytes / (1024 * 1024)) : 0} MB
                      <span className="text-xs text-muted-foreground font-normal ml-1">/ 10 GB</span>
                    </span>
                    <div className="w-full bg-muted rounded-full h-1.5 mt-2 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: "2%" }} />
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border bg-muted/20 p-3 space-y-1">
                  <span className="font-semibold text-foreground block">Zero Backend Maintenance</span>
                  <p className="text-muted-foreground leading-relaxed">
                    Cloudflare Durable Objects coordinate ordered event sequencing and acknowledgements. Chamber stores all messages and files with AES-256-GCM client-side encryption. The relay routes ciphertext only.
                  </p>
                </div>
              </div>
            )}

            {tab === "agents" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Local Coding Agents</h3>
                  <p className="text-muted-foreground mt-0.5">
                    Harness integrations connecting in-place to Claude Code, Codex, and Antigravity
                  </p>
                </div>

                <div className="space-y-2">
                  {(data?.projects || []).map((p) => (
                    <div key={p.name} className="rounded-lg border p-3 bg-card space-y-2">
                      <div className="flex items-center justify-between font-medium">
                        <span>{p.name}</span>
                        <span className="text-muted-foreground font-mono text-[11px] truncate max-w-xs">{p.path}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {p.agents.map((a) => (
                          <span
                            key={a.agent}
                            className={cn(
                              "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px]",
                              a.online ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium" : "bg-muted text-muted-foreground"
                            )}
                          >
                            <span className={cn("size-1.5 rounded-full", a.online ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                            {KIND[a.kind] ?? a.kind}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "security" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Security & Chamber Keys</h3>
                  <p className="text-muted-foreground mt-0.5">
                    Cryptographic access control and end-to-end encryption keys
                  </p>
                </div>

                {data?.admin && inviteCommand ? (
                  <div className="space-y-2 rounded-lg border bg-muted/20 p-3.5">
                    <span className="font-semibold text-foreground block">Admin Personal Invite Command</span>
                    <p className="text-muted-foreground">
                      Each teammate receives a cryptographically signed personal pass. Send this privately to an invited engineer:
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={inviteCommand}
                        className="flex-1 h-8 rounded border bg-background px-2 font-mono text-[11px] text-muted-foreground"
                      />
                      <Button size="sm" variant="outline" onClick={copyInvite} className="h-8 gap-1">
                        {copiedInvite ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                        {copiedInvite ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="rounded-lg border bg-muted/20 p-3 space-y-1">
                  <span className="font-semibold text-foreground block">Verifiable E2EE Policy</span>
                  <p className="text-muted-foreground leading-relaxed">
                    All message payloads, file attachments, and approval gates are encrypted with envelope-bound AES-256-GCM. Remote approval links decrypt client-side via the URL fragment without exposing keys to the relay.
                  </p>
                </div>
              </div>
            )}

            {tab === "shortcuts" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Keyboard Shortcuts</h3>
                  <p className="text-muted-foreground mt-0.5">Power-user keyboard navigation</p>
                </div>

                <div className="space-y-2">
                  {[
                    { keys: "⌘ + K / Ctrl + K", desc: "Open quick switcher & global search" },
                    { keys: "C", desc: "Start a new conversation (when not typing)" },
                    { keys: "Esc", desc: "Close conversation panel or active modal" },
                    { keys: "Enter", desc: "Send message" },
                    { keys: "Shift + Enter", desc: "Insert newline in composer" },
                  ].map((s) => (
                    <div key={s.desc} className="flex items-center justify-between py-1.5 border-b border-border/40">
                      <span className="text-muted-foreground">{s.desc}</span>
                      <kbd className="rounded border bg-muted px-2 py-0.5 font-mono text-[11px] text-foreground font-semibold">
                        {s.keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
