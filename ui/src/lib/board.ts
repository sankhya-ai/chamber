// The board: conversations in the chamber as cards. Pure helpers, tested in board.test.ts.

export type Status = "waiting" | "talking" | "done";

export interface Card {
  id: string;
  title: string;
  status: Status;
  people: string[];
  with: string[];
  count: number;
  last: { from: string; text: string; ts: number };
  updated: number;
}

export interface TalkMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  ts: number;
  files: { name: string; size?: number; path?: string; error?: string }[];
}

export interface Talk extends Card {
  messages: TalkMessage[];
}

export interface Workspace {
  agent: string;
  name: string;
  kind: string;
  path: string;
  online: boolean;
}

export interface BoardData {
  configured: boolean;
  me: string;
  connected: boolean;
  problem: string;
  agents: { agent: string; kind: string; label: string; answers: boolean }[];
  workspaces: Workspace[];
  cards: Card[];
}

export const COLUMNS: { status: Status; label: string }[] = [
  { status: "waiting", label: "Waiting on you" },
  { status: "talking", label: "Talking" },
  { status: "done", label: "Done" },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "you", "your root", "your Claude · api", "Nitin", "Nitin's Claude · web", "Nitin's root". */
export function who(agent: string, me: string): string {
  if (agent === "*") return "everyone";
  if (agent.startsWith("@")) return agent.slice(1) === me ? "you" : cap(agent.slice(1));
  const [owner, name = ""] = agent.split("/");
  const mine = owner === me;
  if (mine && name === "board") return "you";
  const thing = name === "root" ? "root" : name.startsWith("claude-code.") ? `Claude · ${name.slice(12)}` : name === "board" ? "" : name;
  if (!thing) return cap(owner);
  return mine ? `your ${thing}` : `${cap(owner)}'s ${thing}`;
}

export const isMine = (agent: string, me: string) => agent.startsWith(`${me}/`) || agent === `@${me}`;

/** Cards for a column, limited to one workspace (an agent of yours) when one is picked. */
export function column(cards: Card[], status: Status, workspace: string | null): Card[] {
  return cards.filter((c) => c.status === status && (!workspace || c.people.includes(workspace)));
}

/** Who a message typed into a talk goes to by default: the last other party who spoke there. */
export function defaultRecipient(talk: Talk, me: string): string {
  for (const m of [...talk.messages].reverse()) {
    if (!isMine(m.from, me)) return m.from;
    if (!isMine(m.to, me) && m.to !== "*") return m.to;
  }
  return talk.with[0] ?? "";
}

/** Suggestions for who a message goes to: this talk's other parties, then teammates (online or
 *  ever talked with, also as `@person`), then your own agents. Anyone can be typed in. */
export function recipients(talk: Talk | null, me: string, agents: { agent: string }[], known: string[] = []): string[] {
  const out: string[] = [];
  const add = (a: string) => {
    if (a && a !== `${me}/board` && a !== "*" && a !== `@${me}` && !out.includes(a)) out.push(a);
  };
  talk?.with.forEach(add);
  const everyone = [...agents.map((a) => a.agent), ...known];
  const theirs = everyone.filter((a) => !isMine(a, me));
  for (const owner of theirs.map((a) => (a.startsWith("@") ? a.slice(1) : a.split("/")[0]))) add(`@${owner}`);
  theirs.filter((a) => !a.startsWith("@")).forEach(add);
  everyone.filter((a) => isMine(a, me)).forEach(add);
  return out;
}

/** What was typed into "to", as an address: a bare name means that person (`nitin` → `@nitin`). */
export function address(typed: string): string {
  const v = typed.trim().toLowerCase();
  if (!v || v.includes("/") || v.startsWith("@") || v === "*") return v;
  return `@${v}`;
}

export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
