// The chamber relay.
//
// A line is a shared room where people's agents (root, Claude Code, …) meet.
// The Worker is stateless: it checks the caller's token and hands the request to
// the line's Durable Object, which keeps two things and nothing else:
//
//   - the roster: which agents are connected right now (one WebSocket each)
//   - messages, so an agent that is offline gets what was sent to it when it
//     reconnects (kept 7 days)
//
// The relay never sees content. Message bodies are sealed by the clients with
// a key derived from the line's invite secret; the relay routes on the
// envelope (from, to, reply_to) only.
//
// Auth needs no stored state either: the line id is a hash of the line token,
// so a token is valid for exactly one line and the relay keeps no secret.
//
// Files too big for a message go to R2 (optional binding BLOBS), sealed by the
// clients like bodies are. They live only for the line's session: once no agent
// has been connected for IDLE_WIPE_MS (var IDLE_WIPE_SECONDS overrides), every blob of the line is deleted except
// those a not-yet-delivered message still points at.
//
// Personal invites: with the secret ADMIN_KEY (the admin's Ed25519 public key) every agent
// must show a pass the admin signed for its member, a name belongs to the first member to
// use it, and the admin can revoke a member (a signed order). Without ADMIN_KEY, anyone
// with the chamber key may join (the original, open mode).
//
// Team memory: a small versioned store of markdown files (sealed by the clients like
// messages), with Devin's rule for concurrent writers: a commit names the version of each
// file it was based on, and is rejected with the current versions if any moved.
//
// A relay can be private: with the secret ALLOWED_LINES (comma-separated chamber ids, set by
// create.sh) it serves only those chambers, so a public URL is not an open relay.
//
// Addressing (the `to` of a message):
//   "owner/name"  one agent, e.g. "nitin/claude-code"
//   "@owner"      a person: their best agent online (one that answers, then the
//                 highest priority), else held until one of theirs connects
//   "*"           everyone on the line

import { install } from "./install.js";

const RETENTION_MS = 7 * 24 * 3600 * 1000;
const MAX_ROWS = 5000;
const MAX_BODY = 900_000;
const AGENT = /^[a-z0-9][a-z0-9._-]{0,31}\/[a-z0-9][a-z0-9._-]{0,31}$/;
const LINE = /^[0-9a-f]{32}$/;
const CHANNEL = /^#[a-z0-9][a-z0-9_-]{0,39}$/;
const OWNER = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const BLOB = /^[0-9a-f]{32}$/;
const MAX_BLOB = 25 * 1024 * 1024;
const IDLE_WIPE_MS = 10 * 60 * 1000;
const MAX_MEMORY_FILE = 400_000; // sealed, base64
const MAX_MEMORY_FILES = 2000;
const MEMORY_PATH = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}\.md$/;

async function lineOf(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") return new Response("chamber relay\n");
    const served = install(url);
    if (served) return served;
    const match = url.pathname.match(/^\/v1\/lines\/([^/]+)\/(ws|roster|members|admin|memory(?:\/(?:file|commit|history))?|blobs\/([^/]+))$/);
    if (!match) return json({ error: "not found" }, 404);
    const [, line, what, blob] = match;
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!LINE.test(line) || !token || (await lineOf(token)) !== line) return json({ error: "unauthorized" }, 401);
    const allowed = String(env.ALLOWED_LINES || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(line)) return json({ error: "this relay serves only its own chambers" }, 403);
    if (blob !== undefined) return blobs(request, env, line, blob);
    if (what === "ws" && request.headers.get("upgrade") !== "websocket") return json({ error: "expected a WebSocket" }, 426);
    const stub = env.LINES.get(env.LINES.idFromName(line));
    const forwarded = new Request(`https://line/${what}${url.search}`, request);
    forwarded.headers.set("x-line", line);
    return stub.fetch(forwarded);
  },
};

const b64 = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** The claims of a token the admin signed (pass or order), or null. */
async function signedByAdmin(env, token) {
  if (!env.ADMIN_KEY || typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const key = await crypto.subtle.importKey("raw", b64(env.ADMIN_KEY), { name: "Ed25519" }, false, ["verify"]);
    if (!(await crypto.subtle.verify({ name: "Ed25519" }, key, b64(sig), new TextEncoder().encode(body)))) return null;
    return JSON.parse(new TextDecoder().decode(b64(body)));
  } catch {
    return null;
  }
}

