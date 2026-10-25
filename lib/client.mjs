// One agent's connection to a line: join, see who is there, send, ask, receive.
//
//   const client = new LineClient(invite, "nitin/claude-code.api", { kind: "claude-code", answers: true });
//   client.run();                                   // connects, reconnects, forever
//   const { reply } = await client.ask("@ashish", "Which port does the dev server use?");
//
// Messages that are not the reply to this client's own `ask` go to `onMessage`.
// The relay keeps what is sent while an agent is away; `cursor` (saved to
// `cursorPath`) is how far this agent has read, so a reconnect gets exactly what
// it missed.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { AGENT, INLINE_FILE_BYTES, LineError } from "./protocol.mjs";

/**
 * Someone else's board is a person watching, not an agent, and Chamber is agent to agent:
 * a message to `owner/board` goes as `@owner`, to that person's chosen agent, and their
 * board keeps a copy (it listens). A reply typed into a talk that a board started went to
 * the board alone, and nobody answered it. Sealed as `@owner`, so the agent can open it.
 */
export function forPerson(to, from) {
  const match = /^([a-z0-9][a-z0-9._-]{0,31})\/board$/.exec(to);
  if (!match || match[1] === String(from).split("/")[0]) return to;
  return `@${match[1]}`;
}

const BACKOFF = [1, 2, 5, 10, 30];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

export class LineClient {
  constructor(invite, agent, { kind = "agent", label = "", priority = 0, answers = false, listens = false, cursorPath = null, onMessage = null } = {}) {
    if (!AGENT.test(agent)) throw new LineError("an agent is named owner/name, lowercase, e.g. nitin/claude-code");
    this.invite = invite;
    this.agent = agent;
    // listens: gets all of its channels' messages (a board), not only the ones @mentioning its owner.
    this.hello = { t: "hello", agent, kind, label, priority, answers, listens };
    this.channels = [];
    this.cursorPath = cursorPath;
    this.onMessage = onMessage;
    this.roster = [];
    this.problem = "";
    this.connected = false;
    this.cursor = this.#loadCursor();
    this.ws = null;
    this.acks = new Map();
    this.replies = new Map();
    this.waiters = [];
    this.stopped = false;
    this.#queue = Promise.resolve();
  }

  #queue = Promise.resolve();

  // ----- the connection ---------------------------------------------------------

  async run() {
    await this.invite.ready();
    for (let attempt = 0; !this.stopped; attempt++) {
      const opened = await this.#connectOnce();
      if (this.stopped) break;
      if (opened && !this.refused) attempt = 0;
      // Refused (no invite, or removed): try again rarely, not every few seconds.
      await sleep(this.refused ? 300_000 : BACKOFF[Math.min(attempt, BACKOFF.length - 1)] * 1000);
    }
  }

