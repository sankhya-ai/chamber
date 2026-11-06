#!/usr/bin/env node
// chamber — your coding agents and your teammates' agents, talking over a tiny relay.
//
//   chamber app                     open the Chamber app; on a Mac, install it first if it's missing
//                                   (signed and notarized, checked before installing; --no-open)
//   chamber deploy                  (admin) deploy Cloudflare relay & initialize chamber (--device: sign in
//                                   to Cloudflare with a code, from any browser)
//   chamber start                   open Chamber (create or join a chamber the first time); any day: updates, connects the project
//                                   you are in, and opens the board (--no-board, --no-update)
//   chamber board                   open the board: every conversation your agents are in
//   chamber invite [name]           (admin) a message for one teammate to paste into Claude Code or
//                                   Codex: their agent sets Chamber up from a one-time join link
//                                   (--days 1-7, default 3; --format link|code for just the link or code)
//   chamber members                 who is in the chamber
//   chamber memory [path]           read the team's memory (MEMORY.md)
//   chamber standup                 what every agent did and is doing, from their desks (--post to send it
//                                   to #general or --channel; --daily 10:00 to have this machine's app post it
//                                   every day, --daily off to stop)
//   chamber decisions               the decision ledger: what agents proposed, what humans approved
//   chamber decide <id> <approve|reject> [--reason …]  (human) rule on a proposed decision
//   chamber dream                   tidy the team's memory now (needs OPENROUTER_API_KEY)
//   chamber revoke <name>           (admin) remove a teammate
//   chamber doctor                  is this machine ready: Node, PATH, the chamber, membership, each
//                                   connected project (what an agent setting chamber up checks last)
//   chamber setup                   put the project you are in in the chamber: its Claude Code, Codex,
//                                   Antigravity, and your DeepSeek Harness (--harness codex,… to choose)
//   chamber status                  who is in the chamber
//   chamber send <to> <text>        send from the terminal (--file path, --reply-to <id> to answer)
//   chamber search <query>          search talks, memory, contracts, incidents (--channel, --type)
//   chamber away [--status text]    autonomous away responder when you are in meetings
//   chamber runner                  headless workflow and gate runner daemon
//   chamber workflow sign <file>    (admin) cryptographically sign a workflow file
//   chamber gate [list|approve|reject] manage approval gates
//   chamber listen                  wait for the next message to you and print it (--timeout seconds)
//   chamber remove                  take this project's Claude Code out of the chamber
//   chamber logout                  leave this chamber on this machine (chamber start joins or creates again)
//   chamber name [new]              your name in the chamber (teammates reach you as @name)
//
//   chamber new --relay <url>       make a new chamber (once, after deploying the relay)
//   chamber join <invite> [--as n]  join a chamber (the install command does this for you)
//
// Internal (called by Claude Code): `mcp`, `hook`, `wait` with --agent <name>.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { LineClient } from "../lib/client.mjs";
import { activeChamber, HOME, homeFor, Inbox, isAdmin, listChambers, loadConfig, logout, markAdmin, newChamberHome, NOT_A_NAME, rename, ROOT, saveConfig, setActiveChamber, useChamber } from "../lib/inbox.mjs";
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
    restore: { type: "boolean" },
    "no-setup": { type: "boolean" },
    "reply-to": { type: "string" },
    port: { type: "string" },
    "no-open": { type: "boolean" },
    "no-board": { type: "boolean" },
    "no-update": { type: "boolean" },
    format: { type: "string" },
    event: { type: "string" },
    harness: { type: "string" },
    timeout: { type: "string" },
    channel: { type: "string" },
    type: { type: "string" },
    status: { type: "string" },
    token: { type: "string" },
    reason: { type: "string" },
    "chamber-hook": { type: "boolean" },
    home: { type: "string" },
    chamber: { type: "string" },
    "no-files": { type: "boolean" },
    post: { type: "boolean" },
    daily: { type: "string" },
    days: { type: "string" },
    device: { type: "boolean" },
  },
});

// Which chamber this command is for: the one it names (--home, as agents' commands do), else an
// agent's command from before there were several is for the first, else the one picked last.
useChamber(opts.home ? resolve(opts.home) : opts.agent && !["setup", "remove"].includes(command) ? ROOT : activeChamber());

