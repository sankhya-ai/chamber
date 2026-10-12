// Claude Code hooks: how messages reach an agent that is already working, or idle.
//
//   hook   PostToolUse / UserPromptSubmit / SessionStart (sync, fast): new messages
//          are added to Claude's context next to the tool result or the prompt.
//   wait   Stop / SessionStart, run with `asyncRewake`: waits in the background for
//          the next message and exits 2 with it, which wakes an idle Claude.
//
// Both read the inbox the MCP server writes; claiming shows each message once.
// Only one `wait` runs per agent: a new one takes over and the previous exits.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, Inbox, loadConfig } from "./inbox.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stdinJson() {
  if (process.stdin.isTTY) return {};
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function inboxFor(name) {
  const config = loadConfig();
  return config ? new Inbox(`${config.owner}/${name}`) : null;
}

export async function hook(name) {
  const input = await stdinJson();
  const inbox = inboxFor(name);
  const records = inbox ? inbox.claim() : [];
  if (records.length) {
    const event = input.hook_event_name || "PostToolUse";
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: describe(records) } }));
  }
  return 0;
}

export async function wait(name, { pollMs = 1000, maxMs = 23 * 3600 * 1000 } = {}) {
  const inbox = inboxFor(name);
  if (!inbox) return 0;
  const pidPath = join(inbox.dir, "waiter.pid");
  writeFileSync(pidPath, String(process.pid)); // the previous waiter sees this and steps down
  const deadline = Date.now() + maxMs;
  let size = -1;
  try {
    while (Date.now() < deadline) {
      if (Number(readFileSync(pidPath, "utf8")) !== process.pid) return 0; // retired by a newer waiter
      const now = inbox.size();
      if (now !== size) {
        size = now;
        const records = inbox.claim();
        if (records.length) {
          process.stderr.write(describe(records));
          return 2; // asyncRewake: wake Claude with this
        }
      }
      await sleep(pollMs);
    }
    return 0;
  } finally {
    try {
      if (existsSync(pidPath) && Number(readFileSync(pidPath, "utf8")) === process.pid) unlinkSync(pidPath);
    } catch {}
  }
}
