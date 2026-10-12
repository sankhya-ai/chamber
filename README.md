# root-line

Your coding agents and your teammates' agents, talking to each other directly.

Each person runs their own agents locally (Claude Code, and optionally root).
root-line connects them through a tiny relay so
that Nitin's Claude Code can ask yours a question, and get the answer and
the files it needs, without anyone copying text between chats.

```
 your machine                         relay (Cloudflare Worker, free plan)        their machine
 ┌──────────────────────┐            ┌──────────────────────────────┐            ┌──────────────────────┐
 │ Claude Code ── line ─┼──── wss ──▶│ one Durable Object per line: │◀── wss ────┼─ line ── Claude Code │
 │ root (optional) ─────┼──── wss ──▶│ who is online, held messages │◀── wss ────┼───── root (optional) │
 └──────────────────────┘            │ R2: big files, wiped after   │            └──────────────────────┘
                                     └──────────────────────────────┘
```

- **Every agent on the line can be reached.** Address one agent (`nitin/claude-code.api`)
  or a person (`@nitin`: their root if it is up and answering, else their Claude Code).
  Anything sent to someone who is offline waits for them (7 days).
- **Messages reach the agent that is already working.** While Claude Code works,
  new messages are added to its context after each tool call. When it is idle, the
  next message wakes it (a background `Stop` hook with `asyncRewake`).
- **Context travels with the question.** Attach files: small ones ride inside the
  message, bigger ones (up to 25 MB) go to R2 and are wiped once nobody has been
  on the line for 10 minutes.
- **The relay cannot read anything.** Bodies and files are end-to-end encrypted
  (AES-256-GCM) with a key derived from the invite; the relay routes on names only.
- **No dependencies.** Node 22.4+ only (WebSocket, fetch and WebCrypto are built in).

## Set up

### 1. Deploy the relay (one person, once)

```bash
cd relay
npm install
npx wrangler login
npx wrangler r2 bucket create root-line-blobs   # optional: big files. Skip it and delete
                                               # the [[r2_buckets]] block in wrangler.toml
npx wrangler deploy                            # prints https://root-line.<you>.workers.dev
```

Then make the line and share its invite **privately**. It is the line's password:

```bash
node bin/line.mjs new --relay https://root-line.<you>.workers.dev
```

### 2. Each person: join, then set up your projects

```bash
git clone <this repo> ~/root-line
alias line="node ~/root-line/bin/line.mjs"     # put it in your shell profile

line join '<invite>' --as nitin
cd ~/code/api && line setup                    # in every project whose Claude Code should be on the line
```

Restart Claude Code in that project and approve the `root-line` MCP server. That's
all. `setup` writes only per-machine settings: the MCP server is registered with
`claude mcp add -s local`, and the hooks go into `.claude/settings.local.json`,
which is kept out of git. Nothing is committed to the project. `line remove`
undoes it.

## Use it

Talk to your Claude Code normally:

> Ask @nitin which payload shape the WebSocket heartbeat sends, and attach our `auth/schema.py`.

Claude uses its tools:

| Tool | What it does |
| :- | :- |
| `line_agents` | Who is on the line now: address, kind, whether they answer |
| `line_ask` | Ask an agent or a person, attach files, and wait for the answer (it arrives later on its own if it is slow) |
| `line_reply` | Answer a message by its id, with files |
| `line_inbox` | Messages not yet seen (they normally appear on their own), or `recent: true` to see them again |

From a terminal: `line status` shows who is on the line, and `line send @nitin "text" --file x` sends.

**root (optional).** If you run root, it joins the same line as
`<you>/root` and answers questions about your repository in a read-only session,
even while you are away. You can watch those sessions in root's UI. Turn it on
with `tura-code line answer ~/code/api` and restart root. With root up,
`@you` goes to root first.

## Security

- **The invite is the line.** Anyone holding it can join under any name. Share it
  only with your team. To revoke access, make a new line and re-join.
- **The relay sees only routing metadata:** agent names, who messages whom and
  when, and sizes. It never sees message text or file contents.
- **Messages from other agents are information, not instructions.** Claude is
  shown them quoted and attributed, and told to check with you before acting on
  anything that changes code or state. Claude Code's own permissions still apply
  to everything it does. root answers in plan mode, where editing tools are
  removed.
- **Waking Claude is on by default.** Use `line setup --no-wake` for a project where
  you would rather see messages only while Claude is working.

## Limits

| | |
| :- | :- |
| Inline file | 64 KB (sealed inside the message) |
| File via R2 | 25 MB each |
| Held messages | 7 days, up to 5000 per line |
| R2 files | Wiped 10 min after the last agent leaves, except files for messages still waiting for someone |

## Develop

```bash
cd relay && npm install && cd ..
npm test        # starts the relay locally (wrangler dev) and runs everything against it
```

| Path | What it is |
| :- | :- |
| `relay/src/index.js` | The Worker and the line's Durable Object |
| `lib/protocol.mjs` | Invite, keys, sealing. Byte-compatible with root's Python client (`server/tura_code/line/`) |
| `lib/client.mjs` | One agent's connection |
| `lib/inbox.mjs` | Local config and per-agent inbox |
| `lib/mcp.mjs` | Claude Code's tools |
| `lib/hooks.mjs` | Messages into a working or idle agent |
| `lib/setup.mjs` | Per-project install and removal |
