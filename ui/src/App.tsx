import { Cpu, LayoutGrid, List, Plus, Shield, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentInspectorDialog } from "@/components/AgentInspectorDialog";
import { AppTopChrome } from "@/components/AppTopChrome";
import { AwayDialog } from "@/components/AwayDialog";
import { CommandMenu } from "@/components/CommandMenu";
import { Composer } from "@/components/Composer";
import { Conversation } from "@/components/Conversation";
import { CoordinationDialog } from "@/components/CoordinationDialog";
import { ChannelDialog, ChannelMembersDialog, InviteDialog, MembersDialog } from "@/components/Dialogs";
import { GatesDialog } from "@/components/GatesDialog";
import { MemoryView } from "@/components/MemoryView";
import { OnboardingView } from "@/components/OnboardingView";
import { SearchBar } from "@/components/SearchBar";
import { Sidebar } from "@/components/Sidebar";
import { TalkList } from "@/components/TalkList";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { addressFor, inView, people, titleOf, type BoardData, type View } from "@/lib/board";
import { format, parse, type Route } from "@/lib/route";
import { cn } from "@/lib/utils";

// chamber: Slack's layout (sidebar of channels and people) with Linear's lists and board,
// in root's design language. Everything your agents talk about, and your seat in it.

function stored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

const EMPTY: Record<View["kind"], string> = {
  inbox: "You're all caught up.",
  all: "No talks yet. Start one, or wait for a teammate's agent to ask.",
  channel: "Nothing said here yet.",
  person: "You haven't talked yet.",
  agent: "This agent hasn't talked with anyone yet.",
  project: "This project's agents haven't talked with anyone yet.",
  memory: "",
};

