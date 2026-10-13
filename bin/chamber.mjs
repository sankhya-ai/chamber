#!/usr/bin/env node
// chamber — your coding agents and your teammates' agents, talking over a tiny relay.
//
//   chamber board                   open the board: every conversation your agents are in
//   chamber invite                  (admin) a personal join command for one teammate
//   chamber members                 who is in the chamber
//   chamber memory [path]           read the team's memory (MEMORY.md)
//   chamber dream                   tidy the team's memory now (needs OPENROUTER_API_KEY)
//   chamber revoke <name>           (admin) remove a teammate
//   chamber setup                   put the project you are in in the chamber: its Claude Code, Codex,
//                                   Antigravity, and your DeepSeek Harness (--harness codex,… to choose)
//   chamber status                  who is in the chamber
//   chamber send <to> <text>        send from the terminal (--file path, --reply-to <id> to answer)
//   chamber listen                  wait for the next message to you and print it (--timeout seconds)
//   chamber remove                  take this project's Claude Code out of the chamber
//   chamber name [new]              your name in the chamber (teammates reach you as @name)
//
//   chamber new --relay <url>       make a new chamber (once, after deploying the relay)
//   chamber join <invite> [--as n]  join a chamber (the install command does this for you)
//
// Internal (called by Claude Code): `mcp`, `hook`, `wait` with --agent <name>.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";

import { LineClient } from "../lib/client.mjs";
import { Inbox, isAdmin, loadConfig, markAdmin, NOT_A_NAME, rename, saveConfig } from "../lib/inbox.mjs";
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
    "reply-to": { type: "string" },
    port: { type: "string" },
    "no-open": { type: "boolean" },
    format: { type: "string" },
    event: { type: "string" },
    harness: { type: "string" },
    timeout: { type: "string" },
  },
});

function needConfig() {
  const config = loadConfig();
  if (!config) throw new LineError("not in a chamber yet: run the install command your teammate sent you");
  return config;
}

