// The chamber as Claude Code tools: an MCP server on stdio, and the connection.
//
// While Claude Code runs, this keeps the agent in the chamber and writes what
// arrives to its inbox; the hooks (see hooks.mjs) show new messages to Claude
// mid-task, and wake it when it is idle. The tools let Claude see who is on the
// chamber, ask, read, and reply.

import { readFileSync, realpathSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";

import { LineClient } from "./client.mjs";
import { CONVENTIONS, ENTRY, TeamMemory } from "./memory.mjs";
import { describe, Inbox, loadConfig } from "./inbox.mjs";
import { LineError, MAX_FILE_BYTES } from "./protocol.mjs";
import { CoordinationManager } from "./coordination.mjs";

const PROTOCOL = "2025-06-18";

const today = () => new Date().toISOString().slice(0, 10);

const MEMORY_TOOLS = [
  {
    name: "memory",
    description: "Read the team's shared memory: MEMORY.md (the index) by default, or any file in it (e.g. contracts/auth-token.md). Follow [[links]] by reading the linked path + .md.",
    inputSchema: { type: "object", properties: { path: { type: "string", default: ENTRY } } },
  },
  {
    name: "memory_search",
    description: "Search the team's memory for lines containing all the given words. Use before answering about people, decisions, contracts, owners or conventions, and before writing (no near-duplicates).",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "memory_write",
    description: "Create or replace a whole file in the team's memory (e.g. decisions/billing.md). Shared with the whole team at once. One fact per bullet, with [source: talk/<id>#<msg>; by: <who>; added: <date>].",
    inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, message: { type: "string", description: "What you're remembering (the commit message)." } }, required: ["path", "content", "message"] },
  },
  {
    name: "memory_edit",
    description: "Replace one exact snippet in a team memory file (must match once). Prefer this to add or change one bullet.",
    inputSchema: { type: "object", properties: { path: { type: "string" }, old: { type: "string" }, new: { type: "string" }, message: { type: "string" } }, required: ["path", "old", "new", "message"] },
  },
];

const TOOLS = [
  {
    name: "agents",
    description: "List the agents in the chamber right now (yours and your teammates'): address, kind, and whether they answer questions.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "ask",
    description:
      "Ask another agent in the chamber and wait for its answer. `to` is an address like `nitin/claude-code.api`, `@nitin` for that person's best available agent, or `#channel` for a channel (@mention people in the message to reach their agents). Attach files (paths relative to the project) as context. If no answer comes in time, it arrives later on its own.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        message: { type: "string" },
        files: { type: "array", items: { type: "string" } },
        branch: { type: "string", description: "Git branch for context (e.g. feat/auth-e2ee)" },
        wait_seconds: { type: "integer", minimum: 0, maximum: 600, default: 180 },
      },
      required: ["to", "message"],
    },
  },
  {
    name: "inbox",
    description: "Show messages other agents sent you that you have not seen yet (they also appear on their own as you work). `recent: true` shows the last 20 again.",
    inputSchema: { type: "object", properties: { recent: { type: "boolean", default: false } } },
  },
  {
    name: "reply",
    description: "Answer a message from another agent, by its id. Attach files (paths relative to the project) if useful. Never send credentials, keys or .env contents.",
    inputSchema: {
      type: "object",
      properties: { message_id: { type: "string" }, message: { type: "string" }, files: { type: "array", items: { type: "string" } } },
      required: ["message_id", "message"],
    },
  },
  {
    name: "search",
    description: "Search across all decrypted talks, patches, contracts, team memories, and past incidents.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        channel: { type: "string", description: "Filter by channel (e.g. #backend)" },
        type: { type: "string", description: "Filter by record type (e.g. patch, incident, decision)" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "incident_memory",
    description: "Search specifically for past bug fixes, error messages, and resolved incidents (e.g. 'Have we seen this error before?').",
    inputSchema: {
      type: "object",
      properties: {
        error: { type: "string", description: "The error message or failure snippet to search for" },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
      },
      required: ["error"],
    },
  },
  {
    name: "send_patch",
    description: "Send a git diff/patch as a typed message to an agent or channel.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        patch: { type: "string", description: "Unified diff (git diff output)" },
        description: { type: "string", description: "Summary of changes" },
        branch: { type: "string", description: "Branch or topic name" },
      },
      required: ["to", "patch"],
    },
  },
  {
    name: "review_patch",
    description: "Check if a patch in a received message applies cleanly to this repo (using git apply --check) and view file stats.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "The message ID containing the patch" },
      },
      required: ["message_id"],
    },
  },
];