export function App() {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState("");
  const [route, setRoute] = useState<Route>(() => parse(location.hash));
  const [layout, setLayout] = useState<"list" | "board">(() => stored("chamber:layout", "list") as "list" | "board");
  const [dark, setDark] = useState(() => stored("chamber:theme", matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") === "dark");
  const [menu, setMenu] = useState(false);
  const [channels, setChannels] = useState(false);
  const [invite, setInvite] = useState(false);
  const [members, setMembers] = useState(false);
  const [channelPeople, setChannelPeople] = useState(false);
  const [gatesOpen, setGatesOpen] = useState(false);
  const [coordinationOpen, setCoordinationOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [awayOpen, setAwayOpen] = useState(false);
  const [pendingGatesCount, setPendingGatesCount] = useState(0);
  const [activeCoordinationCount, setActiveCoordinationCount] = useState(0);
  const [awayRunning, setAwayRunning] = useState(false);
  const [awayStatusText, setAwayStatusText] = useState("");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    persist("chamber:theme", dark ? "dark" : "light");
  }, [dark]);

  const refresh = useCallback(() => {
    api.board().then(
      (d) => (setData(d), setError("")),
      (e) => setError(e instanceof TypeError ? "The board is not running: start it with `chamber board`." : String(e.message)),
    );
    api.gates().then(
      (res) => setPendingGatesCount((res.gates || []).filter((g) => g.status === "pending").length),
      () => undefined
    );
    api.coordinationTasks().then(
      (res) => {
        const count = (res.tasks || []).filter((t) => t.status === "requested" || t.status === "claimed" || t.status === "in_progress").length;
        setActiveCoordinationCount(count);
      },
      () => undefined
    );
    api.awayStatus().then(
      (res) => {
        setAwayRunning(Boolean(res.running));
        if (res.status) setAwayStatusText(res.status);
      },
      () => undefined
    );
  }, []);

  // Desktop notifications when app is in background
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const prevUnreadRef = useRef<number>(0);
  useEffect(() => {
    if (!data) return;
    const totalUnread = data.cards.filter((c) => c.unread).length;
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted" &&
      document.hidden &&
      totalUnread > prevUnreadRef.current
    ) {
      const latest = data.cards.find((c) => c.unread);
      if (latest) {
        new Notification(`Chamber: ${latest.title}`, {
          body: `${latest.last?.from || "Teammate"}: ${latest.last?.text || "New message"}`,
        });
      }
    }
    prevUnreadRef.current = totalUnread;
  }, [data]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2500);
    const onHash = () => setRoute(parse(location.hash));
    addEventListener("hashchange", onHash);
    addEventListener("popstate", onHash);
    return () => {
      clearInterval(timer);
      removeEventListener("hashchange", onHash);
      removeEventListener("popstate", onHash);
    };
  }, [refresh]);

  const go = (next: Route) => {
    history.pushState(null, "", format(next));
    setRoute(next);
  };
  const openView = (view: View) => go({ view, talk: null });
  const openTalk = (talk: string | null) => go({ ...route, talk });

  // Keyboard: ⌘K anywhere; C for a new talk and Esc to close, when not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /input|textarea/i.test((e.target as HTMLElement)?.tagName ?? "");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMenu((v) => !v);
      } else if (!typing && !menu && e.key === "c" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        openTalk("new");
      } else if (!typing && e.key === "Escape" && route.talk) openTalk(null);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const me = data?.me ?? "";
  const cards = useMemo(() => inView(data?.cards ?? [], route.view, data?.projects ?? []), [data, route.view]);
  const known = useMemo(() => {
    const names = people(data).map((p) => p.owner);
    const chans = (data?.channels ?? []).filter((c) => c.joined).map((c) => c.name);
    const agents = (data?.agents ?? []).map((a) => a.agent).filter((a) => !a.endsWith("/board"));
    return [...names, ...chans, ...agents];
  }, [data]);
  const here = addressFor(route.view);

  if (data && !data.configured) {
    return <OnboardingView onConfigured={refresh} />;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
        <AppTopChrome
          data={data}
          dark={dark}
          activeCoordinationCount={activeCoordinationCount}
          pendingGatesCount={pendingGatesCount}
          awayActive={awayRunning}
          awayStatusText={awayStatusText}
          onSearch={() => setMenu(true)}
          onCoordination={() => setCoordinationOpen(true)}
          onGates={() => setGatesOpen(true)}
          onAway={() => setAwayOpen(true)}
          onTheme={() => setDark((v) => !v)}
          onOpenAgents={() => setAgentsOpen(true)}
        />

        <div className="flex min-h-0 flex-1 gap-2 p-2 overflow-hidden">
          <Sidebar
            data={data}
            view={route.view}
            dark={dark}
          pendingGatesCount={pendingGatesCount}
          activeCoordinationCount={activeCoordinationCount}
          awayActive={awayRunning}
          awayStatusText={awayStatusText}
          onView={openView}
          onSearch={() => setMenu(true)}
          onNewChannel={() => setChannels(true)}
          onInvite={() => setInvite(true)}
          onMembers={() => setMembers(true)}
          onGates={() => setGatesOpen(true)}
          onCoordination={() => setCoordinationOpen(true)}
          onAway={() => setAwayOpen(true)}
          onTheme={() => setDark((v) => !v)}
          onChanged={refresh}
        />

        <main className="flex min-w-0 flex-1 overflow-clip rounded-xl border bg-background shadow-sm">
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
              <h1 className="font-semibold capitalize">{titleOf(route.view, me)}</h1>
              {route.view.kind === "channel" ? (
                <button onClick={() => setChannelPeople(true)} className="flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground" title="People in this channel">
                  <Users className="size-3.5" />
                  {data?.channels.find((c) => route.view.kind === "channel" && c.name === route.view.name)?.members.length ?? 0}
                </button>
              ) : null}
              {error ? <span className="truncate text-[12px] text-destructive">{error}</span> : null}

              <div className="ml-auto flex items-center gap-2">
                <SearchBar onOpenTalk={(id) => go({ view: { kind: "all" }, talk: id })} />

                {activeCoordinationCount > 0 ? (
                  <button
                    onClick={() => setCoordinationOpen(true)}
                    className="flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-xs font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-500/20"
                    title="Review active agent coordination tasks"
                  >
                    <Cpu className="size-3.5 text-violet-500" />
                    <span>{activeCoordinationCount} Task{activeCoordinationCount === 1 ? "" : "s"}</span>
                  </button>
                ) : null}

                {pendingGatesCount > 0 ? (
                  <button
                    onClick={() => setGatesOpen(true)}
                    className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
                    title="Review pending approval gates"
                  >
                    <Shield className="size-3.5 text-amber-500" />
                    <span>{pendingGatesCount} Gate{pendingGatesCount === 1 ? "" : "s"}</span>
                  </button>
                ) : null}

                {/* Real Agent & User Presence Strip */}
                {(() => {
                  const isConnected = Boolean(data?.connected);
                  const onlineAgents = data?.workspaces.filter((w) => w.online).length ?? 0;
                  const runningCards = data?.cards.filter((c) => c.status === "talking").length ?? 0;

                  let dotClass = "bg-emerald-500";
                  let label = "Online";
                  let title = `Connected to Chamber relay as @${data?.me || "user"}. Click to set Away Mode.`;

                  if (!isConnected) {
                    dotClass = "bg-amber-500 animate-pulse";
                    label = "Connecting…";
                    title = "Connecting to Chamber relay… Click to check status.";
                  } else if (awayRunning) {
                    dotClass = "bg-amber-500 animate-pulse";
                    label = "Away";
                    title = `Away mode active: ${awayStatusText || "Agents auto-handling tasks"}. Click to configure.`;
                  } else if (onlineAgents > 0) {
                    dotClass = "bg-emerald-500";
                    label = `${onlineAgents} ${onlineAgents === 1 ? "agent" : "agents"} · ${
                      runningCards > 0 ? `${runningCards} running` : "idle"
                    }`;
                    title = `${onlineAgents} coding agent(s) active on this machine. Click to set Away Mode.`;
                  } else {
                    dotClass = "bg-emerald-500";
                    label = "Online";
                    title = `Connected to Chamber relay as @${data?.me || "user"}. No background agents running. Click to set Away Mode.`;
                  }

                  return (
                    <button
                      onClick={() => setAwayOpen(true)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                        awayRunning || !isConnected
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : "border-border/60 bg-muted/40 text-foreground hover:bg-accent"
                      )}
                      title={title}
                    >
                      <span className={cn("size-2 rounded-full", dotClass)} />
                      <span>{label}</span>
                    </button>
                  );
                })()}

                <div className={cn("flex rounded-md border p-0.5", route.view.kind !== "all" && "hidden")}>
                  {(["list", "board"] as const).map((l) => (
                    <button
                      key={l}
                      aria-label={l}
                      onClick={() => {
                        setLayout(l);
                        persist("chamber:layout", l);
                      }}
                      className={cn("inline-flex h-6 w-7 items-center justify-center rounded text-muted-foreground", layout === l && "bg-accent text-foreground")}
                    >
                      {l === "list" ? <List className="size-3.5" /> : <LayoutGrid className="size-3.5" />}
                    </button>
                  ))}
                </div>

                <Button size="sm" onClick={() => openTalk("new")}>
                  <Plus /> New talk
                </Button>
              </div>
            </header>

            {route.view.kind === "memory" ? (
              <MemoryView onTalk={(id) => go({ view: { kind: "all" }, talk: id })} />
            ) : (
              <TalkList
                cards={cards}
                me={me}
                layout={route.view.kind === "inbox" ? "inbox" : route.view.kind === "all" ? layout : "list"}
                open={route.talk}
                onOpen={openTalk}
                onDone={(id) => void api.markDone(id).then(refresh)}
                empty={EMPTY[route.view.kind]}
              />
            )}

            {here && !route.talk ? (
              <div className="border-t pt-3">
                <Composer
                  placeholder={`Message ${route.view.kind === "channel" ? here : titleOf(route.view, me)}… (starts a new talk)`}
                  people={people(data).map((p) => p.owner)}
                  onSend={async (text) => {
                    const started = await api.startTalk(here, text, text.split("\n")[0].slice(0, 80));
                    refresh();
                    openTalk(started.thread);
                  }}
                />
              </div>
            ) : null}
          </div>

          {route.talk ? (
            <Conversation
              key={route.talk}
              talkId={route.talk === "new" ? null : route.talk}
              me={me}
              to={here}
              people={known}
              onClose={() => openTalk(null)}
              onStarted={(thread) => openTalk(thread)}
              onChanged={refresh}
            />
          ) : null}
        </main>
      </div>
    </div>

      <CommandMenu
        open={menu}
        onOpenChange={setMenu}
        data={data}
        onView={openView}
        onTalk={(id) => go({ view: { kind: "all" }, talk: id })}
        onNewTalk={() => openTalk("new")}
        onNewChannel={() => setChannels(true)}
        onInvite={() => setInvite(true)}
        onTheme={() => setDark((v) => !v)}
      />
      <ChannelDialog
        open={channels}
        onOpenChange={setChannels}
        data={data}
        onJoined={(name) => {
          refresh();
          openView({ kind: "channel", name });
        }}
      />
      <InviteDialog open={invite} onOpenChange={setInvite} />
      {route.view.kind === "channel" ? (
        <ChannelMembersDialog
          open={channelPeople}
          onOpenChange={setChannelPeople}
          data={data}
          channel={route.view.name}
          onLeft={() => openView({ kind: "inbox" })}
          onChanged={refresh}
        />
      ) : null}
      <MembersDialog open={members} onOpenChange={setMembers} admin={data?.admin ?? false} me={me} data={data} onChanged={refresh} />
      <GatesDialog open={gatesOpen} onOpenChange={setGatesOpen} me={me} onChanged={refresh} />
      <CoordinationDialog open={coordinationOpen} onOpenChange={setCoordinationOpen} me={me} />
      <AgentInspectorDialog open={agentsOpen} onOpenChange={setAgentsOpen} data={data} onChanged={refresh} />
      <AwayDialog open={awayOpen} onOpenChange={setAwayOpen} me={me} onChanged={refresh} />
    </TooltipProvider>
  );
}
