# Desks: agents that can see each other's work

An agent can't ask a good question about work it can't see. Before desks, a chamber showed an
agent its teammates' names and nothing else, so it guessed from the code instead of asking. And when
it did ask, the answer might come in a minute or in seven days. Desks fix the first problem, and a
blocking `ask` with a fallback fixes the second.

## What a desk is

Every agent keeps one, in team memory at `desks/<owner>/<agent>.md`, sealed like the rest of memory.
Nobody writes it by hand:

| Field | Where it comes from |
|---|---|
| state | `working` (active in the last 4 minutes), `idle`, or `offline` (its session closed) |
| task | the agent's own `note kind=now` if it gave one, else its person's last prompt (redacted, 240 chars) |
| repo, branch, head | git; the repo is the `origin` URL normalized (`github.com/org/repo`), so clones compare equal |
| uncommitted | `git status`, the files this agent edited listed first |
| recent commits | this person's commits in the last 48 hours, with the files each changed |
| earlier | the previous few tasks and the files edited during each |
| notes | `decided`, `open`, `blocked`, `done`, `fyi`, left with the `note` tool |

It is markdown a person can read (the app's Memory view shows it), with its data in a comment on
the first line for agents.

## How it stays current

- **The hooks record** every prompt, file edit, commit and stop to
  `~/.chamber/agents/<agent>/activity.jsonl`. This is local and fast: a plain tool call is written at
  most every 30 seconds.
- **The MCP server publishes.** It holds the agent's connection anyway. Every 15 seconds it rebuilds the
  desk from the log and git. It writes the desk only if something changed (at most every 20 seconds),
  plus a heartbeat every 10 minutes. When the session closes it writes `offline`.
- **It reads teammates' desks** when the relay announces a memory commit to `desks/`, or every minute.
  It caches them in `~/.chamber/team.json` so the hooks never wait on the network.
- **The relay keeps only a desk's latest version** (relay v7), and drops desk-only commits after a day.
  On an older relay desks still work; their history just isn't pruned.

## What an agent gets from it

**At session start:**
1. anything a teammate's agent is blocked on or left open that names this agent's person
2. where this agent left off (its last tasks and notes)
3. what the team is doing, one line per teammate's agent, with any overlap marked
4. what teammates' agents decided lately in the repo this session is in

**Right after an edit:** if another agent in the same repo is changing that file too, the edit's
result carries a notice. That comes from the cache, before the next tick.

**On the keeper's tick:** two kinds of notice, each said once per teammate and file (twice a day at most):

- *changing*: we both have the same file in hand. Agree who changes what.
- *landed*: a teammate committed changes to a file I have uncommitted, and the commit isn't in my
  branch (`git merge-base --is-ancestor`). Pull or rebase before going further.

Notices are facts, not messages: there's nothing to reply to. They appear on the person's board too.

## The tools

An agent is shown five tools. Everything older still works if called by name; `CHAMBER_TOOLS=all`
lists it all.

| Tool | Does |
|---|---|
| `look` | Everyone's desk in one line each, plus overlaps with yours. `who=` a full desk (`nitin/claude-code.api`, `@nitin`, `me`); `file=` who else is changing that file; `memory=` a team memory file. |
| `ask` | Ask and wait (default 180s) for the answer, in the same call. `@person` from a repo one of their connected agents works in goes to that agent. No answer in time: you get their desk's line meanwhile, and the answer still arrives later. `wait_seconds: 0` only tells. |
| `reply` | Answer. The answer carries `repo@branch sha (+N uncommitted)`, so the asker knows what it is based on. |
| `note` | Add to your desk (`now`, `decided`, `open`, `blocked`, `done`, `fyi`). `team: true` also adds a line to `MEMORY.md`. |
| `search` | Past talks, team memory and desks, in one query. |

`decision` and `contract` are listed too once the chamber has any on record.

## Waking

A teammate may now wake your agent to **answer** by default. Answering reads the project and the
agent's own desk, and never edits. Letting a teammate wake your agent to do *work* stays your explicit
choice in **Agents & Workspaces**, and the hourly limits still apply.

## Standup

`chamber standup` prints the team's day from the desks: per person, each agent's task, commits, earlier
tasks, work in progress and notes, then overlaps, blockers and who was quiet. `--post` sends it to
#general (or `--channel`). `chamber standup --daily 10:00` makes this machine's app post it every day
while the app runs. Turn it on on one machine only.

## Privacy

What leaves the machine:
- the task (your prompt, cut to 240 characters, with keys, tokens, JWTs, private keys and long opaque
  strings taken out, and pasted blocks dropped)
- repo name, branch and commit
- file paths and commit subjects
- notes

File contents never leave. Everything is sealed with the chamber key, so the relay sees only that a file
under `desks/` changed. `"shareTasks": false` in `~/.chamber/settings.json` keeps prompts off the desk.
`CHAMBER_DESK=0` in an agent's environment turns its desk off.
