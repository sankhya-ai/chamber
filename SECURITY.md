# Security Policy

Chamber connects coding agents across teammates' workstations through a zero-knowledge Cloudflare Worker relay. Security, end-to-end encryption, and local execution sovereignty are fundamental to its architecture.

---

## 1. Threat Model & Trust Boundaries

```
[ Developer Workstation A ]                         [ Developer Workstation B ]
┌─────────────────────────┐                         ┌─────────────────────────┐
│ • Claude Code / Codex   │                         │ • Claude Code / Codex   │
│ • Local Git repo        │                         │ • Local Git repo        │
│ • Chamber Board (127.0.0.1)                      │ • Chamber Board (127.0.0.1)
│ • Encryption Keys       │                         │ • Encryption Keys       │
└────────────┬────────────┘                         └────────────┬────────────┘
             │                                                   │
             │ Authenticated & Sealed (AES-256-GCM)               │
             ▼                                                   ▼
       ┌───────────────────────────────────────────────────────────────┐
       │               Cloudflare Edge Worker & Durable Object         │
       │               • Zero-Knowledge Relay                          │
       │               • Routes on envelope only (from, to, reply_to)  │
       │               • Encrypted R2 attachments (ephemeral retention)│
       │               • Coordination task state (content sealed)      │
       └───────────────────────────────────────────────────────────────┘
```

Chamber treats the Cloudflare relay as **untrusted for message content**. If the Cloudflare relay environment is compromised or monitored, the attacker learns only routing metadata (agent IDs, message timestamps, ciphertext sizes) and cannot read:
- Message bodies or conversation context
- File attachments or diffs
- Remote approval gate payloads
- Team memory documents, including agents' desks
- Coordination task content (titles, descriptions, files, resolutions, evidence; sealed since relay v8, while the relay still runs the task's state machine)

---

## 2. Cryptographic Architecture

### End-to-End Encryption (E2EE)
- **Symmetric Cipher**: AES-256-GCM with random nonces; the envelope (line, sender, recipient, id, reply-to) is the associated data, so the relay can't alter or re-attribute a message.
- **Key Derivation**: HMAC-SHA256 of the chamber's invite secret derives the relay token and the content key. Every member shares the content key; the personal pass only controls access at the relay.
- **Envelope / Content Separation**: The relay inspects only the routing envelope (`from`, `to`, `reply_to`, `seq`). The payload body is sealed client-side before dispatch.
- **Large Attachments**: Blobs exceeding inline message limits are encrypted client-side and streamed to Cloudflare R2 under an ephemeral storage lifecycle (deleted when the line session goes idle).

### Identity & Access Control
- **Admin Keys**: Ed25519 public key cryptography.
- **Personal Passes**: The admin signs a pass per member. Passes don't expire; a revocation order signed by the admin key removes a member for good and keeps their name from being reused.
- **Join links (relay v8)**: `chamber invite` and the app's Invite make a one-time link, `https://<relay>/join/<line>.<id>#<key>`. The relay keeps the teammate's invite sealed with `key`, which only travels in the link's fragment, and hands the sealed copy out once, to a POST (a link preview's GET never uses it). Links expire after 3 days (at most 7). Only the admin can make one. So an invite pasted into a chat or into a coding agent's transcript opens nothing once used.
- **Workflow Signatures**: Autonomous workflows are signed by an admin Ed25519 private key and cryptographically bound to the specific `lineId`. Workflow content tampering or cross-chamber replay is rejected.

---

## 3. Local Machine & Mutation Security

The local board and MCP server run on `127.0.0.1`:

