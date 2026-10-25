import { Bot, ChevronLeft, ChevronRight, Cpu, Moon, Search, Shield, Sun } from "lucide-react";
import { type BoardData } from "@/lib/board";
import { cn } from "@/lib/utils";

interface AppTopChromeProps {
  data: BoardData | null;
  dark: boolean;
  activeCoordinationCount?: number;
  pendingGatesCount?: number;
  awayActive?: boolean;
  awayStatusText?: string;
  onSearch: () => void;
  onCoordination: () => void;
  onGates: () => void;
  onAway: () => void;
  onTheme: () => void;
  onOpenAgents?: () => void;
}

export function AppTopChrome({
  data,
  dark,
  activeCoordinationCount = 0,
  pendingGatesCount = 0,
  awayActive = false,
  awayStatusText = "",
  onSearch,
  onCoordination,
  onGates,
  onAway,
  onTheme,
  onOpenAgents,
}: AppTopChromeProps) {
  const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
  const onlineAgents = data?.workspaces?.filter((w) => w.online)?.length ?? 0;
  const isConnected = Boolean(data?.connected);

  return (
    <header
      className="flex h-10 w-full shrink-0 select-none items-center justify-between border-b bg-background/95 px-3 text-xs backdrop-blur-md z-30"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      data-tauri-drag-region
    >
      {/* Left: Window Traffic Light clearance + Navigation */}
      <div
        className={cn("flex items-center gap-2", isMac ? "pl-[72px]" : "pl-1")}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div className="flex items-center gap-0.5 text-muted-foreground">
          <button
            onClick={() => window.history.back()}
            title="Back"
            className="inline-flex size-6 items-center justify-center rounded hover:bg-accent hover:text-foreground transition-colors"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <button
            onClick={() => window.history.forward()}
            title="Forward"
            className="inline-flex size-6 items-center justify-center rounded hover:bg-accent hover:text-foreground transition-colors"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>

        <span className="hidden sm:inline-flex items-baseline gap-1 font-semibold text-foreground tracking-tight text-xs">
          chamber<span className="inline-block size-1.5 rounded-full bg-dot" />
        </span>
      </div>

      {/* Center: Global Search Bar Button (⌘K) */}
      <div
        className="flex max-w-sm flex-1 items-center justify-center px-2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={onSearch}
          className="flex h-7 w-full max-w-xs items-center justify-between rounded-md border bg-muted/40 px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-all"
        >
          <span className="flex items-center gap-1.5 truncate">
            <Search className="size-3 text-muted-foreground" />
            <span className="truncate">Search talks, contracts, decisions...</span>
          </span>
          <kbd className="pointer-events-none rounded border bg-background px-1 py-0.5 text-[10px] font-mono font-medium text-muted-foreground shadow-2xs">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right: Presence, Quotas, Gates, and Tools */}
      <div
        className="flex items-center gap-1.5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {/* Cloudflare Quota Badge */}
        {data?.quota ? (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-mono font-medium tracking-tight",
              data.quota.warning
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                : "bg-muted text-muted-foreground"
            )}
            title={`Cloudflare DO Quota: ${data.quota.dailyRequests.toLocaleString()} / ${data.quota.dailyRequestsLimit.toLocaleString()} reqs (${data.quota.requestsPercentage}%)`}
          >
            CF {data.quota.requestsPercentage}%
          </span>
        ) : null}

        {/* Agent Presence Pill */}
        <button
          onClick={onOpenAgents}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
            !isConnected
              ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : onlineAgents > 0
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
          title={
            !isConnected
              ? "Connecting to Cloudflare Relay…"
              : `${onlineAgents} coding agent(s) connected on this computer. Click to inspect.`
          }
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              !isConnected ? "bg-amber-500 animate-pulse" : onlineAgents > 0 ? "bg-emerald-500" : "bg-muted-foreground/60"
            )}
          />
          <span>{onlineAgents} {onlineAgents === 1 ? "Agent" : "Agents"}</span>
        </button>

        {/* Coordination Tasks Pill */}
        {activeCoordinationCount > 0 ? (
          <button
            onClick={onCoordination}
            className="flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-500/20"
            title="Review active agent coordination tasks"
          >
            <Cpu className="size-3 text-violet-500" />
            <span>{activeCoordinationCount} Task{activeCoordinationCount === 1 ? "" : "s"}</span>
          </button>
        ) : null}

        {/* Approval Gates Pill */}
        {pendingGatesCount > 0 ? (
          <button
            onClick={onGates}
            className="flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
            title="Review pending cryptographic approval gates"
          >
            <Shield className="size-3 text-amber-500" />
            <span>{pendingGatesCount} Gate{pendingGatesCount === 1 ? "" : "s"}</span>
          </button>
        ) : null}

        {/* Away Mode Pill */}
        <button
          onClick={onAway}
          title={awayActive ? `Away responder active: ${awayStatusText}` : "Click to configure Away Mode"}
          className={cn(
            "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition-colors",
            awayActive
              ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <Bot className="size-3 text-amber-500" />
          <span className="hidden md:inline">{awayActive ? "Away" : "Active"}</span>
        </button>

        {/* Theme Toggle */}
        <button
          onClick={onTheme}
          title={dark ? "Light mode" : "Dark mode"}
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </button>
      </div>
    </header>
  );
}