/** A chamber being created gets a folder of its own when this machine is in one already. */
function startNewChamber() {
  return opts.home ? HOME : useChamber(newChamberHome());
}

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

const APP = resolve(fileURLToPath(import.meta.url), "../..");

/**
 * Bring the installed client up to what the relay serves (it bundles the client it was deployed
 * with). Returns the files that changed, or null when there is nothing to update from: a
 * checkout of the repository (git pull updates that) or a relay too old to list its files.
 */
async function update(relay) {
  let installed = null;
  try {
    installed = realpathSync(join(ROOT, "app"));
  } catch {}
  if (realpathSync(APP) !== installed) return null;
  const list = await fetch(`${relay}/client/files`).catch(() => null);
  if (!list?.ok) return null;
  const files = (await list.text()).split("\n").filter((f) => f && !f.startsWith("/") && !f.split("/").includes(".."));
  const fresh = await Promise.all(
    files.map(async (file) => {
      const response = await fetch(`${relay}/client/${file}`);
      if (!response.ok) throw new LineError(`could not update ${file}: the relay answered ${response.status}`);
      return [file, await response.text()];
    }),
  );
  const changed = fresh.filter(([file, text]) => {
    try {
      return readFileSync(join(APP, file), "utf8") !== text;
    } catch {
      return true;
    }
  });
  for (const [file, text] of changed) {
    mkdirSync(dirname(join(APP, file)), { recursive: true });
    writeFileSync(join(APP, file), text);
  }
  return changed.map(([file]) => file);
}

function gitTop() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

