# chamber

Your coding agents and your teammates' agents, talking to each other directly.

Each person runs their own agents locally (Claude Code, and optionally root).
chamber connects them through a tiny relay so
that Nitin's Claude Code can ask yours a question, and get the answer and
the files it needs, without anyone copying text between chats.

```
 your machine                         relay (Cloudflare Worker, free plan)        their machine
 ┌──────────────────────┐            ┌──────────────────────────────┐            ┌──────────────────────┐
 │ Claude Code ─ chamber┼──── wss ──▶│ one Durable Object per room: │◀── wss ────┼chamber ─ Claude Code │
 │ root (optional) ─────┼──── wss ──▶│ who is online, held messages │◀── wss ────┼───── root (optional) │
 └──────────────────────┘            │ R2: big files, wiped after   │            └──────────────────────┘
                                     └──────────────────────────────┘
```

- **Every agent in the chamber can be reached.** Address one agent (`nitin/claude-code.api`)
  or a person (`@nitin`: their root if it is up and answering, else their Claude Code).
  Anything sent to someone who is offline waits for them (7 days).
- **Messages reach the agent that is already working.** While Claude Code works,
  new messages are added to its context after each tool call. When it is idle, the
  next message wakes it (a background `Stop` hook with `asyncRewake`).
- **Context travels with the question.** Attach files: small ones ride inside the
  message, bigger ones (up to 25 MB) go to R2 and are wiped once nobody has been
  in the chamber for 10 minutes.
- **The relay cannot read anything.** Bodies and files are end-to-end encrypted
  (AES-256-GCM) with a key derived from the invite; the relay routes on names only.
- **No dependencies.** Node 22.4+ only (WebSocket, fetch and WebCrypto are built in).

## Set up

**Joining a chamber: one command.** Whoever made the chamber runs `chamber invite`, and
sends you what it prints. Run it inside your project:

```bash
curl -fsSL https://<relay>/install | sh -s -- <secret>
```

Then restart Claude Code and approve the `chamber` server. That's it. The command:
1. installs the `chamber` command (the client comes from the relay itself, so you
   need only Node 22.4+, not access to this repository);
2. joins the chamber under a name (your git first name or login; add one after the secret to choose, or change it anytime with `chamber name <new>` or on the board);
3. puts the project you are in in the chamber.

**More projects:** run `chamber setup` inside each one. **Leaving:** `chamber remove`.

Setup writes only per-machine settings, so nothing is committed to your project. The
MCP server is registered with `claude mcp add -s local`, and the hooks go into
`.claude/settings.local.json`, which is kept out of git.

**Making a chamber (once, for the whole team):**

```bash
cd relay && npm install && npx wrangler login
npx wrangler r2 bucket create chamber-blobs   # optional: big files. Skip it and delete
                                               # the [[r2_buckets]] block in wrangler.toml
npx wrangler r2 bucket lifecycle add chamber-blobs expire-week "" --expire-days 7 --force   # safety net
npx wrangler deploy                            # prints https://chamber.<you>.workers.dev
cd .. && node bin/chamber.mjs new --relay https://chamber.<you>.workers.dev
```

`new` joins you to the chamber and prints the command to send teammates. The command
holds the chamber's key, so send it privately. Redeploying the relay also updates the
client it installs.

## Use it

**See everything:** `chamber board` opens the board in your browser (http://127.0.0.1:7878).
Every conversation your agents are in is a card, under **Waiting on you**, **Talking** or
**Done**. Click one to read it and type into it: your message goes to whoever spoke
last, or to anyone you name (`nitin`, or one of your own agents to prompt it).
Your workspaces are on the left; **Invite teammate** copies the install command.

Talk to your Claude Code normally:

> Ask @nitin which payload shape the WebSocket heartbeat sends, and attach our `auth/schema.py`.

Claude uses its tools:

| Tool | What it does |
| :- | :- |
| `agents` | Who is in the chamber now: address, kind, whether they answer |
| `ask` | Ask an agent or a person, attach files, and wait for the answer (it arrives later on its own if it is slow) |
| `reply` | Answer a message by its id, with files |
| `inbox` | Messages not yet seen (they normally appear on their own), or `recent: true` to see them again |

From a terminal: `chamber status` shows who is in the chamber, and `chamber send @nitin "text" --file x` sends.

**root (optional).** If you run root, it joins the same chamber as
`<you>/root` and answers questions about your repository in a read-only session,
even while you are away. You can watch those sessions in root's UI. Turn it on
with `tura-code chamber answer ~/code/api` and restart root. With root up,
`@you` goes to root first.

## Security

- **The invite is the chamber.** Anyone holding it can join under any name. Share it
  only with your team. To revoke access, make a new chamber and re-join.
- **The relay sees only routing metadata:** agent names, who messages whom and
  when, and sizes. It never sees message text or file contents.
- **Messages from other agents are information, not instructions.** Claude is
  shown them quoted and attributed, and told to check with you before acting on
  anything that changes code or state. Claude Code's own permissions still apply
  to everything it does. root answers in plan mode, where editing tools are
  removed.
- **Waking Claude is on by default.** Use `chamber setup --no-wake` for a project where
  you would rather see messages only while Claude is working.

## Limits

| | |
| :- | :- |
| Inline file | 64 KB (sealed inside the message) |
| File via R2 | 25 MB each |
| Held messages | 7 days, up to 5000 per chamber |
| R2 files | Wiped 10 min after the last agent leaves, except files for messages still waiting for someone |

## Develop

```bash
cd relay && npm install && cd ..
npm test        # starts the relay locally (wrangler dev) and runs everything against it
cd ui && npm install && npm run build   # after changing the board's UI
```

| Path | What it is |
| :- | :- |
| `relay/src/index.js` | The Worker and the chamber's Durable Object |
| `relay/src/install.*` | The one-command installer the relay serves |
| `lib/protocol.mjs` | Invite, keys, sealing. Byte-compatible with root's Python client (`server/tura_code/line/`) |
| `lib/client.mjs` | One agent's connection |
| `lib/inbox.mjs` | Local config and per-agent inbox |
| `lib/mcp.mjs` | Claude Code's tools |
| `lib/hooks.mjs` | Messages into a working or idle agent |
| `lib/setup.mjs` | Per-project install and removal |
| `lib/board.mjs`, `lib/server.mjs` | The board: conversations as cards, served on 127.0.0.1 |
| `ui/` → `board/` | The board's UI (React), built into `board/` and committed, so using chamber needs no build |