/** Your name in the chamber when you give none: your git first name, else your login, never an account name. */
function defaultOwner() {
  let git = "";
  try {
    git = execFileSync("git", ["config", "--global", "user.name"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\s+/)[0];
  } catch {}
  for (const guess of [git, process.env.USER || ""]) {
    const name = guess.toLowerCase().replace(/[^a-z0-9._-]+/g, "").replace(/^[^a-z0-9]+/, "").slice(0, 32);
    if (name && !NOT_A_NAME.has(name)) return name;
  }
  return `member-${[...crypto.getRandomValues(new Uint8Array(2))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function installCommand(invite) {
  return `curl -fsSL ${invite.relay}/install | sh -s -- ${invite.secret}`;
}

async function main() {
  switch (command) {
    case "new": {
      if (!opts.relay) throw new LineError("chamber new --relay https://<your relay>");
      const invite = Invite.create(opts.relay);
      const owner = (opts.as || defaultOwner()).toLowerCase();
      saveConfig(invite, owner);
      markAdmin(invite);
      console.log(`New chamber on ${invite.relay}; you are on it as ${owner}.\n\nSend each teammate this one command, privately (it holds the chamber's key):\n\n  ${installCommand(invite)}\n\nThen, in each of your projects:  chamber setup`);
      return 0;
    }
    case "join": {
      if (!positionals[0]) throw new LineError("chamber join <invite> [--as <name>]");
      const owner = (opts.as || defaultOwner()).toLowerCase();
      saveConfig(Invite.parse(positionals[0]), owner);
      console.log(`You are in the chamber as ${owner}${opts.as ? "" : " (change it anytime: chamber name <new>)"}.`);
      return 0;
    }
    case "name": {
      if (!positionals[0]) {
        console.log(needConfig().owner);
        return 0;
      }
      const old = rename(positionals[0]);
      const now = needConfig().owner;
      console.log(old === now ? `Already ${now}.` : `You are now ${now} in the chamber (was ${old}). Restart Claude Code and the board to use it.`);
      return 0;
    }
    case "invite": {
      if (!isAdmin(needConfig())) throw new LineError("only your chamber's admin invites people: ask them for the join command");
      const { inviteCommand } = await import("../lib/admin.mjs");
      console.log(`Send this to one teammate, privately (it is their personal key to the chamber). They run it inside their project:\n\n  ${await inviteCommand(needConfig())}`);
      return 0;
    }
    case "dream": {
      const { dream } = await import("../lib/dream.mjs");
      const result = await dream(needConfig(), { log: (kind, text) => console.log(`  ${kind === "write" ? "✎" : "·"} ${text}`) });
      console.log(result.ok ? `Dreamt: ${result.message} (${result.changes.length} file(s) changed, ${result.steps} steps)` : `No dream: ${result.reason}`);
      return result.ok ? 0 : 1;
    }
    case "memory": {
      const { TeamMemory, ENTRY } = await import("../lib/memory.mjs");
      const config = needConfig();
      const file = await new TeamMemory(config.invite, `${config.owner}/terminal`).read(positionals[0] || ENTRY);
      console.log(file?.text ?? "(empty)");
      return 0;
    }
    case "members": {
      const { listMembers } = await import("../lib/admin.mjs");
      const { personal, members } = await listMembers(needConfig());
      if (!personal) console.log("This chamber has no personal invites: anyone with the key may join (create.sh adds them).");
      for (const m of members) console.log(`  ${(m.online ? "●" : "○")} ${m.owner}`);
      return 0;
    }
    case "revoke": {
      if (!isAdmin(needConfig())) throw new LineError("only your chamber's admin removes people");
      if (!positionals[0]) throw new LineError("chamber revoke <name>");
      const { revoke } = await import("../lib/admin.mjs");
      await revoke(needConfig(), positionals[0]);
      console.log(`Removed ${positionals[0].toLowerCase()}: their invite no longer works.`);
      return 0;
    }
    case "setup": {
      const config = needConfig();
      const { setup } = await import("../lib/setup.mjs");
      const register = !opts["no-register"] && !process.env.CHAMBER_NO_REGISTER;
      const harnesses = opts.harness ? opts.harness.split(",").map((h) => h.trim()).filter(Boolean) : null;
      const result = setup(positionals[0] || ".", { name: opts.name, wake: !opts["no-wake"], register, harnesses });
      const LABEL = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity", dsh: "DeepSeek Harness (for you, in every project)" };
      console.log(`${basename(resolve(positionals[0] || "."))}: in the chamber now:`);
      for (const h of result.harnesses) console.log(`  ${LABEL[h.harness]}  as ${config.owner}/${h.agent}`);
      if (result.registered || !register) console.log("Restart them in this project to connect.");
      else console.log(`Could not run the claude command; register the MCP server yourself, then restart Claude Code:\n  ${result.manual}`);
      return 0;
    }
    case "remove": {
      const { teardown } = await import("../lib/setup.mjs");
      teardown(positionals[0] || ".", { register: !opts["no-register"] && !process.env.CHAMBER_NO_REGISTER, name: opts.name });
      console.log("Took this project's agents out of the chamber.");
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
      if (!to || !words.length) throw new LineError("chamber send <to> <text> [--file path]");
      // --agent: send as one of your agents (e.g. claude-code.api) so replies reach it, not the terminal.
      const client = new LineClient(invite, `${owner}/${opts.agent || "terminal"}`, { kind: opts.agent ? "claude-code" : "terminal" });
      client.run();
      const files = (opts.file || []).map((path) => ({ name: basename(path), data: new Uint8Array(readFileSync(path)) }));
      const text = words.join(" ");
      const inbox = new Inbox(client.agent);
      const original = opts["reply-to"] ? inbox.find(opts["reply-to"]) : null;
      if (opts["reply-to"] && !original) throw new LineError(`no message ${opts["reply-to"]} in this agent's inbox`);
      const title = original ? original.title : text.split("\n")[0].slice(0, 80);
      const thread = original ? original.thread || original.id : null;
      const receipt = await client.send(to, text, { files, title, thread, replyTo: original?.id ?? null });
      inbox.sent(receipt, { to, text, title, files, replyTo: original?.id ?? null });
      console.log(receipt.held ? `Held for ${to} until they come online.` : `Delivered to ${receipt.delivered.join(", ")}.`);
      client.close();
      return 0;
    }
    case "board": {
      const { serveBoard } = await import("../lib/server.mjs");
      return serveBoard(needConfig(), { port: Number(opts.port || 7878), open: !opts["no-open"] });
    }
    case "listen": {
      // For an agent driven from a terminal: connect, print the next message to it (JSON), leave.
      // What arrived while it was away comes first (the relay held it).
      const { invite, owner } = needConfig();
      const agent = `${owner}/${opts.agent || "terminal"}`;
      const inbox = new Inbox(agent);
      const fresh = inbox.claim();
      if (!fresh.length) {
        const arrived = new Promise((resolve) => {
          const client = new LineClient(invite, agent, { kind: opts.agent ? "claude-code" : "terminal", answers: true, cursorPath: inbox.cursorPath, onMessage: (m) => resolve([client, inbox.add(m)]) });
          client.run();
          setTimeout(() => resolve([client, null]), Number(opts.timeout || 120) * 1000);
        });
        const [client, record] = await arrived;
        client.close();
        if (record) fresh.push(...inbox.claim());
      }
      if (!fresh.length) {
        console.log("{}");
        return 1;
      }
      for (const record of fresh) console.log(JSON.stringify(record));
      return 0;
    }
    case "mcp": {
      const { serve } = await import("../lib/mcp.mjs");
      return serve(opts.agent || "claude-code");
    }
    case "hook": {
      const { hook } = await import("../lib/hooks.mjs");
      return hook(opts.agent || "claude-code", { format: opts.format || "claude", event: opts.event || "" });
    }
    case "wait": {
      const { wait } = await import("../lib/hooks.mjs");
      return wait(opts.agent || "claude-code");
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 20).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
      return command ? 1 : 0;
  }
}

// exitCode, not exit(): exiting at once can cut off piped stdout (a hook's JSON) on macOS.
main().then(
  (code) => (process.exitCode = code),
  (error) => {
    process.stderr.write(`chamber: ${error instanceof LineError ? error.message : error.stack}\n`);
    process.exit(1);
  },
);