const COORDINATION_TOOLS = [
  {
    name: "coordinate_ask",
    description: "Request information, contract details, or code investigation from another agent. Unlike basic chat, this creates a tracked, durable coordination ticket with branch context, schema contracts, and verifiable completion.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Target agent (e.g. 'ashish/claude-code.api', '@ashish', or '#backend')" },
        title: { type: "string", description: "Clear title of the request (e.g. 'Payment API contract verification')" },
        description: { type: "string", description: "Detailed description of what is requested" },
        contract: { type: "string", description: "Name/id of the API contract or schema if applicable" },
        branch: { type: "string", description: "Git branch for context" },
        files: { type: "array", items: { type: "string" }, description: "Relevant project files to attach" },
        wait_seconds: { type: "integer", minimum: 0, maximum: 600, default: 180 },
      },
      required: ["to", "title"],
    },
  },
  {
    name: "coordinate_delegate",
    description: "Hand a bounded piece of work to another agent with acceptance criteria and branch context.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Target agent" },
        title: { type: "string", description: "Title of delegated work" },
        description: { type: "string", description: "Clear task instructions and acceptance criteria" },
        branch: { type: "string", description: "Target branch" },
        files: { type: "array", items: { type: "string" } },
      },
      required: ["to", "title", "description"],
    },
  },
  {
    name: "coordinate_review",
    description: "Request validation of a patch, contract, or implementation against specification from another agent.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Reviewing agent" },
        title: { type: "string", description: "Review title" },
        patch: { type: "string", description: "Unified diff / git patch to review" },
        contract: { type: "string", description: "Contract/spec being reviewed against" },
        branch: { type: "string", description: "Branch name" },
        description: { type: "string", description: "Context or specific questions for the reviewer" },
      },
      required: ["to", "title", "patch"],
    },
  },
  {
    name: "coordinate_propose",
    description: "Propose an architectural decision, interface contract, or change for consideration and feedback from another agent or team member.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Target agent or teammate (@owner or owner/agent)" },
        title: { type: "string", description: "Proposal title" },
        proposal: { type: "string", description: "Detailed proposal description and rationale" },
        contract: { type: "string", description: "Interface schema or contract identifier" },
        branch: { type: "string", description: "Related branch" },
        files: { type: "array", items: { type: "string" }, description: "Relevant file paths in the workspace" },
      },
      required: ["to", "title", "proposal"],
    },
  },
  {
    name: "coordinate_resolve",
    description: "Close an active coordination task with verified outcome and supporting evidence (diffs, test output, schemas). Automatically commits source-backed knowledge to team memory.",
    inputSchema: {
      type: "object",
      properties: {
        coord_id: { type: "string", description: "Coordination task ID" },
        resolution: { type: "string", description: "Verified summary of the outcome/answer" },
        evidence: {
          type: "object",
          description: "Structured evidence supporting the resolution (commit, schema, test_output, files)",
          properties: {
            commit: { type: "string" },
            schema: { type: "string" },
            test_output: { type: "string" },
            files: { type: "array", items: { type: "string" } },
          },
        },
        contract: { type: "string", description: "Confirmed contract specification or schema" },
        commit_to_memory: { type: "boolean", default: true, description: "Whether to record this confirmed finding in team memory" },
      },
      required: ["coord_id", "resolution"],
    },
  },
  {
    name: "coordinate_handoff",
    description: "Transfer work, context, and outstanding obligations to another agent (e.g. when switching services or hitting context limits).",
    inputSchema: {
      type: "object",
      properties: {
        coord_id: { type: "string", description: "Coordination task ID" },
        to: { type: "string", description: "Receiving agent" },
        summary: { type: "string", description: "What was accomplished and decisions made" },
        next_step: { type: "string", description: "One concrete next action for the incoming agent" },
        files: { type: "array", items: { type: "string" } },
      },
      required: ["coord_id", "to", "summary", "next_step"],
    },
  },
  {
    name: "coordinate_status",
    description: "Query active or resolved coordination tasks in the chamber.",
    inputSchema: {
      type: "object",
      properties: {
        coord_id: { type: "string", description: "Specific task ID to inspect" },
        status: { type: "string", enum: ["requested", "claimed", "in_progress", "resolved", "rejected"] },
      },
    },
  },
  {
    name: "context_package",
    description: "Compile a minimal, relevant, source-backed context package for a specific repository, task, symbols, or contracts before starting work. Prevents ingesting massive irrelevant chat logs.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Task or topic summary" },
        symbols: { type: "array", items: { type: "string" }, description: "Specific symbol, function, or endpoint names" },
        contracts: { type: "array", items: { type: "string" }, description: "Contract or schema names" },
      },
    },
  },
];

