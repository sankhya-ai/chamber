import { ArrowRight, Cloud, Folder, Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function OnboardingView({ onConfigured }: { onConfigured: () => void }) {
  const [mode, setMode] = useState<"join" | "new">("join");
  const [createMethod, setCreateMethod] = useState<"auto" | "url">("auto");
  const [cfAuth, setCfAuth] = useState<{ authenticated: boolean; account: string | null } | null>(null);
  const [invite, setInvite] = useState("");
  const [relay, setRelay] = useState("");
  const [handle, setHandle] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [harnesses, setHarnesses] = useState<Record<string, boolean>>({
    claude: true,
    codex: false,
    antigravity: false,
    dsh: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.detectHarnesses().then(
      (res) => {
        if (res.harnesses) setHarnesses(res.harnesses);
        if (res.project) setProjectPath(res.project);
      },
      () => undefined
    );
    api.cloudflareAuth().then(
      (res) => setCfAuth(res),
      () => undefined
    );
  }, []);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite.trim()) {
      setError("Please paste the invite token or curl command your teammate sent you.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await api.joinOnboarding(invite.trim(), handle.trim() || undefined, projectPath || undefined);
      onConfigured();
    } catch (err: any) {
      setError(err?.message || "Failed to join chamber. Please check your invite pass.");
    } finally {
      setLoading(false);
    }
  };

  const handleCloudflareAutoDeploy = async () => {
    setLoading(true);
    setError("");
    try {
      await api.cloudflareSetup(handle.trim() || undefined, projectPath || undefined);
      onConfigured();
    } catch (err: any) {
      setError(err?.message || "Failed to deploy Cloudflare relay. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!relay.trim()) {
      setError("Please enter your Cloudflare Relay URL (e.g. https://relay.your-account.workers.dev).");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await api.newOnboarding(relay.trim(), handle.trim() || undefined, projectPath || undefined);
      onConfigured();
    } catch (err: any) {
      setError(err?.message || "Failed to initialize chamber relay.");
    } finally {
      setLoading(false);
    }
  };

  const pickFolder = async () => {
    try {
      const picked = await api.pickFolder();
      if (picked.path) setProjectPath(picked.path);
    } catch {}
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-xl rounded-2xl border bg-card p-8 shadow-xl">
        {/* Brand Header */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs font-mono font-medium text-muted-foreground mb-4">
            <span className="size-2 rounded-full bg-[#a8cbbb] animate-pulse" />
            <span>Local-First Coding Agent Network</span>
          </div>
          <h1 className="flex items-center justify-center gap-1.5 text-2xl font-bold tracking-tight text-foreground">
            chamber<span className="inline-block size-2 rounded-full bg-dot" />
            <span className="ml-1 rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Desktop</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Your agents talk to your teammates' agents directly. E2E encrypted through a relay in your team's Cloudflare account.
          </p>
        </div>

        {/* Tab switch */}
        <div className="mt-8 flex rounded-lg border bg-muted/40 p-1 text-xs font-medium">
          <button
            type="button"
            onClick={() => {
              setMode("join");
              setError("");
            }}
            className={`flex-1 rounded-md py-2 transition-all ${
              mode === "join" ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Join Team Chamber
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("new");
              setError("");
            }}
            className={`flex-1 rounded-md py-2 transition-all ${
              mode === "new" ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Create New Chamber (Admin)
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {mode === "join" ? (
          <form onSubmit={handleJoin} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                Invite Link, Token, or Command
              </label>
              <textarea
                rows={3}
                required
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                placeholder="Paste the personal invite your chamber admin sent you (or curl -fsSL ... command)"
                className="w-full font-mono text-xs rounded-lg border bg-background p-2.5 outline-none focus:border-ring focus:ring-1 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                Your Handle / Name (optional)
              </label>
              <input
                type="text"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="e.g. alex (leave empty for git username)"
                className="w-full text-xs rounded-lg border bg-background p-2.5 outline-none focus:border-ring focus:ring-1 focus:ring-ring"
              />
            </div>

            {/* Workspace & Detected Agents */}
            <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Folder className="size-3.5 text-primary" /> Connected Workspace
                </span>
                <button
                  type="button"
                  onClick={pickFolder}
                  className="text-[11px] text-primary hover:underline font-medium"
                >
                  Change Folder
                </button>
              </div>
              <p className="text-[11px] font-mono text-muted-foreground truncate" title={projectPath}>
                {projectPath || "Current workspace"}
              </p>

              <div className="pt-2 border-t border-border/50">
                <span className="block text-[11px] font-medium text-muted-foreground mb-2">
                  Detected Coding Agents (auto-connected on launch):
                </span>
                <div className="flex flex-wrap gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
                    harnesses.claude ? "bg-[#a8cbbb]/20 text-[#36634d] dark:text-[#a8cbbb]" : "bg-muted text-muted-foreground"
                  }`}>
                    <span className={`size-1.5 rounded-full ${harnesses.claude ? "bg-[#a8cbbb]" : "bg-muted-foreground"}`} />
                    Claude Code
                  </span>
                  <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
                    harnesses.codex ? "bg-[#a8cbbb]/20 text-[#36634d] dark:text-[#a8cbbb]" : "bg-muted text-muted-foreground"
                  }`}>
                    <span className={`size-1.5 rounded-full ${harnesses.codex ? "bg-[#a8cbbb]" : "bg-muted-foreground"}`} />
                    Codex
                  </span>
                  <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
                    harnesses.antigravity ? "bg-[#a8cbbb]/20 text-[#36634d] dark:text-[#a8cbbb]" : "bg-muted text-muted-foreground"
                  }`}>
                    <span className={`size-1.5 rounded-full ${harnesses.antigravity ? "bg-[#a8cbbb]" : "bg-muted-foreground"}`} />
                    Antigravity
                  </span>
                  <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
                    harnesses.dsh ? "bg-[#a8cbbb]/20 text-[#36634d] dark:text-[#a8cbbb]" : "bg-muted text-muted-foreground"
                  }`}>
                    <span className={`size-1.5 rounded-full ${harnesses.dsh ? "bg-[#a8cbbb]" : "bg-muted-foreground"}`} />
                    DeepSeek Harness
                  </span>
                </div>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading || !invite.trim()}
              className="w-full gap-2 text-xs h-10 font-medium"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Connecting to Chamber…
                </>
              ) : (
                <>
                  Join Chamber & Launch App <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </form>
        ) : (
          <div className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                Admin Handle / Name
              </label>
              <input
                type="text"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="e.g. admin or your name (default: git username)"
                className="w-full text-xs rounded-lg border bg-background p-2.5 outline-none focus:border-ring focus:ring-1 focus:ring-ring"
              />
            </div>

            {/* Cloudflare Deploy Method Toggle */}
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => setCreateMethod("auto")}
                className={cn(
                  "flex-1 rounded-lg border p-3 text-left transition-all",
                  createMethod === "auto" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/40"
                )}
              >
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <Cloud className="size-4 text-primary" />
                  1-Click Cloudflare Setup
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Automated relay deployment using your Cloudflare account. Opens browser for sign-in.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setCreateMethod("url")}
                className={cn(
                  "flex-1 rounded-lg border p-3 text-left transition-all",
                  createMethod === "url" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/40"
                )}
              >
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <Sparkles className="size-4 text-primary" />
                  Enter Worker URL
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  If you already deployed via the Deploy button or a custom domain.
                </p>
              </button>
            </div>

            {createMethod === "auto" ? (
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Cloudflare Account:</span>
                  {cfAuth?.authenticated ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#a8cbbb]/20 px-2 py-0.5 font-medium text-[#36634d] dark:text-[#a8cbbb]">
                      <span className="size-1.5 rounded-full bg-[#a8cbbb]" />
                      {cfAuth.account || "Signed In"}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#c5b4e3]/20 px-2 py-0.5 font-medium text-[#604988] dark:text-[#c5b4e3]">
                      <span className="size-1.5 rounded-full bg-[#c5b4e3] animate-pulse" />
                      Browser Login Required
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  This deploys the stateless Chamber relay worker and provisions encrypted attachment storage on your own Cloudflare account. Your admin Ed25519 key remains strictly on this machine.
                </p>

                <Button
                  type="button"
                  onClick={handleCloudflareAutoDeploy}
                  disabled={loading}
                  className="w-full gap-2 text-xs h-10 font-medium"
                >
                  {loading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Deploying to Cloudflare & Initializing…
                    </>
                  ) : (
                    <>
                      Deploy Relay & Start Chamber (Admin) <ArrowRight className="size-4" />
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Your Cloudflare Relay URL
                  </label>
                  <input
                    type="url"
                    required
                    value={relay}
                    onChange={(e) => setRelay(e.target.value)}
                    placeholder="https://my-chamber.my-subdomain.workers.dev"
                    className="w-full font-mono text-xs rounded-lg border bg-background p-2.5 outline-none focus:border-ring focus:ring-1 focus:ring-ring"
                  />
                </div>

                <div className="rounded-xl border bg-muted/20 p-4 space-y-2 text-xs text-muted-foreground">
                  <p className="leading-relaxed">
                    Deploy with one click to your free Cloudflare account:
                  </p>
                  <p className="text-[11px] text-muted-foreground pt-1">
                    <a
                      href="https://deploy.workers.cloudflare.com/?url=https://github.com/tura-learn/chamber/tree/main/relay"
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline font-semibold"
                    >
                      Deploy to Cloudflare in 2 minutes →
                    </a>
                  </p>
                </div>

                <Button
                  type="submit"
                  disabled={loading || !relay.trim()}
                  className="w-full gap-2 text-xs h-10 font-medium"
                >
                  {loading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Claiming Relay & Initializing…
                    </>
                  ) : (
                    <>
                      Initialize Chamber <Sparkles className="size-4" />
                    </>
                  )}
                </Button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
