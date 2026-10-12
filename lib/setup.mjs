// Put a project's Claude Code in the chamber: its MCP server (the connection and
// the tools) and the hooks that bring messages in. Everything goes in local,
// per-machine places — `claude mcp add -s local` and .claude/settings.local.json
// (kept out of git) — so nothing about the chamber is committed to the project.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { HOME, loadConfig } from "./inbox.mjs";
import { LineError } from "./protocol.mjs";

/** Where root's board learns which folder an agent works in (so it can list and remove it). */
function projectFile(name) {
  const config = loadConfig();
  return config ? join(HOME, "agents", `${config.owner}__${name}`, "project.json") : null;
}

const BIN = resolve(fileURLToPath(import.meta.url), "../../bin/chamber.mjs");
const MARK = "CHAMBER=1";

export function defaultName(project) {
  const slug = basename(project).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "");
  return `claude-code.${slug || "project"}`.slice(0, 32);
}

function command(verb, name) {
  return `${MARK} node "${BIN}" ${verb} --agent ${name}`;
}

function withoutOurs(groups) {
  return (groups || [])
    .map((group) => ({ ...group, hooks: (group.hooks || []).filter((h) => !String(h.command || "").includes(MARK)) }))
    .filter((group) => group.hooks.length);
}

export function hooksFor(name, { wake = true } = {}) {
  const show = { type: "command", command: command("hook", name), timeout: 10 };
  const waiter = { type: "command", command: command("wait", name), asyncRewake: true, timeout: 86400 };
  return {
    PostToolUse: [{ matcher: "*", hooks: [show] }],
    UserPromptSubmit: [{ hooks: [show] }],
    SessionStart: [{ hooks: wake ? [show, waiter] : [show] }],
    ...(wake ? { Stop: [{ hooks: [waiter] }] } : {}),
  };
}

function settingsPath(project) {
  return join(project, ".claude", "settings.local.json");
}

function writeHooks(project, hooks) {
  const path = settingsPath(project);
  let settings = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      throw new LineError(`${path} is not valid JSON; fix it first`);
    }
  }
  const merged = {};
  for (const event of new Set([...Object.keys(settings.hooks || {}), ...Object.keys(hooks)])) {
    const groups = [...withoutOurs(settings.hooks?.[event]), ...(hooks[event] || [])];
    if (groups.length) merged[event] = groups;
  }
  settings.hooks = merged;
  if (!Object.keys(merged).length) delete settings.hooks;
  mkdirSync(join(project, ".claude"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  return path;
}

function keepOutOfGit(project) {
  const exclude = join(project, ".git", "info", "exclude");
  if (!existsSync(join(project, ".git"))) return;
  const text = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
  if (!text.includes(".claude/settings.local.json")) {
    mkdirSync(join(project, ".git", "info"), { recursive: true });
    appendFileSync(exclude, `${text.endsWith("\n") || !text ? "" : "\n"}.claude/settings.local.json\n`);
  }
}

function claude(args, project) {
  try {
    execFileSync("claude", args, { cwd: project, stdio: "pipe" });
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    return null;
  }
}

export function setup(project, { name, wake = true, register = true } = {}) {
  project = resolve(project);
  name ||= defaultName(project);
  const path = writeHooks(project, hooksFor(name, { wake }));
  keepOutOfGit(project);
  const marker = projectFile(name);
  if (marker) {
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, JSON.stringify({ path: project }));
  }
  const add = ["mcp", "add", "-s", "local", "chamber", "--", "node", BIN, "mcp", "--agent", name];
  let registered = false;
  if (register) {
    claude(["mcp", "remove", "-s", "local", "chamber"], project);
    registered = claude(add, project) === true;
  }
  return { name, settings: path, registered, manual: registered ? null : `claude ${add.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}` };
}

export function teardown(project, { register = true, name } = {}) {
  project = resolve(project);
  writeHooks(project, {});
  const marker = projectFile(name || defaultName(project));
  if (marker) rmSync(marker, { force: true });
  if (register) claude(["mcp", "remove", "-s", "local", "chamber"], project);
}
