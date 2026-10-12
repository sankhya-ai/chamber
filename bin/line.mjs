#!/usr/bin/env node
// root-line — your coding agents and your teammates' agents, talking over a tiny relay.
//
//   root-line invite                  the one command a teammate runs to join (copy it to them)
//   root-line setup                   put the Claude Code of the project you are in on the line
//   root-line status                  who is on the line
//   root-line send <to> <text>        send from the terminal (--file path to attach)
//   root-line remove                  take this project's Claude Code off the line
//
//   root-line new --relay <url>       make a new line (once, after deploying the relay)
//   root-line join <invite> [--as n]  join a line (the install command does this for you)
//
// Internal (called by Claude Code): `mcp`, `hook`, `wait` with --agent <name>.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";

import { LineClient } from "../lib/client.mjs";
import { Inbox, loadConfig, saveConfig } from "../lib/inbox.mjs";
import { Invite, LineError } from "../lib/protocol.mjs";

const [command, ...rest] = process.argv.slice(2);
const { values: opts, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    relay: { type: "string" },
    as: { type: "string" },
    name: { type: "string" },
    agent: { type: "string" },
    file: { type: "string", multiple: true },
    "no-wake": { type: "boolean" },
    "no-register": { type: "boolean" },
  },
});

function needConfig() {
  const config = loadConfig();
  if (!config) throw new LineError("not on a line yet: run the install command your teammate sent you");
  return config;
}

/** Your name on the line: --as, else your git name, else your login. */
function defaultOwner() {
  let name = "";
  try {
    name = execFileSync("git", ["config", "--global", "user.name"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\s+/)[0];
  } catch {}
  return (name || process.env.USER || "me").toLowerCase().replace(/[^a-z0-9._-]+/g, "").replace(/^[^a-z0-9]+/, "").slice(0, 32) || "me";
}

function installCommand(invite) {
  return `curl -fsSL ${invite.relay}/install | sh -s -- ${invite.secret}`;
}

async function main() {
  switch (command) {
    case "new": {
      if (!opts.relay) throw new LineError("root-line new --relay https://<your relay>");
      const invite = Invite.create(opts.relay);
      const owner = (opts.as || defaultOwner()).toLowerCase();
      saveConfig(invite, owner);
      console.log(`New line on ${invite.relay}; you are on it as ${owner}.\n\nSend each teammate this one command, privately (it holds the line's key):\n\n  ${installCommand(invite)}\n\nThen, in each of your projects:  root-line setup`);
      return 0;
    }
    case "join": {
      if (!positionals[0]) throw new LineError("root-line join <invite> [--as <name>]");
      const owner = (opts.as || defaultOwner()).toLowerCase();
      saveConfig(Invite.parse(positionals[0]), owner);
      console.log(`You are on the line as ${owner}${opts.as ? "" : " (change it with --as <name>)"}.`);
      return 0;
    }
    case "invite": {
      console.log(`Send this to a teammate, privately (it holds the line's key). They run it inside their project:\n\n  ${installCommand(needConfig().invite)}`);
      return 0;
    }
    case "setup": {
      const config = needConfig();
      const { setup } = await import("../lib/setup.mjs");
      const register = !opts["no-register"] && !process.env.ROOT_LINE_NO_REGISTER;
      const result = setup(positionals[0] || ".", { name: opts.name, wake: !opts["no-wake"], register });
      console.log(`${basename(resolve(positionals[0] || "."))}: its Claude Code is on the line as ${config.owner}/${result.name}.`);
      if (result.registered || !register) console.log("Restart Claude Code in this project to connect.");
      else console.log(`Could not run the claude command; register the MCP server yourself, then restart Claude Code:\n  ${result.manual}`);
      return 0;
    }
    case "remove": {
      const { teardown } = await import("../lib/setup.mjs");
      teardown(positionals[0] || ".", { register: !opts["no-register"] && !process.env.ROOT_LINE_NO_REGISTER });
      console.log("Removed the line from this project's Claude Code.");
      return 0;
    }
    case "status": {
      const { invite, owner } = needConfig();
      await invite.ready();
      const response = await fetch(`${invite.relay}/v1/lines/${invite.lineId}/roster`, { headers: invite.auth });
      if (!response.ok) throw new LineError(`relay answered ${response.status}`);
      console.log(`${owner} on ${invite.relay}`);
      for (const a of (await response.json()).agents) console.log(`  ${a.agent.padEnd(36)} ${a.kind.padEnd(12)} ${a.answers ? "answers" : ""}`);
      return 0;
    }
    case "send": {
      const { invite, owner } = needConfig();
      const [to, ...words] = positionals;
      if (!to || !words.length) throw new LineError("root-line send <to> <text> [--file path]");
      const client = new LineClient(invite, `${owner}/terminal`, { kind: "terminal" });
      client.run();
      const files = (opts.file || []).map((path) => ({ name: basename(path), data: new Uint8Array(readFileSync(path)) }));
      const receipt = await client.send(to, words.join(" "), { files });
      console.log(receipt.held ? `Held for ${to} until they come online.` : `Delivered to ${receipt.delivered.join(", ")}.`);
      client.close();
      return 0;
    }
    case "mcp": {
      const { serve } = await import("../lib/mcp.mjs");
      return serve(opts.agent || "claude-code");
    }
    case "hook": {
      const { hook } = await import("../lib/hooks.mjs");
      return hook(opts.agent || "claude-code");
    }
    case "wait": {
      const { wait } = await import("../lib/hooks.mjs");
      return wait(opts.agent || "claude-code");
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 13).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
      return command ? 1 : 0;
  }
}

// exitCode, not exit(): exiting at once can cut off piped stdout (a hook's JSON) on macOS.
main().then(
  (code) => (process.exitCode = code),
  (error) => {
    process.stderr.write(`root-line: ${error instanceof LineError ? error.message : error.stack}\n`);
    process.exit(1);
  },
);