async function main() {
  switch (command) {
    case "deploy": {
      const { deployRelay } = await import("../lib/deploy.mjs");
      const owner = (opts.as || opts.name || defaultOwner()).toLowerCase();
      console.log(`Setting up Chamber Relay on Cloudflare for @${owner}...`);
      startNewChamber();
      const res = await deployRelay({
        owner,
        name: opts.chamber,
        projectPath: positionals[0] ? resolve(positionals[0]) : null,
        storage: !opts["no-files"],
        device: Boolean(opts.device),
        onProgress: (msg) => console.log(msg),
      });
      setActiveChamber(HOME);
      console.log(`\n\x1b[1;32m✔ Chamber deployed and initialized!\x1b[0m`);
      console.log(`Relay: ${res.relay}`);
      console.log(`You are the admin: @${res.owner}`);
      console.log(`\nTo invite a teammate (a message they paste into Claude Code or Codex):`);
      console.log(`  \x1b[1mchamber invite <their name>\x1b[0m`);
      console.log(`\nTo open the desktop app:`);
      console.log(`  \x1b[1mchamber desktop\x1b[0m`);
      return 0;
    }
    case "new": {
      if (!opts.relay) throw new LineError("chamber new --relay https://<your relay>   (or --relay cloud for Chamber Cloud)");
      const { claimRelay } = await import("../lib/admin.mjs");
      // "cloud": Chamber Cloud, the hosted relay (no Cloudflare account; a 7-day trial, then a seat per teammate).
      const relay = opts.relay === "cloud" ? (await import("../lib/server.mjs")).CHAMBER_CLOUD_RELAY : opts.relay;
      const invite = await Invite.create(relay).ready();
      const owner = (opts.as || defaultOwner()).toLowerCase();
      // A relay from the Deploy button is unclaimed: the first chamber made on it claims it
      // (its admin key, this chamber only). A relay set up by create.sh is already private.
      const claimed = await claimRelay(invite);
      startNewChamber();
      saveConfig(claimed.pass ? invite.withPass(claimed.pass) : invite, owner, opts.chamber);
      markAdmin(invite, claimed.key ? { adminPublic: claimed.key.public, adminPrivate: claimed.key.private } : {});
      setActiveChamber(HOME);
      console.log(`New chamber on ${invite.relay}; you are its admin, as ${owner}.${claimed.pass ? " The relay is now private to it." : ""}`);
      console.log("\nInvite each teammate with their own command:  chamber invite   (or Invite on the board)");
      if (!opts["no-setup"]) {
        const { setup } = await import("../lib/setup.mjs");
        const register = !opts["no-register"] && !process.env.CHAMBER_NO_REGISTER;
        const project = setup(".", { register });
        console.log(`\n${basename(resolve("."))}: in the chamber now: ${project.harnesses.map((h) => h.agent).join(", ")}. Restart them here to connect.`);
      }
      try {
        const { installDefaultWorkflows } = await import("../lib/runner.mjs");
        await installDefaultWorkflows(resolve(".chamber", "workflows"), claimed.key?.private || null, invite.lineId);
      } catch {}
      return 0;
    }
    case "start": {
      // Rejoining is this, not the install command again: your key and name are kept in
      // ~/.chamber, so all that can be stale is the client, the project's setup, and the board.
      const config = loadConfig();
      if (!config) {
        // Not in a chamber yet: open the app on its create-or-join screen.
        const { serveBoard } = await import("../lib/server.mjs");
        return serveBoard(null, { port: Number(opts.port || 7878), open: !opts["no-open"] });
      }
      if (!opts["no-update"]) {
        const changed = await update(config.invite.relay);
        if (changed?.length) {
          console.log(`Updated chamber (${changed.length} file${changed.length === 1 ? "" : "s"}).`);
          // The rest runs on the new code.
          const again = spawnSync(process.execPath, [join(APP, "bin", "chamber.mjs"), "start", "--no-update", ...rest], { stdio: "inherit" });
          return again.status ?? 1;
        }
      }
      console.log(`You are ${config.owner} on ${config.invite.relay}.`);
      const project = positionals[0] ? resolve(positionals[0]) : gitTop();
      if (project) {
        const { setup } = await import("../lib/setup.mjs");
        const register = !opts["no-register"] && !process.env.CHAMBER_NO_REGISTER;
        const result = setup(project, { register });
        console.log(`${basename(project)}: ${result.harnesses.map((h) => h.agent).join(", ")} connected. Start them there (restart any already open).`);
      } else {
        console.log("Not inside a project: run chamber start in one to connect its coding agents.");
      }
      if (opts["no-board"]) return 0;
      const { serveBoard } = await import("../lib/server.mjs");
      return serveBoard(config, { port: Number(opts.port || 7878), open: !opts["no-open"] });
    }
    case "join": {
      if (!positionals[0]) throw new LineError("chamber join <invite> [--as <name>]");
      // A join link is used up here (once); an invite code or install command works as before.
      const { resolveInvite } = await import("../lib/protocol.mjs");
      const joined = await resolveInvite(positionals.join(" "));
      const invite = joined.invite;
      const owner = (opts.as || joined.name || defaultOwner()).toLowerCase();
      if (!opts.home) useChamber(homeFor(invite));
      saveConfig(invite, owner, opts.chamber || joined.chamber || undefined);
      setActiveChamber(HOME);
      const named = opts.as || joined.name;
      console.log(`You are in ${joined.from ? `${joined.from}'s chamber` : "the chamber"} as ${owner}${named ? "" : " (change it anytime: chamber name <new>)"}.`);
      return 0;
    }
    case "chambers": {
      // Every chamber this machine is in; the one marked * is the one commands use.
      const chambers = listChambers();
      if (!chambers.length) console.log("Not in a chamber yet: run chamber start to create or join one.");
      for (const c of chambers) console.log(`${c.home === HOME ? "*" : " "} ${c.name.padEnd(24)} ${c.relay}  (${c.owner}${c.admin ? ", admin" : ""})  id: ${c.id}`);
      return 0;
    }
    case "switch": {
      const want = positionals.join(" ").trim().toLowerCase();
      const chambers = listChambers();
      const found = chambers.find((c) => c.id === want) || chambers.find((c) => c.name.toLowerCase() === want);
      if (!found) throw new LineError(`chamber switch <name or id>: one of ${chambers.map((c) => c.name).join(", ") || "(none yet)"}`);
      setActiveChamber(found.home);
      console.log(`Now in ${found.name} (${found.relay}). The app switches the next time it opens; agents stay in the chamber their folder was added to.`);
      return 0;
    }
    case "logout": {
      needConfig();
      logout();
      console.log("Logged out. Run chamber start to create or join a chamber.");
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
      const { inviteCode, inviteMessage } = await import("../lib/admin.mjs");
      if (opts.format === "code") {
        console.log(await inviteCode(needConfig()));
        return 0;
      }
      // One message per teammate: they paste it into Claude Code or Codex, which sets Chamber up.
      const days = Math.min(7, Math.max(0.01, Number(opts.days || 3)));
      const { ticket, text } = await inviteMessage(needConfig(), { name: positionals[0] || null, days });
      if (opts.format === "link" && ticket) {
        console.log(ticket.link);
        return 0;
      }
      console.log(`Send this to ${positionals[0] ? `@${positionals[0].toLowerCase()}` : "one teammate"}, privately. ${ticket ? "It works once, for one person." : "It is their personal key to the chamber."}\n\n${text.replace(/^/gm, "  ")}`);
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
    case "standup": {
      const config = needConfig();
      const desk = await import("../lib/desk.mjs");
      if (opts.daily) {
        const set = desk.setStandup(opts.daily, opts.channel || "#general");
        console.log(set ? `This machine's Chamber app posts the standup to ${set.channel} every day at ${set.at} (while it runs).` : "No daily standup from this machine.");
        return 0;
      }
      const { TeamMemory } = await import("../lib/memory.mjs");
      const memory = new TeamMemory(config.invite, `${config.owner}/terminal`);
      let people = [];
      try {
        const { listMembers } = await import("../lib/admin.mjs");
        people = ((await listMembers(config)).members || []).map((m) => m.owner).filter(Boolean);
      } catch {}
      const text = desk.standup(await desk.readDesks(memory), { people });
      console.log(text);
      if (opts.post) {
        const client = new LineClient(config.invite, `${config.owner}/terminal`, { kind: "terminal" });
        client.run();
        const channel = opts.channel || "#general";
        await client.send(channel, text, { title: `Standup, ${new Date().toUTCString().slice(0, 11)}` });
        console.log(`\nPosted to ${channel}.`);
        client.close();
      }
      return 0;
    }
    case "decisions": {
      const config = needConfig();
      const { TeamMemory } = await import("../lib/memory.mjs");
      const { DecisionLedger } = await import("../lib/decisions.mjs");
      const ledger = new DecisionLedger(new TeamMemory(config.invite, `${config.owner}/terminal`), `${config.owner}/terminal`);
      const entries = await ledger.list({ status: opts.status });
      if (!entries.length) {
        console.log("The decision ledger is empty. Agents propose decisions with the chamber decision tools; you approve them here.");
        return 0;
      }
      for (const e of entries) {
        console.log(`- \x1b[1m${e.id}\x1b[0m (${e.status}): ${e.title}`);
        if (e.rationale) console.log(`    rationale: ${e.rationale}`);
        if (e.affects) console.log(`    affects: ${e.affects}`);
        console.log(`    proposed-by: ${e["proposed-by"] ?? "?"} · added: ${e.added ?? "?"}`);
        if (e["decided-by"]) console.log(`    decided-by: ${e["decided-by"]} · ${e["decided-on"] ?? ""}${e.reason ? ` · reason: ${e.reason}` : ""}`);
        if (e.conflicts && e.conflicts !== "none") console.log(`    conflicts: ${e.conflicts}`);
        if (e.supersedes) console.log(`    supersedes: ${e.supersedes}`);
        if (e["superseded-by"]) console.log(`    superseded-by: ${e["superseded-by"]}`);
        for (const r of e.reviews ?? []) console.log(`    review: ${r}`);
      }
      return 0;
    }
    case "decide": {
      const config = needConfig();
      const [id, outcome] = positionals;
      if (!id || !["approve", "reject"].includes(outcome)) throw new LineError("chamber decide <id> <approve|reject> [--reason …]");
      const { TeamMemory } = await import("../lib/memory.mjs");
      const { DecisionLedger } = await import("../lib/decisions.mjs");
      const ledger = new DecisionLedger(new TeamMemory(config.invite, `${config.owner}/terminal`), `${config.owner}/terminal`);
      const entry = await ledger.decide(id, outcome, { by: config.owner, reason: opts.reason || "" });
      console.log(`✔ ${entry.id} ${entry.status}: ${entry.title}`);
      if (outcome === "approve") console.log("Every new agent session now starts with this decision.");
      if (outcome === "approve" && entry.supersedes) console.log(`${entry.supersedes} is now superseded and no longer served to sessions.`);
      return 0;
    }
    case "contracts": {
      const config = needConfig();
      const { TeamMemory } = await import("../lib/memory.mjs");
      const { ContractRegistry } = await import("../lib/contracts.mjs");
      const registry = new ContractRegistry(new TeamMemory(config.invite, `${config.owner}/terminal`), `${config.owner}/terminal`);
      const entries = await registry.list();
      if (!entries.length) {
        console.log("No contracts registered. Agents register the contracts they produce and subscribe to the ones they consume with the chamber contract tool; consumers are notified on every new version.");
        return 0;
      }
      for (const e of entries) {
        console.log(`- \x1b[1m${e.name}\x1b[0m v${e.version}: ${e.title}`);
        if (e.summary) console.log(`    current: ${e.summary}`);
        console.log(`    producer: ${e.producer} · updated: ${e.updated}${e.decision ? ` · decision: ${e.decision}` : ""}`);
        if (!e.consumers.length) console.log("    no consumers subscribed");
        const { consumers } = await registry.status(e.name);
        for (const c of consumers) {
          const last = c.state === "outstanding" && c.lastVersion ? ` (last acked v${c.lastVersion})` : "";
          console.log(`    consumer: ${c.agent} — ${c.state.toUpperCase()}${c.ack?.note ? ` — ${c.ack.note}` : ""}${c.ack ? ` (${c.ack.date})` : ""}${last}`);
        }
      }
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
      await revoke(needConfig(), positionals[0], opts.restore ? "restore" : "revoke");
      console.log(opts.restore ? `${positionals[0].toLowerCase()} may join again (with a new invite).` : `Removed ${positionals[0].toLowerCase()}: their invite no longer works, and the name can't be used.`);
      return 0;
    }
    case "setup": {
      const config = needConfig();
      const { setup } = await import("../lib/setup.mjs");
      const register = !opts["no-register"] && !process.env.CHAMBER_NO_REGISTER;
      const harnesses = opts.harness ? opts.harness.split(",").map((h) => h.trim()).filter(Boolean) : null;
      const LABEL = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity", dsh: "DeepSeek Harness (for you, in every project)" };
      // Several projects at once: chamber setup ~/code/api ~/code/web
      for (const folder of positionals.length ? positionals : ["."]) {
        if (!existsSync(resolve(folder))) {
          console.log(`${folder}: no such folder, skipped.`);
          continue;
        }
        const result = setup(folder, { name: positionals.length > 1 ? undefined : opts.name, wake: !opts["no-wake"], register, harnesses });
        console.log(`${basename(resolve(folder))}: in the chamber now:`);
        for (const h of result.harnesses) console.log(`  ${LABEL[h.harness]}  as ${config.owner}/${h.agent}`);
        if (!result.registered && register) console.log(`  Could not run the claude command; register the MCP server yourself:\n    ${result.manual}`);
      }
      console.log("Restart Claude Code or Codex in these projects to connect (a running session doesn't pick it up).");
      return 0;
    }
    case "doctor": {
      const lines = [];
      let ready = true;
      const check = (ok, text, fix = "") => {
        if (!ok) ready = false;
        lines.push(`${ok ? "✔" : "✘"} ${text}${!ok && fix ? `\n    fix: ${fix}` : ""}`);
      };
      const [major, minor] = process.versions.node.split(".").map(Number);
      check(major > 22 || (major === 22 && minor >= 4), `Node ${process.versions.node}`, "install Node.js 22.4 or newer (https://nodejs.org)");
      const onPath = spawnSync(process.platform === "win32" ? "where" : "which", ["chamber"], { encoding: "utf8" }).status === 0;
      lines.push(`${onPath ? "✔" : "·"} chamber command ${onPath ? "on PATH" : `not on this shell's PATH yet (new terminals have it; meanwhile run ${join(process.env.CHAMBER_BIN || join(process.env.HOME || "~", ".local", "bin"), "chamber")})`}`);
      const config = loadConfig();
      check(Boolean(config), config ? `in ${config.name} as @${config.owner} (${config.invite.relay})` : "not in a chamber", "join with the invite link your admin sent, or create one: chamber start");
      if (config) {
        await config.invite.ready();
        const headers = { ...config.invite.auth, ...(config.invite.pass ? { "x-chamber-pass": config.invite.pass } : {}) };
        const info = await fetch(`${config.invite.relay}/v1/relay`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
        check(Boolean(info), info ? `relay reachable (v${info.relay ?? "?"})` : "relay not reachable", "check the network; the relay may be down");
        if (info) {
          const member = await fetch(`${config.invite.relay}/v1/lines/${config.invite.lineId}/memory`, { headers, signal: AbortSignal.timeout(8000) }).catch(() => null);
          const why = member && !member.ok ? (await member.json().catch(() => ({}))).error : "";
          check(Boolean(member?.ok), member?.ok ? "membership accepted" : `membership refused${why ? `: ${why}` : ""}`, "ask your admin for a new invite");
        }
        // Each project this machine connected, and whether its Claude Code is still wired to the chamber.
        const agents = join(HOME, "agents");
        const projects = new Map();
        for (const dir of existsSync(agents) ? readdirSync(agents) : []) {
          if (!dir.startsWith(`${config.owner}__`)) continue;
          try {
            const { path } = JSON.parse(readFileSync(join(agents, dir, "project.json"), "utf8"));
            if (!projects.has(path)) projects.set(path, []);
            projects.get(path).push(dir.slice(config.owner.length + 2));
          } catch {}
        }
        if (!projects.size) check(false, "no project connected yet", "run chamber setup <project folder> for each project your agents work in");
        for (const [path, names] of projects) {
          if (!existsSync(path)) {
            lines.push(`· ${path}: folder is gone (chamber remove there, or ignore)`);
            continue;
          }
          let hooked = false;
          try {
            const text = readFileSync(join(path, ".claude", "settings.local.json"), "utf8");
            hooked = text.includes("--chamber-hook") || text.includes("CHAMBER=1");
          } catch {}
          const wantsClaude = names.some((n) => n.startsWith("claude-code."));
          check(!wantsClaude || hooked, `${path}: ${names.join(", ")}${wantsClaude && !hooked ? " (Claude Code hooks missing)" : ""}`, `chamber setup ${JSON.stringify(path)}`);
        }
      }
      // The skill: how this machine's coding agents run Chamber for you (invite, join, the app).
      const skills = [".claude", ".codex"].filter((a) => existsSync(join(homedir(), a))).map((a) => join(homedir(), a, "skills", "chamber", "SKILL.md"));
      const missing = skills.filter((f) => !existsSync(f));
      if (skills.length) lines.push(`${missing.length ? "·" : "✔"} Chamber skill ${missing.length ? `missing in ${missing.map((f) => f.split("/skills/")[0]).join(", ")} (chamber setup . adds it)` : "for your coding agents"}`);
      console.log(lines.join("\n"));
      console.log(ready ? "\nready: restart Claude Code or Codex in those projects and they join the chamber." : "\nnot ready yet: see the fixes above.");
      return ready ? 0 : 1;
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
      const branch = opts.branch || null;
      const receipt = await client.send(to, text, { files, title, thread, replyTo: original?.id ?? null, branch });
      inbox.sent(receipt, { to, text, title, files, replyTo: original?.id ?? null, branch });
      console.log(receipt.held ? `Held for ${to} until they come online.` : `Delivered to ${receipt.delivered.join(", ")}.`);
      client.close();
      return 0;
    }
    case "app":
    case "desktop": {
      // The installed Mac app runs its own board: install it if it's missing (checked first), open it.
      if (process.platform === "darwin" && process.arch === "arm64" && !opts.port) {
        const { installApp } = await import("../lib/app.mjs");
        const app = await installApp({ onProgress: (line) => console.log(line) });
        const project = positionals[0] ? resolve(positionals[0]) : gitTop();
        if (project && loadConfig()) {
          const { setup } = await import("../lib/setup.mjs");
          setup(project, { register: !opts["no-register"] && !process.env.CHAMBER_NO_REGISTER });
        }
        if (!opts["no-open"]) spawnSync("open", ["-a", app]);
        console.log(opts["no-open"] ? `The app is at ${app}.` : `Opened ${app}.`);
        return 0;
      }
      const config = loadConfig();
      const project = positionals[0] ? resolve(positionals[0]) : gitTop();
      if (project && config) {
        try {
          const { setup } = await import("../lib/setup.mjs");
          const register = !opts["no-register"] && !process.env.CHAMBER_NO_REGISTER;
          setup(project, { register });
        } catch {}
      }
      const port = Number(opts.port || 7878);
      const url = `http://127.0.0.1:${port}`;
      const { serveBoard } = await import("../lib/server.mjs");

      setTimeout(() => {
        try {
          // 1. Check for packaged or compiled Tauri desktop app
          const tauriCandidates = [
            "/Applications/Chamber.app",
            join(process.env.HOME || "", "Applications/Chamber.app"),
            join(APP, "desktop/src-tauri/target/release/bundle/macos/Chamber.app"),
            join(APP, "desktop/src-tauri/target/release/chamber-desktop"),
            join(APP, "desktop/src-tauri/target/release/chamber"),
            join(APP, "desktop/src-tauri/target/release/chamber-desktop.exe"),
            join(APP, "desktop/src-tauri/target/release/chamber.exe"),
            join(APP, "desktop/src-tauri/target/debug/chamber-desktop"),
            join(APP, "desktop/src-tauri/target/debug/chamber"),
            join(APP, "desktop/src-tauri/target/debug/chamber-desktop.exe"),
            join(APP, "desktop/src-tauri/target/debug/chamber.exe"),
            join(process.env.LOCALAPPDATA || "", "Programs/Chamber/Chamber.exe"),
          ];
          for (const bin of tauriCandidates) {
            if (bin && existsSync(bin)) {
              if (bin.endsWith(".app")) {
                spawn("open", ["-a", bin], { stdio: "ignore", detached: true }).unref();
              } else {
                spawn(bin, [], { stdio: "ignore", detached: true }).unref();
              }
              return;
            }
          }

          // 2. Standalone chromeless window fallback
          if (process.platform === "darwin") {
            const browsers = [
              "/Applications/Google Chrome.app",
              "/Applications/Brave Browser.app",
              "/Applications/Microsoft Edge.app",
              "/Applications/Chromium.app",
            ];
            const app = browsers.find((p) => {
              try { return existsSync(p); } catch { return false; }
            });
            if (app) {
              spawn("open", ["-na", app, "--args", `--app=${url}`, `--window-name=Chamber`, "--window-size=1200,800"], { stdio: "ignore", detached: true }).unref();
              return;
            }
          } else if (process.platform === "win32") {
            spawn("cmd", ["/c", "start", "msedge", `--app=${url}`], { stdio: "ignore", detached: true }).unref();
            return;
          }
          if (process.platform === "darwin") spawnSync("open", [url]);
          else if (process.platform === "win32") spawnSync("cmd", ["/c", "start", url]);
          else spawnSync("xdg-open", [url]);
        } catch {}
      }, 500);

      console.log(`Chamber Desktop launched (${url})`);
      return serveBoard(config, { port, open: false });
    }
    case "board": {
      const { serveBoard } = await import("../lib/server.mjs");
      return serveBoard(loadConfig(), { port: Number(opts.port || 7878), open: !opts["no-open"] });
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
          // unref: once a message came, this timer mustn't keep the command running until it fires.
          setTimeout(() => resolve([client, null]), Number(opts.timeout || 120) * 1000).unref();
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
    case "sync": {
      const config = needConfig();
      const client = new LineClient(config.invite, `${config.owner}/sync`);
      const { ChamberSearch } = await import("../lib/search.mjs");
      const search = new ChamberSearch(config.owner);
      let count = 0;
      let since = 0;
      process.stdout.write("Syncing sealed history from relay...");
      while (true) {
        const { messages, hasMore } = await client.syncHistory({
          since,
          limit: 200,
          onMessage: async (m) => {
            count++;
            since = Math.max(since, m.seq || 0);
            await search.index({
              id: m.id,
              talkId: m.thread || m.id,
              messageId: m.id,
              sender: m.from,
              channel: String(m.to || "").startsWith("#") ? m.to : "",
              type: m.type,
              title: m.title,
              text: `${m.title ? m.title + "\n" : ""}${m.text}${m.patch ? "\n" + m.patch : ""}`,
              createdAt: new Date(m.ts).toISOString(),
            });
          },
        });
        if (!hasMore || !messages.length) break;
      }
      search.close();
      client.close();
      console.log(`\n✔ Synced ${count} historical talks and messages. Local search index updated.`);
      return 0;
    }
    case "search": {
      const { owner } = needConfig();
      const query = positionals.join(" ").trim();
      if (!query) throw new LineError("chamber search <query> [--channel #name] [--type patch|incident|decision]");
      const { ChamberSearch } = await import("../lib/search.mjs");
      const search = new ChamberSearch(owner);
      const results = await search.search({
        query,
        channel: opts.channel || "",
        type: opts.type || "",
        limit: 15,
      });
      search.close();
      if (!results.length) {
        console.log("No matching talks or records found.");
        return 0;
      }
      for (const r of results) {
        console.log(`\x1b[1m[${r.citation}]\x1b[0m (${r.type}${r.channel ? ` in ${r.channel}` : ""}) ${r.sender ? `by ${r.sender}` : ""}`);
        if (r.title) console.log(`  Title: ${r.title}`);
        console.log(`  ${r.text.replace(/\n+/g, " ").slice(0, 160)}...\n`);
      }
      return 0;
    }
    case "away": {
      const config = needConfig();
      const { AwayResponder } = await import("../lib/away.mjs");
      const responder = new AwayResponder(config, { statusMessage: opts.status || "away in a meeting" });
      await responder.start();
      console.log(`Away responder active for ${config.owner}. Press Ctrl+C to stop.`);
      await new Promise(() => {}); // keep running
      return 0;
    }
    case "runner": {
      const config = needConfig();
      const { ChamberRunner } = await import("../lib/runner.mjs");
      const runner = new ChamberRunner(config);
      await runner.start();
      console.log(`Headless runner active for ${config.owner}. Watching signed workflows and approval gates...`);
      await new Promise(() => {}); // keep running
      return 0;
    }
    case "workflow": {
      const [op, file] = positionals;
      if (op === "sign") {
        if (!file) throw new LineError("chamber workflow sign <file.yaml>");
        const state = adminState();
        if (!state?.adminPrivate) throw new LineError("only the chamber admin can sign workflows (admin key not found in relay.json)");
        const config = needConfig();
        await config.invite.ready();
        const lineId = config.invite.lineId;
        const { signWorkflow } = await import("../lib/runner.mjs");
        const content = readFileSync(file, "utf8");
        const signed = signWorkflow(content, state.adminPrivate, { lineId });
        writeFileSync(file, signed);
        console.log(`✔ Signed ${file} with admin key for line ${lineId.slice(0, 12)}…`);
        return 0;
      }
      throw new LineError("chamber workflow sign <file.yaml>");
    }
    case "gate": {
      const { owner, invite } = needConfig();
      const [op, gateId] = positionals;
      const { ApprovalGateManager } = await import("../lib/runner.mjs");
      const mgr = new ApprovalGateManager(join(HOME, owner));
      if (!op || op === "list") {
        const pending = mgr.listPending();
        if (!pending.length) {
          console.log("No pending approval gates.");
          return 0;
        }
        for (const g of pending) {
          console.log(`- Gate: \x1b[1m${g.id}\x1b[0m: ${g.description} (requested by: ${g.requestedBy})`);
          if (g.mobileUrl) console.log(`  Mobile approval link: ${g.mobileUrl}`);
        }
        return 0;
      }
      if (op === "approve" || op === "reject") {
        if (!gateId) throw new LineError(`chamber gate ${op} <gate_id> [--token <tok>]`);
        const res = mgr.resolveGate(gateId, op, { token: opts.token || null, approver: owner, relayUrl: invite?.relay || null });
        console.log(`✔ Gate ${gateId} ${res.status}.`);
        return 0;
      }
      throw new LineError("chamber gate [list | approve <id> | reject <id>]");
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 28).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
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
