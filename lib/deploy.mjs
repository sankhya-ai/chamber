// Automated Cloudflare Relay deployment for Chamber admins
import { execFile, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { issuePass, newAdminKey } from "./admin.mjs";
import { HOME, markAdmin, saveConfig } from "./inbox.mjs";
import { Invite, LineError } from "./protocol.mjs";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const RELAY_DIR = join(ROOT, "relay");

function getWranglerBin() {
  const localWrangler = join(RELAY_DIR, "node_modules", ".bin", "wrangler");
  if (existsSync(localWrangler)) return localWrangler;
  return "npx";
}

function runWrangler(args, options = {}) {
  const bin = getWranglerBin();
  const cmd = bin === "npx" ? "npx" : bin;
  const fullArgs = bin === "npx" ? ["wrangler", ...args] : args;
  return execFileSync(cmd, fullArgs, {
    cwd: RELAY_DIR,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
}

/** Check if the developer is already logged in to Cloudflare. */
export async function checkCloudflareAuth() {
  try {
    const output = runWrangler(["whoami"]);
    const authed = !output.toLowerCase().includes("not authenticated") && output.includes("Account Name");
    const accountMatch = output.match(/│\s+([^│\n]+?)\s+│\s+[a-f0-9]{32}\s+│/);
    return { authenticated: authed, account: accountMatch ? accountMatch[1].trim() : "Cloudflare Account" };
  } catch (err) {
    return { authenticated: false, account: null };
  }
}

/** Launch Cloudflare OAuth login in user's browser. */
export function loginCloudflare() {
  return new Promise((resolve, reject) => {
    const bin = getWranglerBin();
    const cmd = bin === "npx" ? "npx" : bin;
    const fullArgs = bin === "npx" ? ["wrangler", "login"] : ["login"];
    const child = spawn(cmd, fullArgs, { cwd: RELAY_DIR, stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) resolve(true);
      else reject(new LineError(`Cloudflare login exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

/**
 * Deploy the Cloudflare relay worker, provision R2 if available, lock the relay with admin
 * keys, and initialize the chamber on this machine.
 */
export async function deployRelay({ owner = "admin", projectPath = null, onProgress = () => {} } = {}) {
  onProgress("1/5 Checking Cloudflare authentication…");
  const auth = await checkCloudflareAuth();
  if (!auth.authenticated) {
    onProgress("Cloudflare login required: opening browser window…");
    await loginCloudflare();
  }

  onProgress("2/5 Configuring storage for attachments…");
  try {
    const list = runWrangler(["r2", "bucket", "list"]);
    if (!list.includes("chamber-blobs")) {
      runWrangler(["r2", "bucket", "create", "chamber-blobs"]);
    }
    try {
      runWrangler(["r2", "bucket", "lifecycle", "add", "chamber-blobs", "expire-week", '""', "--expire-days", "7", "--force"]);
    } catch {}
  } catch (e) {
    // If R2 is not enabled on account, gracefully proceed without R2 (files under 64KB work in memory/SQLite)
    onProgress("Note: R2 bucket not enabled on this account. Continuing with SQLite blob fallback.");
  }

  onProgress("3/5 Deploying relay worker to Cloudflare Edge…");
  const deployOutput = runWrangler(["deploy"]);
  const relayMatch = deployOutput.match(/https:\/\/[a-zA-Z0-9.-]+\.workers\.dev/);
  if (!relayMatch) {
    throw new LineError(`Relay deployment did not return a workers.dev URL:\n${deployOutput}`);
  }
  const relayUrl = relayMatch[0];

  onProgress(`4/5 Generating cryptographic keys for ${relayUrl}…`);
  const secret = randomBytes(32).toString("base64url");
  const invite = await new Invite(relayUrl, secret).ready();
  const lineId = invite.lineId;
  const adminKey = newAdminKey();
  const adminPass = issuePass(adminKey.private, lineId);

  // Bind secrets so relay is private to this chamber only
  onProgress("Locking relay with cryptographic admin pass…");
  runWrangler(["secret", "put", "ALLOWED_LINES"], { input: lineId });
  runWrangler(["secret", "put", "ADMIN_KEY"], { input: adminKey.public });

  onProgress("5/5 Finalizing local Chamber configuration…");
  mkdirSync(HOME, { recursive: true });
  const configuredInvite = invite.withPass(adminPass);
  saveConfig(configuredInvite, owner);
  markAdmin(configuredInvite, { adminPublic: adminKey.public, adminPrivate: adminKey.private });

  // Install default workflows and setup project workspace if given
  const targetProject = projectPath ? resolve(projectPath) : resolve(".");
  try {
    const { installDefaultWorkflows } = await import("./runner.mjs");
    await installDefaultWorkflows(resolve(targetProject, ".chamber", "workflows"), adminKey.private, lineId);
  } catch {}

  if (targetProject && existsSync(targetProject)) {
    try {
      const { setup } = await import("./setup.mjs");
      setup(targetProject, { register: true });
    } catch {}
  }

  const joinCmd = `curl -fsSL ${relayUrl}/install | sh -s -- ${secret}~${adminPass}`;
  return {
    ok: true,
    relay: relayUrl,
    lineId,
    owner,
    adminPublic: adminKey.public,
    adminPass,
    inviteCommand: joinCmd,
  };
}