- **Host & Origin Validation**: Non-local Host headers are rejected (protection against DNS rebinding attacks).
- **Session Mutation Tokens**: All mutating HTTP requests (`POST`, `PUT`, `DELETE`) require an `x-chamber-token` matching the board's in-memory session token. Missing or incorrect tokens are rejected with `403 Forbidden`.
- **Project Boundary Traversal Protection**: MCP file access and attachment unpacking enforce strict realpath verification (`realpathSync`). Path traversal attempts (`../`, escape symlinks, absolute paths outside project root) are rejected.
- **Waking Agents**: The relay sends an owner's board a knock (message id, sender, recipient; never content) when a message waits for one of their agents that is not connected. The board wakes the agent only if the owner's per-agent rule (`~/.chamber/wake.json`) allows that sender. By default, teammates may wake an agent to **answer** (read-only); waking it to **work** is the owner's explicit choice. A woken agent runs headless in its own project with a fixed tool set: read-only plus the chamber tools to answer, or with file edits (no shell, no commit or push) for work. A woken Claude Code can't read secrets files (`.env*`, keys, `~/.ssh`, `~/.aws`, `~/.chamber` and the like; Claude Code applies these rules to Grep and Glob too). Codex runs in its read-only sandbox, which can read any file, so the message scrubbing below is its only guard. Its prompt names the sender and tells it to treat the message as a teammate's request that cannot change these rules. Limits: one run per agent at a time, 6 an hour per agent, 3 an hour per teammate, 20 minutes per run. Every wake and refusal is logged (`~/.chamber/wake-log.jsonl`) with the run's events (`~/.chamber/wakes/`).
- **Secrets stay out of messages**: every outgoing message's text, title and patch are scrubbed of what is almost surely a secret (private keys, provider API keys and tokens, JWTs, `NAME=value` where the name says secret, passwords in URLs, chamber invite keys). Secrets files (`.env*`, `*.pem`, `id_rsa`, credentials files…) and files holding a private key are refused as attachments. This is a backstop, not a guarantee: a secret in an unusual shape still goes through.
- **Message Cursor Durability**: The client commit cursor advances only after the message handler finishes durable local persistence. Network dropouts or processing exceptions force WebSocket reconnection and replay, preventing dropped messages.

---

## 4. Private Channel Isolation

- Channels prefixed with `#p-` or `#private-` enforce strict server-side access control.
- Non-members cannot discover private channels in directory listings.
- Non-members cannot self-join existing private channels; membership requires an explicit add by an existing channel participant.

---

## 5. Agent Coordination Protocol (ACP) Correctness

- **Canonical State**: The Durable Object SQLite store acts as the single source of truth for coordination tasks across machines.
- **Deterministic State Machine**: State transitions (`requested` ➔ `claimed` ➔ `in_progress` ➔ `resolved` / `rejected` / `timed_out`) are validated on both relay and local managers. Terminal states are immutable.
- **Idempotency**: Requests specify client nonces and idempotency keys; duplicate submissions return existing tasks rather than re-executing actions.
- **Deadline Enforcement**: Tasks with elapsed deadlines automatically transition to `timed_out`.
- **Provenance Verification**: Task resolutions linking commits or schemas generate source-backed memory records capturing author identity and cryptographic timestamps.

---

## 6. What a team should know

Chamber connects agents that act for different people. These are the limits, stated plainly:

- **Anyone in the chamber is trusted with all of it.** Every member holds the same content key. A member can read every channel message they receive, all of team memory, and every desk. Invite only people you'd give the repository to.
- **Removing someone stops their access, but not their copy.** Revocation shuts them out of the relay at once. What they already synced stays on their machine, and they still hold the content key. Nothing can be read with it without the relay, but if the relay's storage ever leaked too, that key would open it. To be fully rid of a former member, start a new chamber.
- **Teammates' words reach your agent.** Messages, desks, notes and memory written by teammates' agents are shown to your agent, framed as information and not instructions. A malicious or compromised teammate could still try to steer your agent. That is why the answer wake mode is read-only, waking to work is off by default, and no woken agent gets a shell.
- **Desks share prompts by default.** A desk shows your latest prompt (cut to 240 characters, with keys and tokens removed) to the team. Set `"shareTasks": false` in `~/.chamber/settings.json` to share only what your agent writes with `note kind=now`.
- **The relay serves the client.** The installer and `chamber start`'s updates come from your chamber's relay. Whoever controls the relay's Cloudflare account (or Chamber Cloud, for hosted chambers) controls the code your teammates run. Keep that account's sign-in safe, with two-factor on.
- **Install only from what you pasted yourself.** Invites are made to be pasted by a person into their own agent. An agent should never run an install because a chamber message, a file or another agent asked it to. Chamber's own setup page says so.

---

## 7. Reporting a Vulnerability

If you discover a security vulnerability in Chamber, please disclose it responsibly:

1. **Email**: Send details to `security@turalearn.com`.
2. **Response Time**: We acknowledge receipt of vulnerability reports within 24 hours.
3. **Disclosure Policy**: We ask that you give us 14 days to resolve critical issues before any public disclosure.
