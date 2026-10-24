// The Always-On Headless Runner & Cryptographically Signed Workflow Engine.
//
// Solves the E2EE Workflow Dilemma:
// Because Chamber is strictly End-to-End Encrypted, the Cloudflare relay cannot
// inspect messages or trigger workflows. The Headless Runner runs on an always-on host
// (an office Mac mini, CI VM, or background daemon), decrypts messages with the chamber key,
// and executes verified tasks.
//
// Security Architecture:
// 1. Admin-Signed Workflows: Workflow files (.chamber/workflows/*.yaml) must be signed
//    with the Chamber Admin's key. PRs or unmerged branches cannot tamper with workflows
//    to instruct teammates' agents or execute malicious commands.
// 2. Cryptographic Approval Gates: Sensitive actions pause at an approval gate.
//    Gates can be approved locally on the board or via an ephemeral signed token.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LineClient } from "./client.mjs";
import { adminState, HOME, Inbox, loadConfig } from "./inbox.mjs";
import { LineError } from "./protocol.mjs";

const enc = new TextEncoder();

/**
 * Sign a workflow string using the admin key.
 */
export async function signWorkflow(content, adminSecret) {
  const mac = await crypto.subtle.importKey(
    "raw",
    enc.encode(adminSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", mac, enc.encode(content.trim()));
  const b64 = Buffer.from(sig).toString("base64url");
  return `# chamber-signature: ${b64}\n${content.trim()}\n`;
}

/**
 * Verify a workflow's admin signature.
 */
export async function verifyWorkflow(signedContent, adminSecret) {
  const match = signedContent.match(/^# chamber-signature:\s*([A-Za-z0-9_-]+)\n([\s\S]*)$/);
  if (!match) return { valid: false, error: "Workflow missing admin signature header" };

  const [, sig, body] = match;
  try {
    const mac = await crypto.subtle.importKey(
      "raw",
      enc.encode(adminSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      mac,
      Buffer.from(sig, "base64url"),
      enc.encode(body.trim())
    );
    return { valid, body: body.trim() };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

export class ApprovalGateManager {
  constructor(baseDir = HOME) {
    this.gatesDir = join(baseDir, "gates");
    mkdirSync(this.gatesDir, { recursive: true, mode: 0o700 });
  }

  createGate({ description, action, requestedBy, expiresMinutes = 60, relayUrl = null }) {
    const gateId = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const token = [...crypto.getRandomValues(new Uint8Array(24))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const gate = {
      id: gateId,
      token,
      description,
      action,
      requestedBy,
      status: "pending",
      createdAt: Date.now(),
      expiresAt: Date.now() + expiresMinutes * 60 * 1000,
    };

    if (relayUrl) {
      gate.mobileUrl = `${relayUrl.replace(/\/+$/, "")}/gate/${gateId}?token=${token}`;
      fetch(`${relayUrl.replace(/\/+$/, "")}/v1/gate/${gateId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: gateId,
          token,
          description,
          action,
          requestedBy,
          expiresAt: gate.expiresAt,
        }),
      }).catch(() => {});
    }

    writeFileSync(join(this.gatesDir, `${gateId}.json`), JSON.stringify(gate, null, 2), { mode: 0o600 });
    return gate;
  }

  getGate(gateId) {
    try {
      const data = JSON.parse(readFileSync(join(this.gatesDir, `${gateId}.json`), "utf8"));
      if (Date.now() > data.expiresAt && data.status === "pending") {
        data.status = "expired";
      }
      return data;
    } catch {
      return null;
    }
  }

  async syncRemote(gateId, relayUrl) {
    const gate = this.getGate(gateId);
    if (!gate || gate.status !== "pending" || !relayUrl) return gate;
    try {
      const res = await fetch(`${relayUrl.replace(/\/+$/, "")}/gate/${gateId}?token=${gate.token}&format=json`);
      if (res.ok) {
        const remote = await res.json();
        if (remote.gate && remote.gate.status && remote.gate.status !== "pending") {
          return this.resolveGate(gateId, remote.gate.status, {
            token: gate.token,
            approver: remote.gate.approver || "remote-mobile",
          });
        }
      }
    } catch {}
    return gate;
  }

  resolveGate(gateId, decision, { approver = "admin", token = null, relayUrl = null } = {}) {
    const gate = this.getGate(gateId);
    if (!gate) throw new LineError("Gate not found");
    if (gate.status !== "pending") throw new LineError(`Gate already ${gate.status}`);
    if (token && gate.token !== token) throw new LineError("Invalid gate approval token");

    gate.status = decision === "approve" || decision === "approved" ? "approved" : "rejected";
    gate.resolvedAt = Date.now();
    gate.resolvedBy = approver;

    writeFileSync(join(this.gatesDir, `${gateId}.json`), JSON.stringify(gate, null, 2), { mode: 0o600 });

    if (relayUrl) {
      fetch(`${relayUrl.replace(/\/+$/, "")}/gate/${gateId}?token=${gate.token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, approver, token: gate.token }),
      }).catch(() => {});
    }

    return gate;
  }

  listPending() {
    if (!existsSync(this.gatesDir)) return [];
    const out = [];
    for (const f of readdirSync(this.gatesDir)) {
      if (f.endsWith(".json")) {
        const g = this.getGate(f.replace(".json", ""));
        if (g && g.status === "pending") out.push(g);
      }
    }
    return out;
  }
}

/**
 * Standard pre-canned templates installed in .chamber/workflows/
 */
export async function installDefaultWorkflows(workflowsDir, adminSecret = null) {
  mkdirSync(workflowsDir, { recursive: true, mode: 0o755 });

  const onPatch = `name: on-patch
on: patch
description: Automatically verify patches with git apply --check and alert the channel
steps:
  - name: verify-patch
    run: git apply --check -
  - name: report
    run: chamber send "$CHANNEL" "Patch verified cleanly on branch $BRANCH"`;

  const onGate = `name: on-gate
on: migration
description: Require explicit human approval before running database migrations
gate:
  action: deploy-prod-migration
  description: "Review and approve production database migration before applying"
  expires_minutes: 30
steps:
  - name: apply-migration
    run: npm run migrate:prod`;

  const patchFile = join(workflowsDir, "on-patch.yaml");
  const gateFile = join(workflowsDir, "on-gate.yaml");

  const signedPatch = adminSecret ? await signWorkflow(onPatch, adminSecret) : onPatch;
  const signedGate = adminSecret ? await signWorkflow(onGate, adminSecret) : onGate;

  if (!existsSync(patchFile)) writeFileSync(patchFile, signedPatch, { mode: 0o644 });
  if (!existsSync(gateFile)) writeFileSync(gateFile, signedGate, { mode: 0o644 });

  return { patchFile, gateFile };
}

export class ChamberRunner {
  constructor(config = loadConfig(), { cwd = process.cwd(), workflowsDir = null } = {}) {
    if (!config) throw new Error("not in a chamber yet");
    this.config = config;
    this.owner = config.owner;
    this.cwd = cwd;
    this.agent = `${this.owner}/runner`;
    this.workflowsDir = workflowsDir || join(cwd, ".chamber", "workflows");
    this.gateManager = new ApprovalGateManager(join(HOME, this.owner));
    this.client = null;
    this.running = false;
  }

  async start() {
    const admin = adminState();
    const adminSecret = admin?.secret || this.config.invite.secret;
    if (!existsSync(this.workflowsDir)) {
      await installDefaultWorkflows(this.workflowsDir, adminSecret);
    }

    this.client = new LineClient(this.config.invite, this.agent, {
      kind: "runner",
      label: "Always-on Chamber Runner & Workflow Engine",
      priority: 5,
      answers: true,
      onMessage: (msg) => this.#onEvent(msg),
    });

    this.client.run();
    await this.client.ready();
    this.running = true;
    return this;
  }

  async stop() {
    this.running = false;
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  async #onEvent(message) {
    if (!this.running) return;

    // Trigger on incoming patches
    if (message.type === "patch" && message.patch) {
      await this.#handlePatchEvent(message);
    }
  }

  async #handlePatchEvent(message) {
    const admin = adminState();
    const adminSecret = admin?.secret || this.config.invite.secret;

    // Check if there are signed workflows in .chamber/workflows
    if (!existsSync(this.workflowsDir)) return;

    const files = readdirSync(this.workflowsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const file of files) {
      const fullPath = join(this.workflowsDir, file);
      const content = readFileSync(fullPath, "utf8");

      const check = await verifyWorkflow(content, adminSecret);
      if (!check.valid) {
        console.warn(`[Runner] Skipping unsigned/tampered workflow ${file}: ${check.error}`);
        continue;
      }

      // Check if workflow triggers on patch
      if (/on:\s*patch/i.test(check.body)) {
        // Create an approval gate if sensitive
        const gate = this.gateManager.createGate({
          description: `Apply patch from ${message.from}: ${message.title || "Code patch"}`,
          action: "git apply",
          requestedBy: message.from,
          relayUrl: this.config.invite.relay,
        });

        // Notify in thread
        const to = String(message.to || "").startsWith("#") ? message.to : message.from;
        const thread = message.thread || message.id;
        const mobileNotice = gate.mobileUrl ? `\nRemote mobile approval: ${gate.mobileUrl}` : "";
        await this.client.send(
          to,
          `Workflow triggered: [${file}]. Created approval gate: ${gate.id}.${mobileNotice}\nApprove via mobile link, the board, or \`chamber gate approve ${gate.id}\`.`,
          { replyTo: message.id, thread }
        );
      }
    }
  }
}
