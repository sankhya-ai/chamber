import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { ArrowRight, Cloud, Folder, Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
export function OnboardingView({ onConfigured }) {
    const [mode, setMode] = useState("join");
    const [createMethod, setCreateMethod] = useState("auto");
    const [cfAuth, setCfAuth] = useState(null);
    const [invite, setInvite] = useState("");
    const [relay, setRelay] = useState("");
    const [handle, setHandle] = useState("");
    const [projectPath, setProjectPath] = useState("");
    const [harnesses, setHarnesses] = useState({
        claude: true,
        codex: false,
        antigravity: false,
        dsh: false,
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        api.detectHarnesses().then((res) => {
            if (res.harnesses)
                setHarnesses(res.harnesses);
            if (res.project)
                setProjectPath(res.project);
        }, () => undefined);
        api.cloudflareAuth().then((res) => setCfAuth(res), () => undefined);
    }, []);
    const handleJoin = async (e) => {
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
        }
        catch (err) {
            setError(err?.message || "Failed to join chamber. Please check your invite pass.");
        }
        finally {
            setLoading(false);
        }
    };
    const handleCloudflareAutoDeploy = async () => {
        setLoading(true);
        setError("");
        try {
            await api.cloudflareSetup(handle.trim() || undefined, projectPath || undefined);
            onConfigured();
        }
        catch (err) {
            setError(err?.message || "Failed to deploy Cloudflare relay. Please check your credentials.");
        }
        finally {
            setLoading(false);
        }
    };
    const handleCreate = async (e) => {
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
        }
        catch (err) {
            setError(err?.message || "Failed to initialize chamber relay.");
        }
        finally {
            setLoading(false);
        }
    };
    const pickFolder = async () => {
        try {
            const picked = await api.pickFolder();
            if (picked.path)
                setProjectPath(picked.path);
        }
        catch { }
    };
    return (_jsx("div", { className: "flex min-h-screen w-full items-center justify-center bg-background px-4 py-8", children: _jsxs("div", { className: "w-full max-w-xl rounded-2xl border bg-card p-8 shadow-xl", children: [_jsxs("div", { className: "text-center", children: [_jsxs("div", { className: "inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs font-mono font-medium text-muted-foreground mb-4", children: [_jsx("span", { className: "size-2 rounded-full bg-[#a8cbbb] animate-pulse" }), _jsx("span", { children: "Local-First Coding Agent Network" })] }), _jsxs("h1", { className: "flex items-center justify-center gap-1.5 text-2xl font-bold tracking-tight text-foreground", children: ["chamber", _jsx("span", { className: "inline-block size-2 rounded-full bg-dot" }), _jsx("span", { className: "ml-1 rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary", children: "Desktop" })] }), _jsx("p", { className: "mt-2 text-sm text-muted-foreground leading-relaxed", children: "Your agents talk to your teammates' agents directly. E2E encrypted through a relay in your team's Cloudflare account." })] }), _jsxs("div", { className: "mt-8 flex rounded-lg border bg-muted/40 p-1 text-xs font-medium", children: [_jsx("button", { type: "button", onClick: () => {
                                setMode("join");
                                setError("");
                            }, className: `flex-1 rounded-md py-2 transition-all ${mode === "join" ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"}`, children: "Join Team Chamber" }), _jsx("button", { type: "button", onClick: () => {
                                setMode("new");
                                setError("");
                            }, className: `flex-1 rounded-md py-2 transition-all ${mode === "new" ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground"}`, children: "Create New Chamber (Admin)" })] }), error ? (_jsx("div", { className: "mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive", children: error })) : null, mode === "join" ? (_jsxs("form", { onSubmit: handleJoin, className: "mt-6 space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-xs font-medium text-foreground mb-1.5", children: "Invite Link, Token, or Command" }), _jsx("textarea", { rows: 3, required: true, value: invite, onChange: (e) => setInvite(e.target.value), placeholder: "Paste the personal invite your chamber admin sent you (or curl -fsSL ... command)", className: "w-full font-mono text-xs rounded-lg border bg-background p-2.5 outline-none focus:border-ring focus:ring-1 focus:ring-ring" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-medium text-foreground mb-1.5", children: "Your Handle / Name (optional)" }), _jsx("input", { type: "text", value: handle, onChange: (e) => setHandle(e.target.value), placeholder: "e.g. alex (leave empty for git username)", className: "w-full text-xs rounded-lg border bg-background p-2.5 outline-none focus:border-ring focus:ring-1 focus:ring-ring" })] }), _jsxs("div", { className: "rounded-xl border bg-muted/20 p-4 space-y-3", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("span", { className: "text-xs font-semibold text-foreground flex items-center gap-1.5", children: [_jsx(Folder, { className: "size-3.5 text-primary" }), " Connected Workspace"] }), _jsx("button", { type: "button", onClick: pickFolder, className: "text-[11px] text-primary hover:underline font-medium", children: "Change Folder" })] }), _jsx("p", { className: "text-[11px] font-mono text-muted-foreground truncate", title: projectPath, children: projectPath || "Current workspace" }), _jsxs("div", { className: "pt-2 border-t border-border/50", children: [_jsx("span", { className: "block text-[11px] font-medium text-muted-foreground mb-2", children: "Detected Coding Agents (auto-connected on launch):" }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsxs("span", { className: `inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${harnesses.claude ? "bg-[#a8cbbb]/20 text-[#36634d] dark:text-[#a8cbbb]" : "bg-muted text-muted-foreground"}`, children: [_jsx("span", { className: `size-1.5 rounded-full ${harnesses.claude ? "bg-[#a8cbbb]" : "bg-muted-foreground"}` }), "Claude Code"] }), _jsxs("span", { className: `inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${harnesses.codex ? "bg-[#a8cbbb]/20 text-[#36634d] dark:text-[#a8cbbb]" : "bg-muted text-muted-foreground"}`, children: [_jsx("span", { className: `size-1.5 rounded-full ${harnesses.codex ? "bg-[#a8cbbb]" : "bg-muted-foreground"}` }), "Codex"] }), _jsxs("span", { className: `inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${harnesses.antigravity ? "bg-[#a8cbbb]/20 text-[#36634d] dark:text-[#a8cbbb]" : "bg-muted text-muted-foreground"}`, children: [_jsx("span", { className: `size-1.5 rounded-full ${harnesses.antigravity ? "bg-[#a8cbbb]" : "bg-muted-foreground"}` }), "Antigravity"] }), _jsxs("span", { className: `inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${harnesses.dsh ? "bg-[#a8cbbb]/20 text-[#36634d] dark:text-[#a8cbbb]" : "bg-muted text-muted-foreground"}`, children: [_jsx("span", { className: `size-1.5 rounded-full ${harnesses.dsh ? "bg-[#a8cbbb]" : "bg-muted-foreground"}` }), "DeepSeek Harness"] })] })] })] }), _jsx(Button, { type: "submit", disabled: loading || !invite.trim(), className: "w-full gap-2 text-xs h-10 font-medium", children: loading ? (_jsxs(_Fragment, { children: [_jsx(Loader2, { className: "size-4 animate-spin" }), " Connecting to Chamber\u2026"] })) : (_jsxs(_Fragment, { children: ["Join Chamber & Launch App ", _jsx(ArrowRight, { className: "size-4" })] })) })] })) : (_jsxs("div", { className: "mt-6 space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-xs font-medium text-foreground mb-1.5", children: "Admin Handle / Name" }), _jsx("input", { type: "text", value: handle, onChange: (e) => setHandle(e.target.value), placeholder: "e.g. admin or your name (default: git username)", className: "w-full text-xs rounded-lg border bg-background p-2.5 outline-none focus:border-ring focus:ring-1 focus:ring-ring" })] }), _jsxs("div", { className: "flex gap-2 text-xs", children: [_jsxs("button", { type: "button", onClick: () => setCreateMethod("auto"), className: cn("flex-1 rounded-lg border p-3 text-left transition-all", createMethod === "auto" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/40"), children: [_jsxs("div", { className: "flex items-center gap-2 font-semibold text-foreground", children: [_jsx(Cloud, { className: "size-4 text-primary" }), "1-Click Cloudflare Setup"] }), _jsx("p", { className: "mt-1 text-[11px] text-muted-foreground", children: "Automated relay deployment using your Cloudflare account. Opens browser for sign-in." })] }), _jsxs("button", { type: "button", onClick: () => setCreateMethod("url"), className: cn("flex-1 rounded-lg border p-3 text-left transition-all", createMethod === "url" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/40"), children: [_jsxs("div", { className: "flex items-center gap-2 font-semibold text-foreground", children: [_jsx(Sparkles, { className: "size-4 text-primary" }), "Enter Worker URL"] }), _jsx("p", { className: "mt-1 text-[11px] text-muted-foreground", children: "If you already deployed via the Deploy button or a custom domain." })] })] }), createMethod === "auto" ? (_jsxs("div", { className: "rounded-xl border bg-card p-4 space-y-3", children: [_jsxs("div", { className: "flex items-center justify-between text-xs", children: [_jsx("span", { className: "text-muted-foreground", children: "Cloudflare Account:" }), cfAuth?.authenticated ? (_jsxs("span", { className: "inline-flex items-center gap-1.5 rounded-full bg-[#a8cbbb]/20 px-2 py-0.5 font-medium text-[#36634d] dark:text-[#a8cbbb]", children: [_jsx("span", { className: "size-1.5 rounded-full bg-[#a8cbbb]" }), cfAuth.account || "Signed In"] })) : (_jsxs("span", { className: "inline-flex items-center gap-1.5 rounded-full bg-[#c5b4e3]/20 px-2 py-0.5 font-medium text-[#604988] dark:text-[#c5b4e3]", children: [_jsx("span", { className: "size-1.5 rounded-full bg-[#c5b4e3] animate-pulse" }), "Browser Login Required"] }))] }), _jsx("p", { className: "text-[11px] text-muted-foreground leading-relaxed", children: "This deploys the stateless Chamber relay worker and provisions encrypted attachment storage on your own Cloudflare account. Your admin Ed25519 key remains strictly on this machine." }), _jsx(Button, { type: "button", onClick: handleCloudflareAutoDeploy, disabled: loading, className: "w-full gap-2 text-xs h-10 font-medium", children: loading ? (_jsxs(_Fragment, { children: [_jsx(Loader2, { className: "size-4 animate-spin" }), " Deploying to Cloudflare & Initializing\u2026"] })) : (_jsxs(_Fragment, { children: ["Deploy Relay & Start Chamber (Admin) ", _jsx(ArrowRight, { className: "size-4" })] })) })] })) : (_jsxs("form", { onSubmit: handleCreate, className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-xs font-medium text-foreground mb-1.5", children: "Your Cloudflare Relay URL" }), _jsx("input", { type: "url", required: true, value: relay, onChange: (e) => setRelay(e.target.value), placeholder: "https://my-chamber.my-subdomain.workers.dev", className: "w-full font-mono text-xs rounded-lg border bg-background p-2.5 outline-none focus:border-ring focus:ring-1 focus:ring-ring" })] }), _jsxs("div", { className: "rounded-xl border bg-muted/20 p-4 space-y-2 text-xs text-muted-foreground", children: [_jsx("p", { className: "leading-relaxed", children: "Deploy with one click to your free Cloudflare account:" }), _jsx("p", { className: "text-[11px] text-muted-foreground pt-1", children: _jsx("a", { href: "https://deploy.workers.cloudflare.com/?url=https://github.com/tura-learn/chamber/tree/main/relay", target: "_blank", rel: "noreferrer", className: "text-primary hover:underline font-semibold", children: "Deploy to Cloudflare in 2 minutes \u2192" }) })] }), _jsx(Button, { type: "submit", disabled: loading || !relay.trim(), className: "w-full gap-2 text-xs h-10 font-medium", children: loading ? (_jsxs(_Fragment, { children: [_jsx(Loader2, { className: "size-4 animate-spin" }), " Claiming Relay & Initializing\u2026"] })) : (_jsxs(_Fragment, { children: ["Initialize Chamber ", _jsx(Sparkles, { className: "size-4" })] })) })] }))] }))] }) }));
}