async function blobs(request, env, line, blob) {
  if (!env.BLOBS) return json({ error: "this relay has no file storage; send smaller files" }, 501);
  if (!BLOB.test(blob)) return json({ error: "bad blob id" }, 400);
  const key = `${line}/${blob}`;
  if (request.method === "PUT") {
    const size = Number(request.headers.get("content-length") || 0);
    if (!size || size > MAX_BLOB) return json({ error: `a file must be under ${MAX_BLOB / 1024 / 1024} MB` }, 413);
    await env.BLOBS.put(key, request.body);
    return json({ ok: true, blob, size });
  }
  if (request.method === "GET") {
    const object = await env.BLOBS.get(key);
    if (!object) return json({ error: "gone: files are wiped when the line's session ends" }, 404);
    return new Response(object.body, { headers: { "content-type": "application/octet-stream" } });
  }
  return json({ error: "PUT or GET" }, 405);
}

export class Line {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT,
      to_owner TEXT,
      reply_to TEXT,
      body TEXT NOT NULL,
      ts INTEGER NOT NULL
    )`);
    // Additive columns, for lines created before them.
    const columns = this.sql.exec("PRAGMA table_info(messages)").toArray().map((c) => c.name);
    if (!columns.includes("delivered")) this.sql.exec("ALTER TABLE messages ADD COLUMN delivered INTEGER NOT NULL DEFAULT 0");
    if (!columns.includes("blobs")) this.sql.exec("ALTER TABLE messages ADD COLUMN blobs TEXT NOT NULL DEFAULT ''");
    if (!columns.includes("mentions")) this.sql.exec("ALTER TABLE messages ADD COLUMN mentions TEXT NOT NULL DEFAULT ''");
    this.sql.exec("CREATE INDEX IF NOT EXISTS messages_to ON messages (to_agent, seq)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS channels (name TEXT NOT NULL, owner TEXT NOT NULL, PRIMARY KEY (name, owner))");
    // Personal invites: which member holds a name, and members the admin removed.
    this.sql.exec("CREATE TABLE IF NOT EXISTS names (owner TEXT PRIMARY KEY, member TEXT NOT NULL, since INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS revoked (member TEXT PRIMARY KEY, at INTEGER NOT NULL)");
    // Team memory.
    this.sql.exec("CREATE TABLE IF NOT EXISTS mem_files (path TEXT PRIMARY KEY, version INTEGER NOT NULL, body TEXT NOT NULL, author TEXT NOT NULL, ts INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS mem_versions (path TEXT NOT NULL, version INTEGER NOT NULL, body TEXT, PRIMARY KEY (path, version))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS mem_commits (seq INTEGER PRIMARY KEY AUTOINCREMENT, author TEXT NOT NULL, message TEXT NOT NULL, changes TEXT NOT NULL, ts INTEGER NOT NULL)");
  }

  // ----- channels ---------------------------------------------------------------

  channels() {
    const byName = new Map();
    for (const row of this.sql.exec("SELECT name, owner FROM channels ORDER BY name, owner").toArray()) {
      if (!byName.has(row.name)) byName.set(row.name, []);
      byName.get(row.name).push(row.owner);
    }
    return [...byName].map(([name, members]) => ({ name, members }));
  }

  isMember(channel, owner) {
    return this.sql.exec("SELECT 1 FROM channels WHERE name = ? AND owner = ?", channel, owner).toArray().length > 0;
  }

  broadcastChannels() {
    const frame = JSON.stringify({ t: "channels", channels: this.channels() });
    for (const { ws } of this.members()) this.send(ws, frame);
  }

  /** join | leave | add (someone else): any member manages channels, like Slack. */
  channel(ws, who, frame) {
    const name = String(frame.name || "").toLowerCase();
    const owner = String(frame.owner || who.owner).toLowerCase();
    if (!CHANNEL.test(name) || !OWNER.test(owner)) return this.send(ws, JSON.stringify({ t: "error", error: "a channel is #name (letters, digits, - or _)" }));
    if (frame.op === "join" || frame.op === "add") this.sql.exec("INSERT OR IGNORE INTO channels (name, owner) VALUES (?, ?)", name, owner);
    else if (frame.op === "leave") this.sql.exec("DELETE FROM channels WHERE name = ? AND owner = ?", name, owner);
    else return this.send(ws, JSON.stringify({ t: "error", error: "channel op is join, add or leave" }));
    this.broadcastChannels();
  }

  /** Should this connected agent get this channel message? */
  hears(who, row) {
    if (!this.isMember(row.to_agent, who.owner)) return false;
    if (who.listens) return true;
    return String(row.mentions || "").includes(`,${who.owner},`) && this.choose(who.owner) === who.agent;
  }

  async fetch(request) {
    const what = new URL(request.url).pathname.slice(1);
    const line = request.headers.get("x-line");
    if (line && line !== this.line) {
      this.line = line;
      await this.ctx.storage.put("line", line); // the alarm may wake in a fresh instance
    }
    if (what === "roster") return json({ agents: this.roster() });
    if (what === "members") {
      const online = new Set(this.roster().map((w) => w.owner));
      const rows = this.sql.exec("SELECT owner, member, since FROM names ORDER BY owner").toArray();
      return json({ personal: Boolean(this.env.ADMIN_KEY), members: rows.map((r) => ({ ...r, online: online.has(r.owner) })) });
    }
    if (what === "admin") return this.admin(await request.json().catch(() => ({})));
    if (what.startsWith("memory")) {
      const refused = await this.memberCheck(request.headers.get("x-chamber-pass"));
      if (refused) return json({ error: refused }, 403);
      return this.memory(what, request);
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ----- the roster ---------------------------------------------------------

  members() {
    const out = [];
    for (const ws of this.ctx.getWebSockets()) {
      const who = ws.deserializeAttachment();
      if (who && who.agent) out.push({ ws, who });
    }
    return out;
  }

  roster() {
    return this.members().map(({ who }) => who);
  }

  broadcastRoster() {
    const frame = JSON.stringify({ t: "roster", agents: this.roster() });
    for (const { ws } of this.members()) this.send(ws, frame);
  }

  /** A person's agent that should take a message for them, or null if none is online. */
  choose(owner) {
    const theirs = this.roster().filter((who) => who.owner === owner);
    theirs.sort((a, b) => Number(b.answers) - Number(a.answers) || b.priority - a.priority || a.since - b.since);
    return theirs[0]?.agent ?? null;
  }

  send(ws, frame) {
    try {
      ws.send(frame);
    } catch {
      // closing; the roster update on close covers it
    }
  }

  // ----- team memory -------------------------------------------------------------------

  /** With personal invites, memory is for members only: a valid, unrevoked pass. */
  async memberCheck(pass) {
    if (!this.env.ADMIN_KEY) return null;
    const claims = await signedByAdmin(this.env, pass);
    const line = this.line || (await this.ctx.storage.get("line"));
    if (!claims || claims.line !== line || !claims.member) return "team memory is for members: a personal invite is needed";
    if (this.sql.exec("SELECT 1 FROM revoked WHERE member = ?", claims.member).toArray().length) return "you were removed from this chamber by its admin";
    return null;
  }

  async memory(what, request) {
    const url = new URL(request.url);
    if (what === "memory") {
      const head = this.sql.exec("SELECT MAX(seq) AS head FROM mem_commits").one().head ?? 0;
      return json({ head, files: this.sql.exec("SELECT path, version, author, ts FROM mem_files ORDER BY path").toArray() });
    }
    if (what === "memory/file") {
      const path = url.searchParams.get("path") || "";
      const version = Number(url.searchParams.get("version") || 0);
      const row = version
        ? this.sql.exec("SELECT path, version, body FROM mem_versions WHERE path = ? AND version = ?", path, version).toArray()[0]
        : this.sql.exec("SELECT path, version, body FROM mem_files WHERE path = ?", path).toArray()[0];
      return row ? json(row) : json({ error: "no such file" }, 404);
    }
    if (what === "memory/history") {
      const limit = Math.min(200, Number(url.searchParams.get("limit") || 50));
      const rows = this.sql.exec("SELECT seq, author, message, changes, ts FROM mem_commits ORDER BY seq DESC LIMIT ?", limit).toArray();
      return json({ commits: rows.map((r) => ({ ...r, changes: JSON.parse(r.changes) })) });
    }
    // memory/commit: { author, message, changes: [{ path, base, body | null }] }, all or nothing.
    if (request.method !== "POST") return json({ error: "POST a commit" }, 405);
    const commit = await request.json().catch(() => null);
    const changes = Array.isArray(commit?.changes) ? commit.changes : [];
    if (!changes.length || changes.length > 50) return json({ error: "a commit changes 1 to 50 files" }, 400);
    for (const c of changes) {
      if (!MEMORY_PATH.test(String(c.path || "")) || String(c.path).includes("..")) return json({ error: `bad path: ${c.path}` }, 400);
      if (c.body !== null && (typeof c.body !== "string" || c.body.length > MAX_MEMORY_FILE)) return json({ error: `${c.path} is too large` }, 413);
    }
    const stale = changes
      .map((c) => ({ c, row: this.sql.exec("SELECT path, version, body FROM mem_files WHERE path = ?", c.path).toArray()[0] }))
      .filter(({ c, row }) => (row?.version ?? 0) !== Number(c.base || 0));
    if (stale.length) return json({ error: "stale", current: stale.map(({ c, row }) => row ?? { path: c.path, version: 0, body: null }) }, 409);
    const count = this.sql.exec("SELECT COUNT(*) AS n FROM mem_files").one().n;
    if (count + changes.filter((c) => c.body !== null && !Number(c.base)).length > MAX_MEMORY_FILES) return json({ error: "memory is full" }, 413);
    const now = Date.now();
    const author = String(commit.author || "").slice(0, 80);
    const applied = [];
    for (const c of changes) {
      const highest = this.sql.exec("SELECT MAX(version) AS v FROM mem_versions WHERE path = ?", c.path).one().v ?? 0;
      const to = Math.max(Number(c.base || 0), highest) + 1; // a re-created file continues its history
      this.sql.exec("INSERT OR REPLACE INTO mem_versions (path, version, body) VALUES (?, ?, ?)", c.path, to, c.body);
      if (c.body === null) this.sql.exec("DELETE FROM mem_files WHERE path = ?", c.path);
      else this.sql.exec("INSERT OR REPLACE INTO mem_files (path, version, body, author, ts) VALUES (?, ?, ?, ?, ?)", c.path, to, c.body, author, now);
      applied.push({ path: c.path, from: Number(c.base || 0), to, deleted: c.body === null });
    }
    const row = this.sql.exec("INSERT INTO mem_commits (author, message, changes, ts) VALUES (?, ?, ?, ?) RETURNING seq", author, String(commit.message || "").slice(0, 500), JSON.stringify(applied), now).one();
    const frame = JSON.stringify({ t: "memory", head: row.seq, author, changes: applied });
    for (const { ws } of this.members()) this.send(ws, frame);
    return json({ ok: true, seq: row.seq, changes: applied });
  }

  // ----- the admin ----------------------------------------------------------------

  /** A signed order from the admin: { order: <token> }. Today: revoke a member by name. */
  async admin(body) {
    const claims = await signedByAdmin(this.env, body.order);
    const line = this.line || (await this.ctx.storage.get("line"));
    if (!claims || claims.line !== line || claims.op !== "revoke" || !OWNER.test(String(claims.owner || ""))) return json({ error: "not a valid order from this chamber's admin" }, 403);
    const row = this.sql.exec("SELECT member FROM names WHERE owner = ?", claims.owner).toArray()[0];
    if (row) this.sql.exec("INSERT OR IGNORE INTO revoked (member, at) VALUES (?, ?)", row.member, Date.now());
    this.sql.exec("DELETE FROM names WHERE owner = ?", claims.owner);
    this.sql.exec("DELETE FROM channels WHERE owner = ?", claims.owner);
    for (const { ws, who } of this.members()) {
      if (who.owner === claims.owner) {
        ws.serializeAttachment(null);
        try {
          ws.close(4003, "removed from the chamber by its admin");
        } catch {}
      }
    }
    this.broadcastRoster();
    this.broadcastChannels();
    return json({ ok: true, revoked: claims.owner });
  }

  /** May this hello use this name? With personal invites: a valid pass, not revoked, and the name is free or theirs. */
  async admit(owner, pass) {
    if (!this.env.ADMIN_KEY) return null;
    const claims = await signedByAdmin(this.env, pass);
    const line = this.line || (await this.ctx.storage.get("line"));
    if (!claims || claims.line !== line || !claims.member) return "this chamber needs a personal invite: ask its admin for one";
    if (this.sql.exec("SELECT 1 FROM revoked WHERE member = ?", claims.member).toArray().length) return "you were removed from this chamber by its admin";
    const holder = this.sql.exec("SELECT member FROM names WHERE owner = ?", owner).toArray()[0];
    if (holder && holder.member !== claims.member) return `the name ${owner} belongs to someone else in this chamber; pick another (chamber name <new>)`;
    if (!holder) {
      this.sql.exec("DELETE FROM names WHERE member = ?", claims.member); // a member holds one name: renaming frees the old one
      this.sql.exec("INSERT INTO names (owner, member, since) VALUES (?, ?, ?)", owner, claims.member, Date.now());
    }
    return null;
  }

  // ----- frames ---------------------------------------------------------------

  async webSocketMessage(ws, raw) {
    let frame;
    try {
      frame = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.send(ws, JSON.stringify({ t: "error", error: "frames are JSON" }));
    }
    const who = ws.deserializeAttachment();
    if (frame.t === "hello") return await this.hello(ws, frame);
    if (!who || !who.agent) return this.send(ws, JSON.stringify({ t: "error", error: "say hello first" }));
    if (frame.t === "send") return this.deliver(ws, who, frame);
    if (frame.t === "channel") return this.channel(ws, who, frame);
    if (frame.t === "ping") return this.send(ws, JSON.stringify({ t: "pong" }));
    this.send(ws, JSON.stringify({ t: "error", error: `unknown frame ${frame.t}` }));
  }

  async hello(ws, frame) {
    const agent = String(frame.agent || "").toLowerCase();
    if (!AGENT.test(agent)) return this.send(ws, JSON.stringify({ t: "error", error: "agent must be owner/name" }));
    const refused = await this.admit(agent.split("/")[0], frame.pass);
    if (refused) {
      this.send(ws, JSON.stringify({ t: "error", error: refused }));
      try {
        ws.close(4003, refused.slice(0, 120));
      } catch {}
      return;
    }
    for (const { ws: other, who } of this.members()) {
      if (who.agent === agent && other !== ws) {
        other.serializeAttachment(null); // off the roster now, even if the old side never answers the close
        try {
          other.close(4001, "replaced by a newer connection");
        } catch {}
      }
    }
    const who = {
      agent,
      owner: agent.split("/")[0],
      kind: String(frame.kind || "agent").slice(0, 32),
      label: String(frame.label || "").slice(0, 120),
      priority: Number.isFinite(frame.priority) ? frame.priority : 0,
      answers: Boolean(frame.answers),
      listens: Boolean(frame.listens), // gets all of its channels' traffic (a board, root), not only @mentions
      since: Date.now(),
    };
    ws.serializeAttachment(who);
    this.sql.exec("INSERT OR IGNORE INTO channels (name, owner) VALUES ('#general', ?)", who.owner);
    this.send(ws, JSON.stringify({ t: "welcome", agent, agents: this.roster(), channels: this.channels() }));

    // What it missed: messages to it (or to everyone) after its cursor…
    const since = Number.isFinite(frame.since) ? frame.since : 0;
    const missed = this.sql
      .exec("SELECT * FROM messages WHERE seq > ? AND from_agent != ? AND (to_agent = ? OR to_agent = '*') ORDER BY seq", since, agent, agent)
      .toArray();
    // …and its channels' messages (all of them if it listens, else the ones @mentioning its owner).
    const heard = this.sql
      .exec("SELECT * FROM messages WHERE seq > ? AND from_agent != ? AND to_agent LIKE '#%' ORDER BY seq", since, agent)
      .toArray()
      .filter((row) => this.hears(who, row));
    missed.push(...heard);
    missed.sort((a, b) => a.seq - b.seq);
    // …and messages for its owner that waited because none of theirs was online.
    if (this.choose(who.owner) === agent) {
      const held = this.sql.exec("SELECT * FROM messages WHERE to_agent IS NULL AND to_owner = ? ORDER BY seq", who.owner).toArray();
      if (held.length) {
        this.sql.exec("UPDATE messages SET to_agent = ? WHERE to_agent IS NULL AND to_owner = ?", agent, who.owner);
        missed.push(...held.map((row) => ({ ...row, to_agent: agent })));
      }
    }
    for (const row of missed) this.send(ws, JSON.stringify(this.envelope(row)));
    if (missed.length) this.sql.exec(`UPDATE messages SET delivered = 1 WHERE seq IN (${missed.map((r) => Number(r.seq)).join(",")})`);
    this.ctx.storage.deleteAlarm();
    this.broadcastRoster();
  }

  deliver(ws, who, frame) {
    const id = String(frame.id || "").slice(0, 64);
    const to = String(frame.to || "").toLowerCase();
    const body = String(frame.body || "");
    if (!id || !body) return this.send(ws, JSON.stringify({ t: "error", error: "a message needs an id and a body", id }));
    if (body.length > MAX_BODY) return this.send(ws, JSON.stringify({ t: "error", error: "message too large", id }));
    let toAgent = null;
    let toOwner = null;
    const mentions = (Array.isArray(frame.mentions) ? frame.mentions : []).map((m) => String(m).toLowerCase()).filter((m) => OWNER.test(m)).slice(0, 50);
    if (to === "*") toAgent = "*";
    else if (CHANNEL.test(to)) {
      if (!this.isMember(to, who.owner)) return this.send(ws, JSON.stringify({ t: "error", error: `join ${to} first`, id }));
      toAgent = to;
    } else if (to.startsWith("@") && AGENT.test(`${to.slice(1)}/x`)) {
      toOwner = to.slice(1);
      toAgent = this.choose(toOwner);
    } else if (AGENT.test(to)) toAgent = to;
    else return this.send(ws, JSON.stringify({ t: "error", error: "to must be owner/name, @owner, #channel or *", id }));

    const now = Date.now();
    this.sql.exec("DELETE FROM messages WHERE ts < ?", now - RETENTION_MS);
    this.sql.exec("DELETE FROM messages WHERE seq <= (SELECT MAX(seq) FROM messages) - ?", MAX_ROWS);
    const blobIds = (Array.isArray(frame.blobs) ? frame.blobs : []).map(String).filter((b) => BLOB.test(b)).slice(0, 20);
    const row = this.sql
      .exec(
        "INSERT INTO messages (id, from_agent, to_agent, to_owner, reply_to, body, ts, blobs, mentions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
        id,
        who.agent,
        toAgent,
        toOwner,
        frame.reply_to ? String(frame.reply_to).slice(0, 64) : null,
        body,
        now,
        blobIds.join(","),
        mentions.length ? `,${mentions.join(",")},` : "",
      )
      .one();
    const envelope = JSON.stringify(this.envelope(row));
    let delivered = [];
    for (const { ws: other, who: them } of this.members()) {
      if (other === ws) continue;
      if (toAgent === "*" || them.agent === toAgent || (toAgent?.startsWith("#") && this.hears(them, row))) {
        this.send(other, envelope);
        delivered.push(them.agent);
      }
    }
    if (delivered.length) this.sql.exec("UPDATE messages SET delivered = 1 WHERE seq = ?", row.seq);
    this.send(ws, JSON.stringify({ t: "sent", id, seq: row.seq, to: toAgent, delivered, held: delivered.length === 0 }));
  }

  envelope(row) {
    return {
      t: "msg",
      seq: row.seq,
      id: row.id,
      from: row.from_agent,
      to: row.to_agent,
      to_owner: row.to_owner,
      reply_to: row.reply_to,
      body: row.body,
      ts: row.ts,
      mentions: String(row.mentions || "").split(",").filter(Boolean),
    };
  }

  async webSocketClose(ws, code, reason) {
    try {
      ws.close(code === 1005 ? 1000 : code, reason); // finish the close handshake, or the client waits it out
    } catch {
      // already closed
    }
    this.left(ws);
  }

  async webSocketError(ws) {
    this.left(ws);
  }

  left(ws) {
    ws.serializeAttachment(null);
    this.broadcastRoster();
    if (this.members().length === 0 && this.env.BLOBS) this.ctx.storage.setAlarm(Date.now() + (Number(this.env.IDLE_WIPE_SECONDS) * 1000 || IDLE_WIPE_MS));
  }

  // ----- the end of a session: wipe its files ------------------------------------

  async alarm() {
    const line = this.line || (await this.ctx.storage.get("line"));
    if (this.members().length > 0 || !this.env.BLOBS || !line) return;
    const keep = new Set();
    for (const row of this.sql.exec("SELECT blobs FROM messages WHERE delivered = 0 AND blobs != ''").toArray()) {
      for (const blob of row.blobs.split(",")) keep.add(`${line}/${blob}`);
    }
    let cursor;
    do {
      const page = await this.env.BLOBS.list({ prefix: `${line}/`, cursor });
      const doomed = page.objects.map((o) => o.key).filter((key) => !keep.has(key));
      if (doomed.length) await this.env.BLOBS.delete(doomed);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
}
