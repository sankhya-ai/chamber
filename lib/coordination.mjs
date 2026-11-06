import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, renameSync } from "node:fs";
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

// ----- sealing what the relay needn't read ---------------------------------------------

const SEALED = "sealed:v1:";
const meta = (id, field) => ({ sender: "coordination", to: field, id: String(id || ""), replyTo: "" });
const seal = async (invite, id, field, value) => SEALED + (await invite.seal(value, meta(id, field)));

async function unseal(invite, id, field, text) {
  if (typeof text !== "string" || !text.startsWith(SEALED)) return null;
  try {
    return await invite.open(text.slice(SEALED.length).split(/\s/)[0], meta(id, field));
  } catch {
    return null;
  }
}

/** The body of a POST to the relay's coordination API, with the human parts sealed. */
export async function sealTask(invite, body, action = "request") {
  if (typeof invite?.seal !== "function") return body;
  const id = body.id;
  if (action === "request") {
    const { title, description, branch, contract, files } = body;
    return { ...body, title: "(sealed)", description: await seal(invite, id, "task", { title, description, branch, contract, files }), branch: "", contract: null, files: [], evidence: null, resolution: null };
  }
  if (action === "resolve") return { ...body, resolution: await seal(invite, id, "resolution", { resolution: body.resolution, evidence: body.evidence ?? null, contract: body.contract ?? null }), evidence: null, contract: null };
  if (action === "reject") return { ...body, reason: await seal(invite, id, "reason", { reason: body.reason ?? "" }) };
  if (action === "handoff") return { ...body, summary: await seal(invite, id, "handoff", { title: body.title ?? "", branch: body.branch ?? "", summary: body.summary ?? "", nextStep: body.nextStep ?? "", files: body.files ?? [] }), nextStep: "", files: [] };
  return body;
}

