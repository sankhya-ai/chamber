import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

const input = "w-full rounded-lg border bg-background p-2.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring";

export function OnboardingView({ onConfigured }: { onConfigured: () => void }) {
  const [step, setStep] = useState<"choose" | "create" | "join">("choose");
  const [invite, setInvite] = useState("");
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [project, setProject] = useState("");
  const [progress, setProgress] = useState("");
  // Create on your own server (a VM running vm.sh) instead of your Cloudflare account.
  const [ownServer, setOwnServer] = useState(false);
  const [relay, setRelay] = useState("");

  // The folder the app was started in becomes your first workspace; more are added in the app.
  useEffect(() => {
    api.detectHarnesses().then((res) => setProject(res.project || ""), () => undefined);
  }, []);

  // Going back abandons an attempt in flight, so its late result (or error) never shows on another screen.
  const attempt = useRef(0);
  const run = async (action: () => Promise<unknown>, fallback: string) => {
    const mine = ++attempt.current;
    setLoading(true);
    setError("");
    try {
      await action();
      if (mine === attempt.current) onConfigured();
    } catch (err: any) {
      if (mine === attempt.current) setError(err?.message || fallback);
    } finally {
      if (mine === attempt.current) setLoading(false);
    }
  };

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    void run(() => api.joinOnboarding(invite.trim(), handle.trim() || undefined, project || undefined), "That invite code didn't work. Ask your admin for a new one.");
  };

  // While a chamber is being created, show the step the server is on (sign-in, deploy, keys…).
  useEffect(() => {
    if (!loading || step !== "create") return setProgress("");
    const poll = setInterval(() => api.cloudflareProgress().then((res) => setProgress(res.progress), () => undefined), 1000);
    return () => clearInterval(poll);
  }, [loading, step]);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    if (ownServer) {
      void run(() => api.newOnboarding(relay.trim(), handle.trim() || undefined, project || undefined), "Couldn't reach that relay. Check the address and that the server is running.");
      return;
    }
    void run(() => api.cloudflareSetup(handle.trim() || undefined, project || undefined), "Couldn't create the chamber. Check your Cloudflare sign-in and try again.");
  };

  // Going back from a chamber being created cancels it on the server too, so it never finishes behind your back.
  const goBack = () => {
    if (loading && step === "create") void api.cloudflareCancel().catch(() => undefined);
    attempt.current++;
    setLoading(false);
    setStep("choose");
    setError("");
  };

  const back = (
    <button type="button" onClick={goBack} className="mb-4 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-3.5" /> Back
    </button>
  );

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="flex items-center justify-center gap-1.5 text-2xl font-bold tracking-tight">
            chamber<span className="inline-block size-2 rounded-full bg-dot" />
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Your agents and your teammates' agents, in one place.</p>
        </div>

        {error ? <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{error}</div> : null}

        {step === "choose" ? (
          <div className="space-y-3">
            <button type="button" onClick={() => setStep("create")} className="w-full rounded-xl border p-4 text-left transition hover:bg-muted/40">
              <div className="font-semibold">Create a chamber</div>
              <p className="mt-1 text-xs text-muted-foreground">Start one for your team. You'll be its admin and can invite everyone.</p>
            </button>
            <button type="button" onClick={() => setStep("join")} className="w-full rounded-xl border p-4 text-left transition hover:bg-muted/40">
              <div className="font-semibold">Join a chamber</div>
              <p className="mt-1 text-xs text-muted-foreground">Your admin sent you an invite code. Paste it and you're in.</p>
            </button>
          </div>
        ) : null}

        {step === "join" ? (
          <form onSubmit={join} className="space-y-4">
            {back}
            <div>
              <label className="mb-1.5 block text-xs font-medium">Invite code</label>
              <textarea rows={3} required autoFocus value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="https://…workers.dev/#…" className={`${input} font-mono text-xs`} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium">Your name</label>
              <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="Optional. Defaults to your git name" className={input} />
            </div>
            <Button type="submit" disabled={loading || !invite.trim()} className="h-10 w-full gap-2 text-sm">
              {loading ? <><Loader2 className="size-4 animate-spin" /> Joining…</> : <>Join chamber <ArrowRight className="size-4" /></>}
            </Button>
          </form>
        ) : null}

        {step === "create" ? (
          <form onSubmit={create} className="space-y-4">
            {back}
            <div>
              <label className="mb-1.5 block text-xs font-medium">Your name</label>
              <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="Optional. Defaults to your git name" className={input} />
            </div>
            {ownServer ? (
              <div>
                <label className="mb-1.5 block text-xs font-medium">Your relay's address</label>
                <input required autoFocus value={relay} onChange={(e) => setRelay(e.target.value)} placeholder="https://relay.example.com" className={`${input} font-mono text-xs`} />
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Run <code className="font-mono">vm.sh</code> on a Linux server or VM (Maritime, any cloud) and paste the address it prints. Messages stay end-to-end encrypted: the server only stores ciphertext.
                </p>
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Chamber sets up a private, end-to-end encrypted relay in your own free Cloudflare account. A browser window opens once to sign in to Cloudflare: finish signing in there, then come back here.
              </p>
            )}
            <button type="button" disabled={loading} onClick={() => { setOwnServer(!ownServer); setError(""); }} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              {ownServer ? "Use my Cloudflare account instead" : "Use my own server instead"}
            </button>
            <Button type="submit" disabled={loading || (ownServer && !relay.trim())} className="h-10 w-full gap-2 text-sm">
              {loading ? <><Loader2 className="size-4 animate-spin" /> {(!ownServer && progress.replace(/^\d\/\d\s*/, "")) || "Creating your chamber…"}</> : <>Create chamber <ArrowRight className="size-4" /></>}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