function readFiles(paths, cwd) {
  let root = resolve(cwd);
  try {
    root = realpathSync(root);
  } catch {}
  return (paths || []).map((path) => {
    const full = resolve(root, path);
    if (!full.startsWith(root + sep) && full !== root) {
      throw new LineError(`file must be inside the project folder: ${path}`);
    }
    let real;
    try {
      real = realpathSync(full);
    } catch {
      throw new LineError(`not a file: ${path}`);
    }
    if (!real.startsWith(root + sep) && real !== root) {
      throw new LineError(`file traverses outside project folder: ${path}`);
    }
    let data;
    try {
      data = readFileSync(real);
    } catch {
      throw new LineError(`not a file: ${path}`);
    }
    if (data.length > MAX_FILE_BYTES) throw new LineError(`${path} is over ${MAX_FILE_BYTES / 2 ** 20} MB`);
    return { name: basename(real), data: new Uint8Array(data) };
  });
}

export class LineTools {
  constructor(client, inbox, cwd) {
    this.client = client;
    this.inbox = inbox;
    this.cwd = cwd;
    this.memory = new TeamMemory(client.invite, client.agent);
    const coordDir = inbox?.dir ? join(inbox.dir, "..", "..", "coordination") : join(cwd, ".coordination");
    this.coordination = new CoordinationManager(coordDir);
  }

