import { Circle, CircleDot } from "lucide-react";

import { Avatar } from "@/components/Avatar";
import { ago, personOf, STATUSES, who, type Card, type Status } from "@/lib/board";
import { cn } from "@/lib/utils";

const ICON: Record<Status, React.ReactNode> = {
  waiting: <CircleDot className="size-3.5 text-waiting" />,
  talking: <Circle className="size-3.5 text-muted-foreground" />,
};

function People({ card, me }: { card: Card; me: string }) {
  const names = [...new Set(card.with.map((p) => personOf(p, me)))];
  return (
    <span className="flex -space-x-1">
      {names.slice(0, 3).map((n) => (
        <Avatar key={n} name={n} size={18} className="ring-2 ring-background rounded-full" />
      ))}
    </span>
  );
}

function Row({ card, me, open, onOpen }: { card: Card; me: string; open: boolean; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className={cn("flex h-9 w-full items-center gap-3 border-b border-border/60 px-4 text-left hover:bg-accent/60", open && "bg-accent")}
    >
      {ICON[card.status]}
      <span className={cn("min-w-0 flex-1 truncate", card.unread ? "font-semibold" : "text-muted-foreground")}>{card.title}</span>
      {card.channel ? <span className="text-muted-foreground">{card.channel}</span> : null}
      <People card={card} me={me} />
      <span className="w-8 text-right text-muted-foreground tabular-nums">{card.count}</span>
      <span className="w-8 text-right text-muted-foreground">{ago(card.updated)}</span>
    </button>
  );
}

function Tile({ card, me, open, onOpen }: { card: Card; me: string; open: boolean; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className={cn("flex w-full flex-col gap-2 rounded-lg border bg-card p-3 text-left shadow-xs hover:border-muted-foreground/40", open && "border-ring")}>
      <span className="flex items-start gap-2">
        <span className="mt-0.5">{ICON[card.status]}</span>
        <span className="line-clamp-2">{card.title}</span>
      </span>
      <span className="flex items-center gap-2 text-muted-foreground">
        <People card={card} me={me} />
        {card.channel ? <span>{card.channel}</span> : null}
        <span className="ml-auto">{card.count} · {ago(card.updated)}</span>
      </span>
    </button>
  );
}

/** Gmail's inbox: who it's from, the subject, the last message, when. Nothing else. */
function Inbox({ cards, me, open, onOpen }: { cards: Card[]; me: string; open: string | null; onOpen: (id: string) => void }) {
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      {cards.map((c) => {
        const from = c.last.from;
        return (
          <button key={c.id} onClick={() => onOpen(c.id)} className={cn("flex h-12 w-full items-center gap-3 border-b border-border/60 px-4 text-left hover:bg-accent/60", open === c.id && "bg-accent", !c.unread && "text-muted-foreground")}>
            <span className={cn("size-1.5 shrink-0 rounded-full", c.unread ? "bg-dot" : "bg-transparent")} />
            <Avatar name={personOf(from, me)} size={26} className={c.unread ? "" : "opacity-60"} />
            <span className={cn("w-44 shrink-0 truncate first-letter:uppercase", c.unread ? "font-semibold text-foreground" : "font-normal")}>{who(from, me)}</span>
            <span className="min-w-0 flex-1 truncate">
              <span className={c.unread ? "font-semibold text-foreground" : ""}>{c.title}</span>
              <span className="text-muted-foreground"> — {c.last.text}</span>
            </span>
            {c.channel ? <span className="shrink-0 text-muted-foreground">{c.channel}</span> : null}
            <span className={cn("w-10 shrink-0 text-right text-[12px]", c.unread ? "font-semibold text-foreground" : "text-muted-foreground")}>{ago(c.updated)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Gmail's inbox, Linear's list (grouped by status), or a board (a column per status). */
export function TalkList({ cards, me, layout, open, onOpen, empty }: {
  cards: Card[];
  me: string;
  layout: "inbox" | "list" | "board";
  open: string | null;
  onOpen: (id: string) => void;
  empty: string;
}) {
  if (!cards.length) return <div className="flex flex-1 items-center justify-center p-8 text-muted-foreground">{empty}</div>;
  if (layout === "inbox") return <Inbox cards={cards} me={me} open={open} onOpen={onOpen} />;

  if (layout === "board") {
    return (
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-hidden p-3">
        {STATUSES.map(({ status, label }) => {
          const column = cards.filter((c) => c.status === status);
          return (
            <section key={status} className="flex min-h-0 flex-col rounded-lg bg-muted/60">
              <h3 className="flex items-center gap-2 px-3 py-2 font-medium">
                {ICON[status]} {label} <span className="text-muted-foreground">{column.length}</span>
              </h3>
              <div className="scroll-thin flex flex-col gap-2 overflow-y-auto px-2 pb-2">
                {column.map((c) => <Tile key={c.id} card={c} me={me} open={open === c.id} onOpen={() => onOpen(c.id)} />)}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      {STATUSES.map(({ status, label }) => {
        const group = cards.filter((c) => c.status === status);
        if (!group.length) return null;
        return (
          <section key={status}>
            <h3 className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b bg-muted/80 px-4 text-[12px] font-medium backdrop-blur">
              {ICON[status]} {label} <span className="text-muted-foreground">{group.length}</span>
            </h3>
            {group.map((c) => <Row key={c.id} card={c} me={me} open={open === c.id} onOpen={() => onOpen(c.id)} />)}
          </section>
        );
      })}
    </div>
  );
}
