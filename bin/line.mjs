#!/usr/bin/env node
// line — your coding agents and your teammates' agents, talking over a tiny relay.
//
//   line new --relay https://root-line.<you>.workers.dev   make a line; prints the invite
//   line join '<invite>' --as nitin                          this machine joins it
//   line setup [project] [--name n] [--no-wake]              put that project's Claude Code on it
//   line remove [project]                                    take it off again
//   line status                                              who is on the line
//   line send <to> <text> [--file path]…                     send from the terminal
//
// Internal (called by Claude Code): `mcp`, `hook`, `wait` with --agent <name>.

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
  if (!config) throw new LineError("not on a line yet: `line join '<invite>' --as <name>`");
  return config;
}

async function main() {
  switch (command) {
    case "new": {
      if (!opts.relay) throw new LineError("line new --relay https://<your relay>");
      console.log(`${Invite.create(opts.relay)}\n\nShare it privately (it is the line's password). Each person runs:\n  line join '<invite>' --as <name>`);
      return 0;
    }
    case "join": {
      if (!positionals[0] || !opts.as) throw new LineError("line join '<invite>' --as <name>");
      const path = saveConfig(Invite.parse(positionals[0]), opts.as.toLowerCase());
      console.log(`On the line as ${opts.as.toLowerCase()} (${path}).\nNow, in each project whose Claude Code should be on it:  line setup`);
      return 0;
    }
    case "setup": {
      const config = needConfig();
      const { setup } = await import("../lib/setup.mjs");
      const result = setup(positionals[0] || ".", { name: opts.name, wake: !opts["no-wake"], register: !opts["no-register"] });
      console.log(`${basename(resolve(positionals[0] || "."))}: Claude Code joins as ${config.owner}/${result.name}.`);
      console.log(`  hooks: ${result.settings}`);
      console.log(result.registered ? "  MCP server registered (local scope). Restart Claude Code in this project." : `  Register the MCP server yourself:\n    ${result.manual}`);
      return 0;
    }
    case "remove": {
      const { teardown } = await import("../lib/setup.mjs");
      teardown(positionals[0] || ".", { register: !opts["no-register"] });
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
      if (!to || !words.length) throw new LineError("line send <to> <text> [--file path]");
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
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 12).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
      return command ? 1 : 0;
  }
}

// exitCode, not exit(): exiting at once can cut off piped stdout (a hook's JSON) on macOS.
main().then(
  (code) => (process.exitCode = code),
  (error) => {
    process.stderr.write(`line: ${error instanceof LineError ? error.message : error.stack}\n`);
    process.exit(1);
  },
);