  #connectOnce() {
    return new Promise((resolve) => {
      let opened = false;
      const ws = new WebSocket(this.invite.wsUrl, { headers: this.invite.auth });
      this.ws = ws;
      ws.onopen = () => {
        opened = true;
        ws.send(JSON.stringify({ ...this.hello, since: this.cursor, ...(this.invite.pass ? { pass: this.invite.pass } : {}) }));
      };
      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data));
          this.#frame(parsed).catch((error) => (this.problem = String(error.message)));
        } catch (error) {
          this.problem = String(error.message);
        }
      };
      ws.onerror = () => {
        if (!opened) this.problem = "relay unreachable, or it refused this invite";
      };
      ws.onclose = (event) => {
        this.refused = event.code === 4003;
        if (this.refused) this.problem = event.reason || "the chamber refused this member";
        this.ws = null;
        this.connected = false;
        for (const { reject } of this.acks.values()) reject(new LineError("the connection to the relay dropped"));
        this.acks.clear();
        resolve(opened);
      };
    });
  }

  close() {
    this.stopped = true;
    this.ws?.close(1000);
  }

  /** Resolves once connected (or rejects after `ms`). */
  async ready(ms = 15000) {
    if (this.connected) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new LineError(`not connected to the line (${this.problem || "connecting"})`)), ms);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async #frame(frame) {
    if (frame.t === "welcome") {
      this.roster = frame.agents || [];
      this.channels = frame.channels || [];
      this.problem = "";
      this.connected = true;
      for (const wake of this.waiters.splice(0)) wake();
    } else if (frame.t === "roster") {
      this.roster = frame.agents || [];
    } else if (frame.t === "channels") {
      this.channels = frame.channels || [];
    } else if (frame.t === "sent") {
      this.acks.get(frame.id)?.resolve(frame);
      this.acks.delete(frame.id);
    } else if (frame.t === "error") {
      const ack = this.acks.get(frame.id || "");
      if (ack) {
        ack.reject(new LineError(frame.error));
        this.acks.delete(frame.id);
      } else this.problem = String(frame.error);
    } else if (frame.t === "msg") {
      this.#queue = this.#queue.then(() => this.#receive(frame)).catch((err) => {
        this.problem = String(err.message);
        try {
          if (this.ws && typeof this.ws.close === "function") {
            this.ws.close(1011, `Message processing failed: ${err.message}`);
          }
        } catch {}
      });
      await this.#queue;
    }
  }

  async #receive(frame) {
    const to = frame.to_owner ? `@${frame.to_owner}` : String(frame.to || "");
    const id = String(frame.id || "");
    if (!/^[0-9a-f]{16,64}$/i.test(id)) {
      this.#advance(frame.seq);
      return;
    }
    let payload;
    try {
      payload = await this.invite.open(String(frame.body || ""), { sender: frame.from, to, id: frame.id, replyTo: frame.reply_to });
    } catch {
      this.#advance(frame.seq);
      return;
    }
    const message = {
      id: frame.id,
      from: frame.from,
      to,
      replyTo: frame.reply_to || null,
      // The conversation this belongs to, and its title (both set by the sender; older clients send neither).
      thread: payload.thread ? String(payload.thread) : frame.reply_to ? null : frame.id,
      mentions: Array.isArray(frame.mentions) ? frame.mentions : [],
      title: String(payload.title || ""),
      text: String(payload.text || ""),
      type: String(payload.type || "message"),
      patch: payload.patch ? String(payload.patch) : null,
      branch: payload.branch ? String(payload.branch) : null,
      ts: frame.ts,
      files: await this.#files(payload.files),
    };
    const waiting = this.replies.get(message.replyTo || "");
    if (waiting) {
      await Promise.resolve(waiting(message));
    } else if (this.onMessage) {
      await Promise.resolve(this.onMessage(message));
    }
    this.#advance(frame.seq);
  }

  async #files(raw) {
    const out = [];
    for (const item of Array.isArray(raw) ? raw : []) {
      const name = String(item?.name || "file").split(/[\\/]/).pop() || "file";
      if (item?.blob) {
        try {
          const headers = { ...this.invite.auth, ...(this.invite.pass ? { "x-chamber-pass": this.invite.pass } : {}) };
          const response = await fetch(this.invite.blobUrl(item.blob), { headers });
          if (!response.ok) throw new LineError((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
          out.push({ name, data: await this.invite.openBlob(new Uint8Array(await response.arrayBuffer()), item.blob) });
        } catch (error) {
          out.push({ name, data: new Uint8Array(), error: `could not fetch: ${error.message}` });
        }
      } else {
        out.push({ name, data: new Uint8Array(Buffer.from(String(item?.data || ""), "base64")) });
      }
    }
    return out;
  }

  // ----- the cursor ---------------------------------------------------------------

  #loadCursor() {
    try {
      return Number(JSON.parse(readFileSync(this.cursorPath, "utf8")).cursor) || 0;
    } catch {
      return 0;
    }
  }

  #advance(seq) {
    if (!(seq > this.cursor)) return;
    this.cursor = seq;
    if (this.cursorPath) {
      mkdirSync(dirname(this.cursorPath), { recursive: true });
      writeFileSync(this.cursorPath, JSON.stringify({ cursor: seq }));
    }
  }

  // ----- sending ------------------------------------------------------------------------

  /** Send; resolves to the relay's receipt (`delivered` agents, or `held`) with the message's `id` and `thread`.
   *  Files: [{name, data: Uint8Array}]. A message starts a conversation (its own id) unless `thread` says which. */
  async send(to, text, { files = [], replyTo = null, thread = null, title = "", mentions = null, type = "message", patch = null, branch = null } = {}) {
    to = forPerson(String(to).trim().toLowerCase(), this.agent);
    await this.ready();
    const id = hex();
    const packed = [];
    const blobs = [];
    for (const file of files) {
      if (file.data.length <= INLINE_FILE_BYTES) {
        packed.push({ name: file.name, data: Buffer.from(file.data).toString("base64") });
        continue;
      }
      const blob = hex();
      const headers = { ...this.invite.auth, ...(this.invite.pass ? { "x-chamber-pass": this.invite.pass } : {}) };
      const response = await fetch(this.invite.blobUrl(blob), { method: "PUT", headers, body: await this.invite.sealBlob(file.data, blob) });
      if (!response.ok) throw new LineError(`could not upload ${file.name}: ${(await response.json().catch(() => ({}))).error || response.status}`);
      packed.push({ name: file.name, blob, size: file.data.length });
      blobs.push(blob);
    }
    thread ||= id;
    const body = await this.invite.seal({ text, files: packed, thread, title, type, patch, branch }, { sender: this.agent, to, id, replyTo });
    const receipt = new Promise((resolve, reject) => this.acks.set(id, { resolve, reject }));
    mentions ??= mentionsIn(text);
    this.ws.send(JSON.stringify({ t: "send", id, to, body, blobs, mentions, ...(replyTo ? { reply_to: replyTo } : {}) }));
    return { ...(await withTimeout(receipt, 30000, "the relay did not confirm the message")), id, thread, mentions };
  }

  /** Join, leave, or add someone (`owner`) to a channel (`#name`). */
  async channel(op, name, owner = null) {
    await this.ready();
    this.ws.send(JSON.stringify({ t: "channel", op, name: String(name).toLowerCase(), ...(owner ? { owner } : {}) }));
  }

  /** Send and wait for the reply; `reply` is null on timeout (a later reply goes to onMessage). */
  async ask(to, text, { files = [], timeout = 120000, thread = null, title = "", onSent = null, branch = null } = {}) {
    const receipt = await this.send(to, text, { files, thread, title, branch });
    onSent?.(receipt);
    const reply = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeout);
      this.replies.set(receipt.id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
    this.replies.delete(receipt.id);
    return { receipt, reply };
  }

  /**
   * Fetch and decrypt sealed message history from the relay (e.g. for new teammates or fresh laptops).
   */
  async syncHistory({ since = 0, onMessage = null, limit = 100 } = {}) {
    await this.invite.ready();
    const headers = {
      ...this.invite.auth,
      ...(this.invite.pass ? { "x-chamber-pass": this.invite.pass } : {}),
      "x-chamber-owner": this.agent.split("/")[0],
    };
    const res = await fetch(this.invite.syncUrl(since, limit), { headers });
    if (!res.ok) throw new LineError(`sync failed with status ${res.status}`);
    const data = await res.json();
    const opened = [];
    for (const frame of data.messages || []) {
      const to = frame.to_owner ? `@${frame.to_owner}` : String(frame.to || "");
      try {
        const payload = await this.invite.open(String(frame.body || ""), {
          sender: frame.from,
          to,
          id: frame.id,
          replyTo: frame.reply_to,
        });
        const msg = {
          id: frame.id,
          seq: frame.seq,
          from: frame.from,
          to,
          replyTo: frame.reply_to || null,
          thread: payload.thread ? String(payload.thread) : frame.reply_to ? null : frame.id,
          title: String(payload.title || ""),
          text: String(payload.text || ""),
          type: String(payload.type || "message"),
          patch: payload.patch ? String(payload.patch) : null,
          branch: payload.branch ? String(payload.branch) : null,
          ts: frame.ts,
          files: await this.#files(payload.files),
        };
        opened.push(msg);
        if (onMessage) await onMessage(msg);
      } catch {
        // Skip unopenable or corrupted frame
      }
    }
    return { messages: opened, head: data.head, hasMore: data.hasMore };
  }

  testFrame(frame) {
    return this.#frame(frame);
  }
}

/** People @mentioned in a text: the relay routes on these (it cannot read the text). */
export function mentionsIn(text) {
  return [...new Set([...String(text).matchAll(/(?:^|[^\w@])@([a-z0-9][a-z0-9._-]{0,31})/gi)].map((m) => m[1].toLowerCase().replace(/[.]+$/, "")))];
}

function withTimeout(promise, ms, why) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new LineError(why)), ms)))]).finally(() => clearTimeout(timer));
}