/** A task as the relay returned it, with its sealed parts opened (tasks from older clients pass through). */
export async function openTask(invite, raw) {
  if (typeof invite?.open !== "function" || !raw) return raw;
  const task = { ...raw };
  const opened = await unseal(invite, task.id, "task", task.description);
  if (opened) Object.assign(task, { title: opened.title, description: opened.description ?? "", branch: opened.branch ?? "", contract: opened.contract ?? null, files: opened.files ?? [] });
  // A handoff replaces the description with "<summary>\n\nNext step: <next>": the summary carries both.
  const handoff = await unseal(invite, task.id, "handoff", task.description);
  if (handoff) Object.assign(task, { title: handoff.title || task.title, branch: handoff.branch || task.branch, description: `${handoff.summary}\n\nNext step: ${handoff.nextStep}`, files: handoff.files?.length ? handoff.files : task.files });
  const resolution = await unseal(invite, task.id, "resolution", task.resolution);
  if (resolution) Object.assign(task, { resolution: resolution.resolution, evidence: resolution.evidence, contract: resolution.contract ?? task.contract });
  const reason = await unseal(invite, task.id, "reason", task.rejectionReason);
  if (reason) task.rejectionReason = reason.reason;
  return task;
}

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
      const now = Date.now();
      let dirty = false;
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const raw = JSON.parse(trimmed);
          const task = new CoordinationTask(raw);
          // Check for deadline expiration
          if (task.deadlineMs && now > task.deadlineMs && !["resolved", "rejected", "timed_out"].includes(task.status)) {
            task.status = "timed_out";
            task.updatedAt = now;
            dirty = true;
          }
          this.#tasks.set(task.id, task);
        } catch {}
      }
      if (dirty) this.#persist();
    } catch {}
  }

  #persist() {
    mkdirSync(this.#dir, { recursive: true });
    const tmpPath = `${this.#filePath}.tmp.${Date.now()}.${randomBytes(4).toString("hex")}`;
    const content = Array.from(this.#tasks.values())
      .map((t) => JSON.stringify(t.toJSON()))
      .join("\n") + "\n";
    writeFileSync(tmpPath, content, "utf8");
    renameSync(tmpPath, this.#filePath);
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

    this.#load();
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
    this.#load();
    const task = this.#tasks.get(coordId);
    if (!task) throw new Error(`Coordination task "${coordId}" not found.`);
    if (task.status === "resolved") throw new Error(`Task "${coordId}" is already resolved.`);
    if (task.status === "rejected") throw new Error(`Task "${coordId}" is rejected.`);
    if (task.status === "timed_out") throw new Error(`Task "${coordId}" has timed out.`);

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
    this.#load();
    const task = this.#tasks.get(coordId);
    if (!task) throw new Error(`Coordination task "${coordId}" not found.`);
    if (task.status === "resolved" || task.status === "rejected" || task.status === "timed_out") {
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
    this.#load();
    const task = this.#tasks.get(coordId);
    if (!task) throw new Error(`Coordination task "${coordId}" not found.`);
    if (task.status === "resolved") {
      // Idempotent resolution
      return { task, alreadyResolved: true, memoryEntry: null };
    }
    if (task.status === "rejected" || task.status === "timed_out") {
      throw new Error(`Cannot resolve task "${coordId}" in status ${task.status}.`);
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
    this.#load();
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
    this.#load();
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
    this.#load();
    return this.#tasks.get(coordId) || null;
  }

  list({ status, op, to, from } = {}) {
    this.#load();
    let result = Array.from(this.#tasks.values());
    if (status) result = result.filter((t) => t.status === status);
    if (op) result = result.filter((t) => t.op === op);
    if (to) result = result.filter((t) => t.to === to || t.to === `@${to.replace(/^@/, "")}`);
    if (from) result = result.filter((t) => t.from === from || t.from === `@${from.replace(/^@/, "")}`);
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Automatically import or reconcile an ACP task received via encrypted message.
   */
  importTaskFromMessage(message) {
    if (!message?.text) return null;
    const match = /\[ACP:(ASK|DELEGATE|REVIEW|PROPOSE|RESOLVE|HANDOFF):([0-9a-f]{16,64})\]/i.exec(message.text);
    if (!match) return null;
    const [, rawOp, taskId] = match;
    const op = rawOp.toLowerCase();
    this.#load();
    let task = this.#tasks.get(taskId);
    const now = Date.now();
    if (!task) {
      task = new CoordinationTask({
        id: taskId,
        op: op === "resolve" ? "ask" : op,
        status: op === "resolve" ? "resolved" : "requested",
        from: message.from,
        to: message.to,
        title: message.title || `${op.toUpperCase()} task`,
        description: message.text.replace(/\[ACP:[^\]]+\]\s*/i, "").trim(),
        branch: message.branch || "",
        createdAt: message.ts || now,
        updatedAt: message.ts || now,
      });
      this.#tasks.set(task.id, task);
      this.#persist();
    } else if (op === "resolve" && task.status !== "resolved") {
      task.status = "resolved";
      task.resolution = message.text.replace(/\[ACP:RESOLVE:[^\]]+\]\s*/i, "").trim() || "Resolved";
      task.updatedAt = message.ts || now;
      this.#persist();
    }
    return task;
  }

  /**
   * Synchronize with the authoritative Cloudflare DO relay.
   *
   * The relay runs the task's state machine (op, status, from, to, deadline), so it sees those;
   * everything a person wrote (title, description, files, branch, contract, resolution, evidence,
   * reasons) goes sealed with the chamber key, like messages and memory.
   */
  async syncWithRelay(invite, { status, op, since = 0 } = {}) {
    if (!invite?.coordinationUrl) return { synced: 0 };
    await invite.ready();
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (op) query.set("op", op);
    if (since) query.set("since", String(since));
    const url = `${invite.coordinationUrl()}${query.toString() ? `?${query.toString()}` : ""}`;
    try {
      const res = await fetch(url, { headers: { ...invite.auth, ...(invite.pass ? { "x-chamber-pass": invite.pass } : {}) } });
      if (!res.ok) return { synced: 0, error: `Relay HTTP ${res.status}` };
      const { tasks = [], maxSeq = 0 } = await res.json();
      this.#load();
      let updated = 0;
      for (const raw of tasks) {
        const remoteTask = new CoordinationTask(await openTask(invite, raw));
        const localTask = this.#tasks.get(remoteTask.id);
        if (!localTask || remoteTask.updatedAt >= localTask.updatedAt) {
          this.#tasks.set(remoteTask.id, remoteTask);
          updated++;
        }
      }
      if (updated > 0) this.#persist();
      return { synced: updated, maxSeq };
    } catch (e) {
      return { synced: 0, error: e.message };
    }
  }

  /**
   * Push a local coordination action to the Cloudflare DO relay.
   */
  async pushToRelay(invite, task, action = "request", extra = {}) {
    if (!invite?.coordinationUrl) return null;
    await invite.ready();
    const url = invite.coordinationUrl(action === "request" ? "" : action);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...invite.auth, ...(invite.pass ? { "x-chamber-pass": invite.pass } : {}) },
        body: JSON.stringify(await sealTask(invite, { ...task.toJSON(), ...extra }, action)),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.task) {
        const canonical = new CoordinationTask(await openTask(invite, data.task));
        this.#tasks.set(canonical.id, canonical);
        this.#persist();
        return canonical;
      }
      return null;
    } catch {
      return null;
    }
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
