// Automated Cloudflare Relay deployment for Chamber admins
import { execFile, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { issuePass, newAdminKey } from "./admin.mjs";
import { HOME, markAdmin, saveConfig } from "./inbox.mjs";
import { Invite, LineError } from "./protocol.mjs";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const RELAY_DIR = join(ROOT, "relay");

// Wrangler ships inside the app (relay/node_modules) and runs on the app's own Node, so an admin needs
// nothing installed. Run from a clone, it is installed once, the first time a chamber is created.
const WRANGLER = join(RELAY_DIR, "node_modules", "wrangler", "bin", "wrangler.js");

function wranglerCommand(args) {
  if (!existsSync(WRANGLER)) {
    // npm is a .cmd file on Windows, which Node only runs through a shell.
    execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--silent", "--no-audit", "--no-fund"], { cwd: RELAY_DIR, stdio: "ignore", shell: process.platform === "win32" });
  }
  return [process.execPath, [WRANGLER, ...args]];
}

function runWrangler(args, options = {}) {
  const [cmd, fullArgs] = wranglerCommand(args);
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

/** Launch Cloudflare OAuth login in the user's browser, and say why if it does not finish. */
export function loginCloudflare() {
  return new Promise((resolve, reject) => {
    const [cmd, fullArgs] = wranglerCommand(["login"]);
    const child = spawn(cmd, fullArgs, { cwd: RELAY_DIR, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => (output = (output + chunk).slice(-600)));
    child.on("close", (code) => {
      if (code === 0) return resolve(true);
      const detail = output.replace(/\x1b\[[0-9;]*m/g, "").trim().split("\n").filter(Boolean).slice(-2).join(" ");
      reject(new LineError(`Cloudflare sign-in didn't finish${detail ? ` (${detail})` : ""}. Finish signing in in the browser window that opens, then try again.`));
    });
    child.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Auto-register a workers.dev subdomain for new Cloudflare accounts
// ---------------------------------------------------------------------------

/**
 * Read the Cloudflare auth token that `wrangler login` stored, or from env.
 * Wrangler v3+ uses OAuth and writes a TOML config to an OS-specific path.
 */
function readWranglerAuthToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;

  const home = homedir();
  const paths = [];
  if (process.env.WRANGLER_HOME) paths.push(join(process.env.WRANGLER_HOME, "config", "default.toml"));
  // macOS: ~/Library/Preferences/.wrangler/config/default.toml
  if (process.platform === "darwin") paths.push(join(home, "Library", "Preferences", ".wrangler", "config", "default.toml"));
  // XDG (Linux, macOS fallback): ~/.config/.wrangler/config/default.toml
  paths.push(join(process.env.XDG_CONFIG_HOME || join(home, ".config"), ".wrangler", "config", "default.toml"));
  // Windows: %APPDATA%/.wrangler/config/default.toml
  if (process.platform === "win32" && process.env.APPDATA) paths.push(join(process.env.APPDATA, ".wrangler", "config", "default.toml"));
  paths.push(join(home, ".wrangler", "config", "default.toml"));

  for (const p of paths) {
    try {
      const text = readFileSync(p, "utf8");
      const m = text.match(/(?:oauth_token|access_token)\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    } catch {}
  }
  return null;
}

/** Extract the first Cloudflare account ID from `wrangler whoami` output. */
function extractAccountId(whoamiOutput) {
  const m = whoamiOutput.match(/│\s+[^│]+?\s+│\s+([a-f0-9]{32})\s+│/);
  return m?.[1] ?? null;
}

/**
 * Make sure the Cloudflare account has a workers.dev subdomain registered.
 * New free-plan accounts need this before the first Worker can be deployed.
 * Fully automated: picks a name from the OS username + random hex, registers
 * it via the Cloudflare API using the wrangler OAuth token that was already
 * stored during `wrangler login`.
 *
 * Best-effort: returns silently on any failure (the deploy step has its own
 * clear error handling as a fallback).
 */
async function ensureWorkersSubdomain(onProgress) {
  let token, accountId;
  try {
    token = readWranglerAuthToken();
    if (!token) return;
    accountId = extractAccountId(runWrangler(["whoami"]));
    if (!accountId) return;
  } catch { return; }

  // Check if a subdomain is already registered
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.result?.subdomain) return; // already have one
    }
  } catch { return; }

  // Generate a name: os-username + short random hex
  let username = "";
  try { username = userInfo().username.toLowerCase().replace(/[^a-z0-9-]/g, ""); } catch {}
  let name = username
    ? `${username}-${randomBytes(2).toString("hex")}`
    : `chamber-${randomBytes(3).toString("hex")}`;

  onProgress?.(`Registering ${name}.workers.dev for your account…`);

  // Try to register, retry once with a fully random name if taken
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ subdomain: name }),
      });
      if (res.ok) return; // success
      // Name was taken or some other conflict — retry with a random name
      name = `chamber-${randomBytes(4).toString("hex")}`;
    } catch { return; }
  }
  // If both attempts failed, fall through silently — deploy will show a clear error
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

  // New Cloudflare accounts need a workers.dev subdomain before the first deploy.
  // Wrangler prompts interactively in a terminal, but the desktop app has no TTY.
  // Auto-register one via the Cloudflare API so users never have to visit the dashboard.
  await ensureWorkersSubdomain(onProgress);

  onProgress("3/5 Deploying relay worker to Cloudflare Edge…");
  let deployOutput;
  try {
    deployOutput = runWrangler(["deploy"]);
  } catch (deployErr) {
    const stderr = (deployErr.stderr || deployErr.message || "").toString();
    // New Cloudflare accounts need a workers.dev subdomain registered before the first deploy.
    // Wrangler prompts interactively in a terminal, but in programmatic mode it just fails.
    // Extract the onboarding URL from the error so users know exactly where to go.
    if (/workers\.dev subdomain/i.test(stderr) || /register a workers\.dev/i.test(stderr)) {
      const onboardingUrl = stderr.match(/https:\/\/dash\.cloudflare\.com\/[^\s\x1b\]]+\/workers\/onboarding/)?.[0];
      throw new LineError(
        `Your Cloudflare account needs a workers.dev subdomain before Chamber can deploy.\n\n` +
        `Open ${onboardingUrl || "https://dash.cloudflare.com → Workers & Pages"} in your browser, ` +
        `pick a subdomain (e.g. yourname.workers.dev), then try again.`
      );
    }
    // Strip ANSI codes from any other Wrangler error so the UI stays clean
    const clean = stderr.replace(/\x1b\[[0-9;]*m/g, "").trim();
    throw new LineError(`Relay deployment failed:\n${clean || deployErr.message}`);
  }
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
  // No project (an app opened from Finder): workspaces are added later, in the app.
  const targetProject = projectPath ? resolve(projectPath) : null;
  try {
    if (!targetProject) throw new Error("no project");
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
