import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Chamber Agent Coordination Protocol (ACP)
 *
 * Implements typed collaboration operations between coding agents:
 * - ask: Request information or investigation from another agent with context
 * - delegate: Hand a bounded piece of work to an agent
 * - review: Request validation of a patch, contract, or implementation
 * - propose: Offer a change or architectural decision for consideration
 * - resolve: Close the request with verified outcome and supporting evidence
 * - handoff: Transfer work, context, and outstanding obligations between agents
 *
 * Lifecycle:
 * requested -> claimed -> in_progress -> resolved | rejected | timed_out
 */

export const COORDINATION_OPS = ["ask", "delegate", "review", "propose", "resolve", "handoff"];
export const COORDINATION_STATUSES = ["requested", "claimed", "in_progress", "resolved", "rejected", "timed_out"];

export class CoordinationTask {
  constructor({
    id = randomBytes(16).toString("hex"),
    op = "ask",
    status = "requested",
    from,
    to,
    title,
    description = "",
    branch = "",
    contract = null,
    files = [],
    evidence = null,
    resolution = null,
    rejectionReason = null,
    claimedBy = null,
    deadlineMs = Date.now() + 30 * 60 * 1000, // 30 min default
    createdAt = Date.now(),
    updatedAt = Date.now(),
  }) {
    if (!COORDINATION_OPS.includes(op)) {
      throw new Error(`Invalid coordination operation "${op}". Must be one of: ${COORDINATION_OPS.join(", ")}`);
    }
    this.id = id;
    this.op = op;
    this.status = status;
    this.from = from;
    this.to = to;
    this.title = title || `${op.toUpperCase()} task`;
    this.description = description;
    this.branch = branch;
    this.contract = contract;
    this.files = Array.isArray(files) ? files : [];
    this.evidence = evidence;
    this.resolution = resolution;
    this.rejectionReason = rejectionReason;
    this.claimedBy = claimedBy;
    this.deadlineMs = deadlineMs;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  toJSON() {
    return {
      id: this.id,
      op: this.op,
      status: this.status,
      from: this.from,
      to: this.to,
      title: this.title,
      description: this.description,
      branch: this.branch,
      contract: this.contract,
      files: this.files,
      evidence: this.evidence,
      resolution: this.resolution,
      rejectionReason: this.rejectionReason,
      claimedBy: this.claimedBy,
      deadlineMs: this.deadlineMs,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

export class CoordinationManager {
  #dir;
  #filePath;
  #tasks = new Map();

  constructor(stateDir) {
    this.#dir = resolve(stateDir);
    this.#filePath = join(this.#dir, "coordination.jsonl");
    this.#load();
  }

  #load() {
    this.#tasks.clear();
    if (!existsSync(this.#filePath)) return;
    try {
      const content = readFileSync(this.#filePath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const raw = JSON.parse(trimmed);
          const task = new CoordinationTask(raw);
          this.#tasks.set(task.id, task);
        } catch {}
      }
    } catch {}
  }

  #persist() {
    mkdirSync(this.#dir, { recursive: true });
    const content = Array.from(this.#tasks.values())
      .map((t) => JSON.stringify(t.toJSON()))
      .join("\n") + "\n";
    writeFileSync(this.#filePath, content, "utf8");
  }

  /**
   * Request a new coordination task with durable idempotency.
   */
  request({
    id,
    op = "ask",
    from,
    to,
    title,
    description = "",
    branch = "",
    contract = null,
    files = [],
    deadlineMs,
  }) {
    if (!from || !to) throw new Error("Coordination task requires both 'from' and 'to' addresses.");
    if (!title) throw new Error("Coordination task requires a 'title'.");

    const coordId = id || randomBytes(16).toString("hex");
    if (this.#tasks.has(coordId)) {
      // Idempotency: return existing task if already submitted
      return this.#tasks.get(coordId);
    }

    const task = new CoordinationTask({
      id: coordId,
      op,
      status: "requested",
      from,
      to,
      title,
      description,
      branch,
      contract,
      files,
      deadlineMs: deadlineMs || Date.now() + 30 * 60 * 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    this.#tasks.set(task.id, task);
    this.#persist();
    return task;
  }

  /**
   * Claim a task by an agent.
   */
  claim(coordId, agent) {
    const task = this.#tasks.get(coordId);
    if (!task) throw new Error(`Coordination task "${coordId}" not found.`);
    if (task.status === "resolved") throw new Error(`Task "${coordId}" is already resolved.`);
    if (task.status === "rejected") throw new Error(`Task "${coordId}" is rejected.`);

    task.status = "claimed";
    task.claimedBy = agent;
    task.updatedAt = Date.now();
    this.#persist();
    return task;
  }

  /**
   * Mark task as actively being worked on.
   */
  startWork(coordId) {
    const task = this.#tasks.get(coordId);
    if (!task) throw new Error(`Coordination task "${coordId}" not found.`);
    if (task.status === "resolved" || task.status === "rejected") {
      throw new Error(`Cannot start work on terminal task "${coordId}" (status: ${task.status}).`);
    }

    task.status = "in_progress";
    task.updatedAt = Date.now();
    this.#persist();
    return task;
  }

  /**
   * Resolve a task with verified outcome and attached evidence.
   */
  resolve(coordId, { by, resolution, evidence = null, contract = null }) {
    const task = this.#tasks.get(coordId);
    if (!task) throw new Error(`Coordination task "${coordId}" not found.`);
    if (task.status === "resolved") {
      // Idempotent resolution
      return { task, alreadyResolved: true, memoryEntry: null };
    }

    task.status = "resolved";
    task.resolution = resolution || "Resolved";
    task.evidence = evidence;
    if (contract) task.contract = contract;
    task.updatedAt = Date.now();
    this.#persist();

    // Auto-generate source-backed team memory fact
    const memoryEntry = this.#formatMemoryEntry(task, by);
    return { task, alreadyResolved: false, memoryEntry };
  }

  /**
   * Reject a task.
   */
  reject(coordId, { by, reason }) {
    const task = this.#tasks.get(coordId);
    if (!task) throw new Error(`Coordination task "${coordId}" not found.`);
    if (task.status === "resolved") throw new Error(`Cannot reject already resolved task "${coordId}".`);

    task.status = "rejected";
    task.rejectionReason = reason || "Declined by agent";
    task.updatedAt = Date.now();
    this.#persist();
    return task;
  }

  /**
   * Handoff: transfer context, open obligations and next steps to another agent.
   */
  handoff(coordId, { fromAgent, toAgent, summary, nextStep, files = [] }) {
    const task = this.#tasks.get(coordId);
    if (!task) throw new Error(`Coordination task "${coordId}" not found.`);

    task.op = "handoff";
    task.status = "requested";
    task.from = fromAgent;
    task.to = toAgent;
    task.claimedBy = null;
    task.description = `${summary}\n\nNext step: ${nextStep}`;
    if (files.length) task.files = [...new Set([...task.files, ...files])];
    task.updatedAt = Date.now();
    this.#persist();
    return task;
  }

  get(coordId) {
    return this.#tasks.get(coordId) || null;
  }

  list({ status, op, to, from } = {}) {
    let result = Array.from(this.#tasks.values());
    if (status) result = result.filter((t) => t.status === status);
    if (op) result = result.filter((t) => t.op === op);
    if (to) result = result.filter((t) => t.to === to || t.to === `@${to}`);
    if (from) result = result.filter((t) => t.from === from || t.from === `@${from}`);
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Format source-backed memory bullet linking decision/contract to evidence.
   */
  #formatMemoryEntry(task, resolvedBy) {
    const date = new Date(task.updatedAt).toISOString().split("T")[0];
    const author = resolvedBy || task.claimedBy || task.to;
    const evidenceItems = [];
    if (task.branch) evidenceItems.push(`branch: \`${task.branch}\``);
    if (task.files?.length) evidenceItems.push(`files: ${task.files.map((f) => `\`${f}\``).join(", ")}`);
    if (task.evidence?.commit) evidenceItems.push(`commit: \`${task.evidence.commit.slice(0, 8)}\``);
    if (task.evidence?.schema) evidenceItems.push(`contract: \`${task.contract || "schema"}\``);

    const evidenceTag = evidenceItems.length ? ` *(Evidence: ${evidenceItems.join(", ")}; verified by @${author} on ${date})*` : ` *(Verified by @${author} on ${date})*`;
    return `- **[${task.op.toUpperCase()}] ${task.title}**: ${task.resolution}${evidenceTag}`;
  }

  /**
   * Advantage 3 Context Compiler:
   * Compiles small, relevant context packages for repository/symbols without ingesting full transcripts.
   */
  compileContextPackage({ memoryMarkdown = "", query = "", symbols = [], contracts = [] }) {
    const facts = [];
    const lines = (memoryMarkdown || "").split("\n");

    const searchTokens = [
      ...symbols.map((s) => s.toLowerCase()),
      ...contracts.map((c) => c.toLowerCase()),
      ...(query ? query.toLowerCase().split(/\s+/) : []),
    ].filter(Boolean);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("- **")) continue;
      const lower = trimmed.toLowerCase();
      const matches = searchTokens.length === 0 || searchTokens.some((tok) => lower.includes(tok));
      if (matches) facts.push(trimmed);
    }

    // Also include active/resolved coordination contracts matching tokens
    for (const task of this.#tasks.values()) {
      if (task.status === "resolved" && task.contract) {
        const lower = `${task.contract} ${task.title} ${task.resolution}`.toLowerCase();
        if (searchTokens.length === 0 || searchTokens.some((tok) => lower.includes(tok))) {
          facts.push(this.#formatMemoryEntry(task));
        }
      }
    }

    return {
      query,
      factsCount: facts.length,
      facts: facts.slice(0, 15),
      instructions: "Use these source-backed facts and contracts directly. Do not guess or contradict confirmed evidence.",
    };
  }
}