  async #saved(result, what) {
    if (result.ok) return `Saved to team memory: ${what}.`;
    if (result.error) throw new LineError(result.error);
    return [
      "Rejected: a teammate (or a dream) changed this since you read it, so nothing was saved.",
      "Current version below. Write one version that keeps what's true from both, then retry.",
      ...result.current.map((c) => `--- ${c.path} (version ${c.version})\n${c.text ?? "(deleted)"}`),
    ].join("\n");
  }

  async call(name, args) {
    if (name === "memory") {
      const file = await this.memory.read(String(args.path || ENTRY));
      if (!file?.text) return args.path && args.path !== ENTRY ? `No such file: ${args.path}.` : `The team's memory is empty so far.\n\n${CONVENTIONS(today())}`;
      return `${file.path} (version ${file.version}):\n\n${file.text}`;
    }
    if (name === "memory_search") {
      const hits = await this.memory.search(String(args.query || ""));
      return hits.length ? hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join("\n") : "Nothing in team memory matches.";
    }
    if (name === "memory_write") return this.#saved(await this.memory.write(String(args.path), String(args.content), String(args.message || "remember")), args.path);
    if (name === "memory_edit") return this.#saved(await this.memory.edit(String(args.path), String(args.old), String(args.new), String(args.message || "update")), args.path);
    if (name === "agents") {
      const head = `You are ${this.client.agent}.${this.client.connected ? "" : ` Not connected: ${this.client.problem || "connecting"}.`}`;
      const rows = this.client.roster.map((a) => `- ${a.agent} (${a.kind}${a.answers ? ", answers" : ""})${a.label ? ` — ${a.label}` : ""}`);
      const owner = this.client.agent.split("/")[0];
      const channels = this.client.channels.filter((c) => c.members.includes(owner)).map((c) => `${c.name} (${c.members.join(", ")})`);
      return [head, ...rows, "", `Your channels: ${channels.join("; ") || "none"}. Send to a channel with to: "#name"; @mention people there to reach their agents.`].join("\n");
    }
    if (name === "ask") {
      const wait = Number(args.wait_seconds ?? 180);
      const text = String(args.message);
      const files = readFiles(args.files, this.cwd);
      const title = text.split("\n")[0].slice(0, 80);
      const branch = args.branch ? String(args.branch) : null;
      const onSent = (receipt) => this.inbox.sent(receipt, { to: args.to, text, title, files, branch });
      const { receipt, reply } = await this.client.ask(args.to, text, { files, title, timeout: wait * 1000, onSent, branch });
      const sent = `Sent to ${receipt.to || args.to}${receipt.held ? " (held until they come online)" : ""}`;
      if (!reply) return `${sent}. No answer within ${wait}s; it will reach you on its own when it comes.`;
      const record = this.inbox.add(reply);
      this.inbox.claim(); // shown here; the hooks need not show it again
      return `${sent}. Answer:\n${describe([record], { intro: false })}`;
    }
    if (name === "inbox") {
      const records = args.recent ? this.inbox.all().slice(-20) : this.inbox.claim();
      return records.length ? describe(records) : "No new messages.";
    }
    if (name === "reply") {
      const original = this.inbox.find(String(args.message_id));
      if (!original) throw new LineError("unknown message id");
      const text = String(args.message);
      const files = readFiles(args.files, this.cwd);
      const thread = original.thread || original.id;
      const to = String(original.to || "").startsWith("#") ? original.to : original.from; // a channel conversation stays in its channel
      const receipt = await this.client.send(to, text, { files, replyTo: original.id, thread, title: original.title });
      this.inbox.sent(receipt, { to, text, replyTo: original.id, title: original.title, files });
      return `Replied to ${to}${receipt.held ? " (held until they come online)" : ""}.`;
    }
    if (name === "search") {
      const { ChamberSearch } = await import("./search.mjs");
      const owner = this.client.agent.split("/")[0];
      const search = new ChamberSearch(owner);
      const results = await search.search({
        query: String(args.query || ""),
        channel: args.channel ? String(args.channel) : "",
        type: args.type ? String(args.type) : "",
        limit: Number(args.limit || 10),
      });
      if (!results.length) return "No matching talks or records found.";
      return results.map((r) => `[${r.citation}] (${r.type}${r.channel ? ` in ${r.channel}` : ""}): ${r.title ? r.title + " — " : ""}${r.text.slice(0, 300)}`).join("\n\n");
    }
    if (name === "incident_memory") {
      const { ChamberSearch } = await import("./search.mjs");
      const owner = this.client.agent.split("/")[0];
      const search = new ChamberSearch(owner);
      const results = await search.incidentMemory(String(args.error || ""), Number(args.limit || 5));
      if (!results.length) return "No past incidents or root cause fixes match this error.";
      return [
        "Found matching past incidents / bug fixes:",
        ...results.map((r) => `--- [${r.citation}] ${r.title || "Incident"}\n${r.text}`),
      ].join("\n\n");
    }
    if (name === "send_patch") {
      const to = String(args.to);
      const patch = String(args.patch);
      const description = String(args.description || "Code patch");
      const branch = args.branch ? String(args.branch) : null;
      const title = `Patch: ${description.split("\n")[0].slice(0, 70)}`;
      const receipt = await this.client.send(to, description, {
        title,
        type: "patch",
        patch,
        branch,
      });
      this.inbox.sent(receipt, { to, text: description, title, type: "patch", patch, branch });
      return `Patch sent to ${to}${receipt.held ? " (held until they come online)" : ""}. ID: ${receipt.id}.`;
    }
    if (name === "review_patch") {
      const msg = this.inbox.find(String(args.message_id));
      if (!msg) throw new LineError("unknown message id");
      if (!msg.patch) return "Message does not contain a patch.";
      const { spawnSync } = await import("node:child_process");
      const check = spawnSync("git", ["apply", "--check", "-"], { cwd: this.cwd, input: msg.patch, encoding: "utf8" });
      const stat = spawnSync("git", ["apply", "--stat", "-"], { cwd: this.cwd, input: msg.patch, encoding: "utf8" });
      if (check.status === 0) {
        return `✔ Patch applies cleanly to repository at ${this.cwd}.\n\nStats:\n${stat.stdout || "(no stat available)"}`;
      } else {
        return `✖ Patch failed to apply cleanly:\n${check.stderr || check.stdout || "git apply --check exited with error"}`;
      }
    }
    if (name === "coordinate_ask") {
      const wait = Number(args.wait_seconds ?? 180);
      const title = String(args.title);
      const desc = String(args.description || title);
      const files = readFiles(args.files, this.cwd);
      const branch = args.branch ? String(args.branch) : null;
      const contract = args.contract ? String(args.contract) : null;

      const task = this.coordination.request({
        op: "ask",
        from: this.client.agent,
        to: args.to,
        title,
        description: desc,
        branch,
        contract,
        files: (args.files || []).map(basename),
      });

      const messageText = `[ACP:ASK:${task.id}] ${title}\n\n${desc}${contract ? `\nContract: ${contract}` : ""}`;
      const onSent = (receipt) => this.inbox.sent(receipt, { to: args.to, text: messageText, title, files, branch });

      const { receipt, reply } = await this.client.ask(args.to, messageText, { files, title, timeout: wait * 1000, onSent, branch });
      const sent = `Coordination request #${task.id.slice(0, 8)} sent to ${receipt.to || args.to}${receipt.held ? " (held until they come online)" : ""}`;
      if (this.client?.invite) this.coordination.pushToRelay(this.client.invite, task, "request").catch(() => {});
      if (!reply) return `${sent}. Status: requested. Answer will arrive asynchronously.`;

      const record = this.inbox.add(reply);
      this.inbox.claim();
      return `${sent}. Answer received:\n${describe([record], { intro: false })}`;
    }
    if (name === "coordinate_delegate") {
      const title = String(args.title);
      const desc = String(args.description);
      const files = readFiles(args.files, this.cwd);
      const branch = args.branch ? String(args.branch) : null;

      const task = this.coordination.request({
        op: "delegate",
        from: this.client.agent,
        to: args.to,
        title,
        description: desc,
        branch,
        files: (args.files || []).map(basename),
      });

      const messageText = `[ACP:DELEGATE:${task.id}] ${title}\n\n${desc}`;
      const receipt = await this.client.send(args.to, messageText, { files, title, branch });
      this.inbox.sent(receipt, { to: args.to, text: messageText, title, files, branch });
      if (this.client?.invite) this.coordination.pushToRelay(this.client.invite, task, "request").catch(() => {});
      return `Delegated task #${task.id.slice(0, 8)} to ${args.to}${receipt.held ? " (held until online)" : ""}.`;
    }
    if (name === "coordinate_review") {
      const title = String(args.title);
      const patch = String(args.patch);
      const desc = String(args.description || "Review requested");
      const branch = args.branch ? String(args.branch) : null;
      const contract = args.contract ? String(args.contract) : null;

      const task = this.coordination.request({
        op: "review",
        from: this.client.agent,
        to: args.to,
        title,
        description: desc,
        branch,
        contract,
        files: [],
      });

      const messageText = `[ACP:REVIEW:${task.id}] ${title}\n\n${desc}${contract ? `\nAgainst contract: ${contract}` : ""}`;
      const receipt = await this.client.send(args.to, messageText, {
        title,
        type: "patch",
        patch,
        branch,
      });
      this.inbox.sent(receipt, { to: args.to, text: messageText, title, type: "patch", patch, branch });
      if (this.client?.invite) this.coordination.pushToRelay(this.client.invite, task, "request").catch(() => {});
      return `Review request #${task.id.slice(0, 8)} sent to ${args.to}.`;
    }
    if (name === "coordinate_propose") {
      const title = String(args.title);
      const proposal = String(args.proposal);
      const branch = args.branch ? String(args.branch) : null;
      const contract = args.contract ? String(args.contract) : null;
      const files = (args.files || []).map(basename);

      const task = this.coordination.request({
        op: "propose",
        from: this.client.agent,
        to: args.to,
        title,
        description: proposal,
        branch,
        contract,
        files,
      });

      const messageText = `[ACP:PROPOSE:${task.id}] ${title}\n\n${proposal}${contract ? `\nContract: ${contract}` : ""}`;
      const receipt = await this.client.send(args.to, messageText, {
        title: `[PROPOSE] ${title}`,
        branch,
      });
      this.inbox.sent(receipt, { to: args.to, text: messageText, title: `[PROPOSE] ${title}`, branch });
      if (this.client?.invite) this.coordination.pushToRelay(this.client.invite, task, "request").catch(() => {});
      return `Proposal #${task.id.slice(0, 8)} ("${title}") sent to ${args.to}${receipt.held ? " (held until online)" : ""}.`;
    }
    if (name === "coordinate_resolve") {
      const coordId = String(args.coord_id);
      const resolution = String(args.resolution);
      const evidence = args.evidence || null;
      const contract = args.contract ? String(args.contract) : null;
      const commitToMemory = args.commit_to_memory !== false;

      const { task, alreadyResolved, memoryEntry } = this.coordination.resolve(coordId, {
        by: this.client.agent,
        resolution,
        evidence,
        contract,
      });

      let memoryMsg = "";
      if (commitToMemory && memoryEntry) {
        try {
          const entryFile = await this.memory.read(ENTRY);
          const oldText = entryFile?.text || CONVENTIONS(today());
          const newText = `${oldText.trim()}\n${memoryEntry}\n`;
          await this.memory.write(ENTRY, newText, `acp: resolve #${task.id.slice(0, 8)} (${task.title})`);
          memoryMsg = `\n✔ Recorded source-backed fact in team memory (MEMORY.md).`;
        } catch (e) {
          memoryMsg = `\n(Could not update team memory: ${e.message})`;
        }
      }

      if (this.client?.invite) this.coordination.pushToRelay(this.client.invite, task, "resolve", { by: this.client.agent, resolution, evidence, contract }).catch(() => {});

      const notifyText = `[ACP:RESOLVED:${task.id}] ${task.title}\n\nResolution: ${resolution}`;
      try {
        await this.client.send(task.from, notifyText, { title: `Resolved: ${task.title}` });
      } catch {}

      return `Task #${task.id.slice(0, 8)} resolved.${alreadyResolved ? " (was already resolved)" : ""}${memoryMsg}`;
    }
    if (name === "coordinate_handoff") {
      const coordId = String(args.coord_id);
      const toAgent = String(args.to);
      const summary = String(args.summary);
      const nextStep = String(args.next_step);
      const files = (args.files || []).map(basename);

      const task = this.coordination.handoff(coordId, {
        fromAgent: this.client.agent,
        toAgent,
        summary,
        nextStep,
        files,
      });

      const messageText = `[ACP:HANDOFF:${task.id}] ${task.title}\n\nSummary:\n${summary}\n\nNext Step:\n${nextStep}`;
      const receipt = await this.client.send(toAgent, messageText, { title: `Handoff: ${task.title}` });
      this.inbox.sent(receipt, { to: toAgent, text: messageText, title: `Handoff: ${task.title}` });
      if (this.client?.invite) this.coordination.pushToRelay(this.client.invite, task, "handoff", { fromAgent: this.client.agent, toAgent, summary, nextStep, files }).catch(() => {});
      return `Handoff #${task.id.slice(0, 8)} completed. Work transferred to ${toAgent}.`;
    }
    if (name === "coordinate_status") {
      if (this.client?.invite) await this.coordination.syncWithRelay(this.client.invite).catch(() => {});
      if (args.coord_id) {
        const t = this.coordination.get(String(args.coord_id));
        if (!t) return `No coordination task found with ID "${args.coord_id}".`;
        return JSON.stringify(t.toJSON(), null, 2);
      }
      const tasks = this.coordination.list({ status: args.status ? String(args.status) : undefined });
      if (!tasks.length) return "No matching coordination tasks.";
      return tasks.map((t) => `[#${t.id.slice(0, 8)}] (${t.op.toUpperCase()} - ${t.status}) ${t.title}\nFrom: ${t.from} -> To: ${t.to}${t.contract ? ` | Contract: ${t.contract}` : ""}\nUpdated: ${new Date(t.updatedAt).toISOString()}`).join("\n\n");
    }
    if (name === "context_package") {
      let memoryText = "";
      try {
        const entryFile = await this.memory.read(ENTRY);
        memoryText = entryFile?.text || "";
      } catch {}
      const pkg = this.coordination.compileContextPackage({
        memoryMarkdown: memoryText,
        query: String(args.query || ""),
        symbols: Array.isArray(args.symbols) ? args.symbols : [],
        contracts: Array.isArray(args.contracts) ? args.contracts : [],
      });
      return [
        `=== Compiled Context Package (${pkg.factsCount} source-backed facts) ===`,
        pkg.instructions,
        "",
        ...pkg.facts,
      ].join("\n");
    }
    throw new LineError(`unknown tool ${name}`);
  }
}

