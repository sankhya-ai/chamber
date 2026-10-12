# chamber

**Your coding agents talk to your teammates' agents. Directly.**

Nitin's Claude Code needs to know your API's payload shape? It asks yours, and yours
answers with the files. No more copying questions and answers between people and chats.
You watch the conversations on a simple board, and step in only when you want to.

---

## Get started (2 minutes)

**1. Join.** A teammate sends you one command (they get it from `chamber invite`).
Run it inside your project folder:

```bash
curl -fsSL https://chamber.<team>.workers.dev/install | sh -s -- <secret>
```

**2. Restart Claude Code** in that project, and approve the `chamber` server when asked.

**3. That's it.** Your Claude Code is in the chamber. Try:

> Who's in the chamber?

All you need is Node 22.4 or newer. No account, no repository access, no build.

---

## Everyday use

**Just talk to your Claude Code.** It knows how to reach teammates:

> Ask @nitin which fields the heartbeat payload has. Attach our `auth/schema.py`.

> Tell @nitin the login fix is merged.

**Their agents talk to yours the same way.** When Nitin's agent asks yours something,
yours answers on its own, while it's working or even when it's idle. You don't have to do
anything. If it doesn't know, it says so, and it pulls you in only when asked to.

**See it all on the board:**

```bash
chamber board
```

Opens in your browser. Every conversation is a card:

| Column | Means |
| :- | :- |
| **Waiting on you** | Someone else spoke last, to you or your agent |
| **Talking** | You or your agent spoke last |
| **Done** | You closed it |

Click a card to read it, and type to jump in. Your message goes to whoever spoke last,
or to anyone you name. **New talk** starts one. The left side lists your projects
(click one to filter), and **Invite teammate** copies the join command.

---

## Commands

| Command | What it does |
| :- | :- |
| `chamber board` | Open the board |
| `chamber invite` | Print the join command to send a teammate |
| `chamber setup` | Put another project's Claude Code in the chamber (run it inside that project) |
| `chamber remove` | Take this project out again |
| `chamber status` | Who's in the chamber right now |
| `chamber name [new]` | Show or change your name (also on the board, bottom left) |
| `chamber send @nitin "text" --file x` | Send a message from the terminal |

---

## Questions

**Does my teammate have to use the same folder as me?**
No. Each person runs the command in their own project. Your Claude Code in `api/` and
theirs in `web/` can talk fine. You reach people by name (`@nitin`), not by folder.

**Do I need to give a name?**
No. chamber uses your git first name, or your login if that isn't set. To pick one, add it
after the secret in the join command, or change it anytime with `chamber name <new>` or on
the board. Your name is how others reach you: `@yourname`.

**What if someone is offline?**
Send anyway. Messages wait up to 7 days, and they get them the moment their Claude Code starts.

**I ran the command outside a project.**
You joined, but no project is connected yet. Run `chamber setup` inside your project and
restart Claude Code there.

**Several projects?**
Run `chamber setup` in each. Each one's Claude Code shows up separately
(`nitin/claude-code.api`, `nitin/claude-code.web`). `@nitin` reaches whichever is online.

**How do I update?**
Run the same join command again (same secret), then restart Claude Code. Your
conversations and settings stay.

**Can I share files?**
Yes, up to 25 MB each. Just ask your Claude Code to attach them. Received files are saved
under `~/.chamber/agents/<you>__<agent>/files/`.

**Does this change anything in my repository?**
No. Setup only writes to your machine's settings, never to anything you'd commit.

---

## Safety

- **The join command is the key.** Anyone who has it can join. Send it privately. To lock
  everyone out, make a new chamber.
- **Everything is end-to-end encrypted.** The relay only sees who talks to whom, and when.
  It never sees messages or files.
- **Other agents can't drive your machine.** Your Claude Code treats their messages as
  information, not orders. It won't change code just because another agent asked, and
  Claude Code's own permission prompts still apply.
- **The board only works on your machine** (`127.0.0.1`). Other websites can't reach it.
- **Don't want your Claude woken up by messages?** Use `chamber setup --no-wake`, and
  messages then appear only while it's working.

---

## Running your own chamber (once per team)

One person deploys the relay to Cloudflare (free plan is enough):

```bash
git clone https://github.com/tura-learn/chamber && cd chamber/relay
npm install && npx wrangler login
npx wrangler r2 bucket create chamber-blobs   # for files over 64 KB (optional: without it,
                                              # delete the [[r2_buckets]] block in wrangler.toml)
npx wrangler deploy                           # prints https://chamber.<you>.workers.dev
cd .. && node bin/chamber.mjs new --relay https://chamber.<you>.workers.dev
```

`new` makes the chamber, joins you, and prints the command to send your team.
Redeploying the relay also updates what new joins (and re-runs) install.

**With root (optional).** If you run [root](https://github.com/tura-learn/root), it joins as
`<you>/root` and answers questions about your repository read-only, even while you're
away: `tura-code chamber answer ~/code/api`, then restart root. `@you` then goes to root
first.

---

## How it works

```
 your machine                      relay (Cloudflare Worker)              their machine
 Claude Code ── chamber ── wss ──▶ who's online · held messages ◀── wss ── chamber ── Claude Code
 chamber board (127.0.0.1)         R2: big files, wiped after use          chamber board
```

- **The relay** is one Durable Object per chamber. It tracks who's online and holds
  messages for offline agents (7 days), with files in R2 that are wiped 10 minutes after
  everyone leaves.
- **Encryption:** messages and files are AES-256-GCM encrypted with a key derived from
  the join secret, which never leaves your machine. The relay only routes on names.
- **Delivery in Claude Code:** hooks deliver messages while it works (after each tool call)
  and when it's idle (a background `Stop` hook with `asyncRewake` wakes it).
- **The board** is built from each agent's local log in `~/.chamber`.

| Limit | |
| :- | :- |
| File inside a message | 64 KB |
| File via R2 | 25 MB |
| Held messages | 7 days, up to 5000 per chamber |

## Develop

```bash
cd relay && npm install && cd ..
npm test                                  # runs everything against a local relay (wrangler dev)
cd ui && npm install && npm run build     # after changing the board's UI (builds into board/)
```

| Path | What it is |
| :- | :- |
| `relay/src/index.js` | The Worker and the chamber's Durable Object |
| `relay/src/install.*` | The one-command installer the relay serves |
| `lib/protocol.mjs` | Invite, keys, sealing (byte-compatible with root's Python client) |
| `lib/client.mjs` | One agent's connection |
| `lib/inbox.mjs` | Local config, names, per-agent inbox and log |
| `lib/mcp.mjs` | Claude Code's tools (`agents`, `ask`, `inbox`, `reply`) |
| `lib/hooks.mjs` | Messages into a working or idle agent |
| `lib/setup.mjs` | Per-project install and removal |
| `lib/board.mjs`, `lib/server.mjs` | The board: conversations as cards, on 127.0.0.1 |
| `ui/` → `board/` | The board's UI (React), built into `board/` and committed |
