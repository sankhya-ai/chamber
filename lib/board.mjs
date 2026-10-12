// The board: every conversation your agents are in, as cards — and your seat in them.
//
//   Waiting   the last word is someone else's, to you or one of your agents
//   Talking   anything else still open (you or your agent spoke last)
//   Done      you closed it (~/.chamber/board.json)
//
// A conversation is a thread: a message starts one (its own id) and every reply
// carries it on; messages from older clients follow `reply_to` back to one.
// Cards come from every agent's log in ~/.chamber/agents (inbox.jsonl, sent.jsonl).
// You take part as `<you>/board`: what you type in a card is sent from there.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { LineClient } from "./client.mjs";
import { HOME, Inbox } from "./inbox.mjs";
import { LineError } from "./protocol.mjs";

export const SEAT = "board";

function threadOf(record, known) {
  return String(record.thread || known.get(String(record.reply_to || "")) || record.reply_to || record.id);
}

/** Group messages into conversations and say where each stands, newest activity first. */
export function threads(records, owner, done) {
  const mine = (agent) => String(agent || "").startsWith(`${owner}/`) || String(agent || "") === `@${owner}`;
  const known = new Map();
  const cards = new Map();
  for (const record of records) {
    const id = threadOf(record, known);
    known.set(record.id, id);
    const card = cards.get(id) ?? { id, title: "", messages: [], people: [] };
    cards.set(id, card);
    card.messages.push(record);
    card.title ||= record.title || String(record.text || "").trim().split("\n")[0].slice(0, 80) || "(untitled)";
    for (const agent of [record.from, record.to]) if (agent && agent !== "*" && !card.people.includes(agent)) card.people.push(agent);
  }
  return [...cards.values()]
    .map((card) => {
      const last = card.messages.at(-1);
      const status = done.has(card.id) ? "done" : !mine(last.from) && mine(last.to) ? "waiting" : "talking";
      return {
        id: card.id,
        title: card.title,
        status,
        people: card.people,
        with: card.people.filter((p) => !mine(p)),
        count: card.messages.length,
        last: { from: last.from, text: String(last.text || "").slice(0, 160), ts: last.ts },
        updated: last.ts || 0,
        messages: card.messages,
      };
    })
    .sort((a, b) => b.updated - a.updated);
}

/** Every message any of `owner`'s agents sent or received, oldest first, one copy each. */
export function readAll(owner) {
  const root = join(HOME, "agents");
  const seen = new Map();
  for (const dir of existsSync(root) ? readdirSync(root).filter((d) => d.startsWith(`${owner}__`)).sort() : []) {
    for (const name of ["sent.jsonl", "inbox.jsonl"]) {
      let lines = [];
      try {
        lines = readFileSync(join(root, dir, name), "utf8").split("\n");
      } catch {
        continue;
      }
      for (const line of lines) {
        try {
          const record = JSON.parse(line);
          if (record?.id && !seen.has(record.id)) seen.set(record.id, record); // between two of your agents: in both logs
        } catch {}
      }
    }
  }
  return [...seen.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

export class Board {
  constructor(config) {
    this.config = config;
    this.owner = config.owner;
    this.agent = `${config.owner}/${SEAT}`;
    this.inbox = new Inbox(this.agent);
    this.statePath = join(HOME, "board.json");
    this.seat = new LineClient(config.invite, this.agent, {
      kind: "human",
      label: "you, on the board",
      cursorPath: this.inbox.cursorPath,
      onMessage: (message) => this.inbox.add(message),
    });
  }

  start() {
    this.seat.run();
  }

  close() {
    this.seat.close();
  }

  done() {
    try {
      return new Set(JSON.parse(readFileSync(this.statePath, "utf8")).done || []);
    } catch {
      return new Set();
    }
  }

  setDone(id, done) {
    const current = this.done();
    if (done) current.add(id);
    else current.delete(id);
    writeFileSync(this.statePath, JSON.stringify({ done: [...current].sort() }));
  }

  workspaces() {
    const online = new Set(this.seat.roster.map((a) => a.agent));
    const root = join(HOME, "agents");
    const out = [];
    const add = (agent, path) => {
      if (agent === this.agent || out.some((w) => w.agent === agent)) return;
      const name = agent.split("/")[1];
      const kind = name.startsWith("claude-code.") ? "claude-code" : name;
      out.push({ agent, name: path ? basename(path) : name.replace(/^claude-code\./, ""), kind, path, online: online.has(agent) });
    };
    for (const dir of existsSync(root) ? readdirSync(root).filter((d) => d.startsWith(`${this.owner}__`)).sort() : []) {
      const agent = `${this.owner}/${dir.slice(this.owner.length + 2)}`;
      let path = "";
      try {
        path = String(JSON.parse(readFileSync(join(root, dir, "project.json"), "utf8")).path || "");
      } catch {}
      if (path || online.has(agent)) add(agent, path); // a project set up with `chamber setup`, or an agent of yours that is here now
    }
    for (const agent of [...online].sort()) if (agent.startsWith(`${this.owner}/`)) add(agent, "");
    return out;
  }

  overview() {
    return {
      configured: true,
      me: this.owner,
      connected: this.seat.connected,
      problem: this.seat.problem,
      agents: this.seat.roster,
      workspaces: this.workspaces(),
      cards: threads(readAll(this.owner), this.owner, this.done()).map(({ messages, ...card }) => card),
    };
  }

  conversation(id) {
    const card = threads(readAll(this.owner), this.owner, this.done()).find((c) => c.id === id);
    if (!card) return null;
    const messages = card.messages.map(({ id, from, to, text, ts, files, dir }) => ({ id, from, to, text, ts, files: files || [], dir }));
    return { ...card, messages };
  }

  /** Send from your seat: a new conversation, or into one (`thread`). */
  async say(to, text, { thread = null, title = "" } = {}) {
    let replyTo = null;
    if (thread) {
      const convo = this.conversation(thread);
      if (!convo) throw new LineError("no such conversation");
      title = convo.title;
      replyTo = convo.messages.at(-1).id;
    }
    title ||= text.split("\n")[0].slice(0, 80);
    const receipt = await this.seat.send(to, text, { replyTo, thread, title });
    this.inbox.sent(receipt, { to, text, replyTo, title });
    this.setDone(receipt.thread, false);
    return receipt;
  }

  invite() {
    return `curl -fsSL ${this.config.invite.relay}/install | sh -s -- ${this.config.invite.secret}`;
  }
}