export async function handle(tools, request) {
  const { method, id } = request;
  if (id === undefined || id === null) return null; // a notification
  let result;
  if (method === "initialize") {
    result = {
      protocolVersion: request.params?.protocolVersion || PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: "chamber", version: "0.2.0" },
      instructions: `You are in your team's chamber as ${tools.client.agent}. Teammates' agents coordinate with you; their messages appear on their own while you work and wake you when idle. Use the typed coordination tools (coordinate_ask, coordinate_delegate, coordinate_review, coordinate_resolve, coordinate_handoff) to collaborate reliably without human relays. Never send credentials or secrets.\n\nThe team shares durable memory (MEMORY.md and linked files): read it or compile context packages (context_package) before starting work; when a collaboration settles something durable (an API contract, architecture decision, ownership, convention), resolve it with coordinate_resolve to automatically update team memory with verified evidence citations.`,
    };
  } else if (method === "tools/list") {
    result = { tools: [...TOOLS, ...MEMORY_TOOLS, ...COORDINATION_TOOLS] };
  } else if (method === "tools/call") {
    try {
      result = { content: [{ type: "text", text: await tools.call(request.params?.name, request.params?.arguments || {}) }], isError: false };
    } catch (error) {
      result = { content: [{ type: "text", text: `chamber error: ${error.message}` }], isError: true };
    }
  } else if (method === "ping") {
    result = {};
  } else {
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method ${method}` } };
  }
  return { jsonrpc: "2.0", id, result };
}

/** The kind of agent from its name: claude-code.api → claude-code, codex.api → codex, dsh → dsh. */
export const kindOf = (name) => String(name).split(".")[0];
export const KIND_LABEL = { "claude-code": "Claude Code", codex: "Codex", antigravity: "Antigravity", dsh: "DeepSeek Harness" };

export async function serve(name) {
  const config = loadConfig();
  if (!config) {
    process.stderr.write("Not in a chamber yet: run the install command your teammate sent you.\n");
    return 2;
  }
  const agent = `${config.owner}/${name}`;
  const inbox = new Inbox(agent);
  const client = new LineClient(config.invite, agent, {
    kind: kindOf(name),
    label: `${KIND_LABEL[kindOf(name)] ?? kindOf(name)} · ${basename(process.cwd())}`,
    priority: 5,
    answers: true,
    cursorPath: inbox.cursorPath,
    onMessage: (message) => inbox.add(message),
  });
  client.run();
  const tools = new LineTools(client, inbox, process.cwd());
  const lines = createInterface({ input: process.stdin });
  lines.on("line", async (line) => {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      return;
    }
    const response = await handle(tools, request); // concurrent: a waiting ask does not block other calls
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
  await new Promise((resolve) => lines.on("close", resolve));
  client.close();
  return 0;
}
