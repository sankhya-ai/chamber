import { useCallback, useEffect, useState } from "react";

import { BoardPage } from "./components/BoardPage.tsx";
import { BoardRail } from "./components/BoardRail.tsx";
import { api } from "./lib/api.ts";
import type { BoardData } from "./lib/board.ts";

// The board: the conversations your agents are in, and your seat in them.

type Theme = "dark" | "light";

function stored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

const talkFromHash = () => /^#\/t\/(.+)$/.exec(location.hash)?.[1] ?? null;

export function App() {
  const [theme, setTheme] = useState<Theme>(() => stored("chamber:theme", "dark") as Theme);
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState("");
  const [workspace, setWorkspace] = useState<string | null>(() => stored("chamber:workspace", "") || null);
  const [open, setOpen] = useState<string | null>(talkFromHash);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    persist("chamber:theme", theme);
  }, [theme]);

  const refresh = useCallback(() => {
    api.board().then(
      (d) => {
        setData(d);
        setError("");
      },
      (e) => setError(e instanceof TypeError ? "The board is not running: start it with `chamber board`." : String(e.message)),
    );
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2500);
    const onHash = () => setOpen(talkFromHash());
    window.addEventListener("hashchange", onHash);
    return () => {
      clearInterval(timer);
      window.removeEventListener("hashchange", onHash);
    };
  }, [refresh]);

  const openTalk = (id: string | null) => {
    setOpen(id);
    history.replaceState(null, "", id && id !== "new" ? `#/t/${id}` : "#/");
  };

  return (
    <div className="boardStage">
      <BoardRail
        workspaces={data?.workspaces ?? []}
        active={workspace}
        theme={theme}
        onPick={(agent) => {
          setWorkspace(agent);
          persist("chamber:workspace", agent);
        }}
        onChanged={refresh}
        onTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />
      <BoardPage data={data} error={error} workspace={workspace} open={open} onOpen={openTalk} onChanged={refresh} />
    </div>
  );
}
