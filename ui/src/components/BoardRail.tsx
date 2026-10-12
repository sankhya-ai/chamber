import { Check, Copy, Moon, Plus, Sun, X } from "lucide-react";
import { useState } from "react";

import { api } from "../lib/api.ts";
import type { Workspace } from "../lib/board.ts";

interface Props {
  workspaces: Workspace[];
  active: string | null;
  theme: "dark" | "light";
  onPick: (agent: string | null) => void;
  onChanged: () => void;
  onTheme: () => void;
}

/** The sidebar: your workspaces (to filter the board), add one, invite a teammate. */
export function BoardRail({ workspaces, active, theme, onPick, onChanged, onTheme }: Props) {
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState("");
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);

  const add = async () => {
    if (!path.trim()) return;
    try {
      await api.addWorkspace(path.trim());
      setNote("Added. Restart Claude Code there to connect.");
      setPath("");
      setAdding(false);
      onChanged();
    } catch (e) {
      setNote(String((e as Error).message));
    }
  };

  const remove = async (w: Workspace) => {
    try {
      await api.removeWorkspace(w.path);
      if (active === w.agent) onPick(null);
      onChanged();
    } catch (e) {
      setNote(String((e as Error).message));
    }
  };

  const invite = async () => {
    try {
      await navigator.clipboard.writeText((await api.invite()).command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setNote(String((e as Error).message));
    }
  };

  return (
    <aside className="boardRail">
      <div className="boardRailBrand">
        <span className="boardBrand">
          chamber<span className="boardBrandDot" />
        </span>
      </div>

      <div className="boardRailLabel">
        <span>Workspaces</span>
        <button className="boardIconBtn" title="Add a workspace" onClick={() => setAdding((v) => !v)}>
          {adding ? <X size={14} /> : <Plus size={14} />}
        </button>
      </div>
      {adding ? (
        <form className="boardAdd" onSubmit={(e) => (e.preventDefault(), void add())}>
          <input autoFocus placeholder="/path/to/project" value={path} onChange={(e) => setPath(e.target.value)} />
        </form>
      ) : null}
      <nav className="boardWorkspaces">
        <button className={`boardWorkspace ${active === null ? "active" : ""}`} onClick={() => onPick(null)}>
          <span className="boardDot all" />
          <span className="boardWorkspaceName">All</span>
        </button>
        {workspaces.map((w) => (
          <div key={w.agent} className={`boardWorkspace ${active === w.agent ? "active" : ""}`} onClick={() => onPick(w.agent)} role="button">
            <span className={`boardDot ${w.online ? "on" : ""}`} title={w.online ? "Connected" : "Not connected"} />
            <span className="boardWorkspaceName">{w.name}</span>
            {w.kind !== "claude-code" ? <span className="boardKind">{w.kind}</span> : null}
            {w.path ? (
              <button
                className="boardIconBtn ghost"
                title="Remove"
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(w);
                }}
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
        ))}
      </nav>
      {note ? <p className="boardNote" onClick={() => setNote("")}>{note}</p> : null}

      <div className="boardRailFoot">
        <button className="boardFootBtn" onClick={() => void invite()}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Invite teammate"}
        </button>
        <div className="boardFootRow">
          <button className="boardIconBtn" title="Theme" onClick={onTheme}>
            {theme === "dark" ? <Moon size={14} /> : <Sun size={14} />}
          </button>
        </div>
      </div>
    </aside>
  );
}
