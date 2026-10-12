import { LayoutGrid, List, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CommandMenu } from "@/components/CommandMenu";
import { Composer } from "@/components/Composer";
import { Conversation } from "@/components/Conversation";
import { ChannelDialog, InviteDialog, MembersDialog } from "@/components/Dialogs";
import { MemoryView } from "@/components/MemoryView";
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
  inbox: "Nothing is waiting on you.",
  all: "No talks yet. Start one, or wait for a teammate's agent to ask.",
  channel: "Nothing said here yet.",
  person: "You haven't talked yet.",
  agent: "This agent hasn't talked with anyone yet.",
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

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    persist("chamber:theme", dark ? "dark" : "light");
  }, [dark]);

  const refresh = useCallback(() => {
    api.board().then(
      (d) => (setData(d), setError("")),
      (e) => setError(e instanceof TypeError ? "The board is not running: start it with `chamber board`." : String(e.message)),
    );
  }, []);

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
  const cards = useMemo(() => inView(data?.cards ?? [], route.view), [data, route.view]);
  const known = useMemo(() => {
    const names = people(data).map((p) => p.owner);
    const chans = (data?.channels ?? []).filter((c) => c.joined).map((c) => c.name);
    const agents = (data?.agents ?? []).map((a) => a.agent).filter((a) => !a.endsWith("/board"));
    return [...names, ...chans, ...agents];
  }, [data]);
  const here = addressFor(route.view);

  if (data && !data.configured) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Not in a chamber yet</h1>
          <p className="mt-1 text-muted-foreground">Run the join command your chamber's admin sent you, then reload.</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full gap-2 p-2">
        <Sidebar
          data={data}
          view={route.view}
          dark={dark}
          onView={openView}
          onSearch={() => setMenu(true)}
          onNewChannel={() => setChannels(true)}
          onInvite={() => setInvite(true)}
          onMembers={() => setMembers(true)}
          onTheme={() => setDark((v) => !v)}
          onChanged={refresh}
        />

        <main className="flex min-w-0 flex-1 overflow-clip rounded-xl border bg-background shadow-sm">
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
              <h1 className="font-semibold capitalize">{titleOf(route.view, me)}</h1>
              {error ? <span className="truncate text-[12px] text-destructive">{error}</span> : null}
              <div className={cn("ml-auto flex items-center gap-1", route.view.kind === "memory" && "hidden")}>
                <div className="flex rounded-md border p-0.5">
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
              <TalkList cards={cards} me={me} layout={layout} open={route.talk} onOpen={openTalk} empty={EMPTY[route.view.kind]} />
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
      <MembersDialog open={members} onOpenChange={setMembers} admin={data?.admin ?? false} me={me} onChanged={refresh} />
    </TooltipProvider>
  );
}
