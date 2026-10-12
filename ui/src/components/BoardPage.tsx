import { Plus } from "lucide-react";

import { ago, COLUMNS, column, who, type BoardData } from "../lib/board.ts";
import { TalkPanel } from "./TalkPanel.tsx";

interface Props {
  data: BoardData | null;
  error: string;
  workspace: string | null;
  open: string | null; // a talk id, "new", or null
  onOpen: (id: string | null) => void;
  onChanged: () => void;
}

/** Every conversation your agents are in, by where it stands. */
export function BoardPage({ data, error, workspace, open, onOpen, onChanged }: Props) {
  const me = data?.me ?? "";
  const place = workspace ? data?.workspaces.find((w) => w.agent === workspace)?.name ?? "" : "All workspaces";

  if (data && !data.configured) {
    return (
      <main className="boardMain">
        <div className="boardEmpty">
          <h2>Not in a chamber yet</h2>
          <p>Run the install command a teammate sent you, then reload.</p>
        </div>
      </main>
    );
  }

  return (
    <main className={`boardMain ${open ? "withTalk" : ""}`}>
      <header className="boardTop">
        <h1>{place}</h1>
        {data && !data.connected ? <span className="boardOffline">{data.problem || "connecting…"}</span> : null}
        {error ? <span className="boardOffline">{error}</span> : null}
        <button className="boardInk" onClick={() => onOpen("new")}>
          <Plus size={14} /> New talk
        </button>
      </header>

      <div className="boardColumns">
        {COLUMNS.map(({ status, label }) => {
          const cards = column(data?.cards ?? [], status, workspace);
          return (
            <section key={status} className={`boardColumn ${status}`}>
              <h3>
                {label} <span>{cards.length}</span>
              </h3>
              <div className="boardCards scroll">
                {cards.map((card) => (
                  <button key={card.id} className={`boardCard ${open === card.id ? "open" : ""}`} onClick={() => onOpen(card.id)}>
                    <span className="boardCardTitle">{card.title}</span>
                    <span className="boardCardFoot">
                      <span>{card.with.map((p) => who(p, me)).join(", ") || "your agents"}</span>
                      <span>
                        {card.count} · {ago(card.updated)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {open ? (
        <TalkPanel
          key={open}
          talkId={open === "new" ? null : open}
          me={me}
          agents={data?.agents ?? []}
          known={[...new Set((data?.cards ?? []).flatMap((c) => c.people))]}
          onClose={() => onOpen(null)}
          onStarted={(thread) => onOpen(thread)}
          onChanged={onChanged}
        />
      ) : null}
    </main>
  );
}
