// A message sent from the board to one of your own agents that has no session running is only
// held by the relay: nobody is there to read it. Wake it: run the agent's CLI once, headless,
// in its project, so it reads the message and answers. Claude Code and Codex have a headless
// mode; Antigravity and DeepSeek Harness do not, so there the board says to open them.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { HOME } from "./inbox.mjs";

const PROMPT = (agent, from) =>
  `You are ${agent} in the team's chamber. ${from} sent you a message. Read it with the chamber inbox tool, ` +
  `do what it asks if it is a question or a task in this project, and answer with the chamber reply tool. Then stop.`;

const has = (bin) => spawnSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" }).status === 0;

/** The folder an agent works in, as `chamber setup` remembered it. */
export function projectOf(agent) {
  try {
    return JSON.parse(readFileSync(join(HOME, "agents", `${agent.replace("/", "__")}`, "project.json"), "utf8")).path || null;
  } catch {
    return null;
  }
}

const RUNNERS = {
  "claude-code": () => has("claude") && ["claude", ["-p", "--allowedTools", "mcp__chamber"]],
  claude: () => has("claude") && ["claude", ["-p", "--allowedTools", "mcp__chamber"]],
  codex: () => has("codex") && ["codex", ["exec", "--sandbox", "read-only"]],
};

/**
 * Wake `agent` (e.g. "ashish/codex.api") for a message from `from`. Resolves to what happened:
 * { woke: true } or { woke: false, reason } for the board to show.
 */
export function wake(agent, from, { spawnImpl = spawn } = {}) {
  const [, name = ""] = agent.split("/");
  const harness = name.split(".")[0];
  const project = projectOf(agent);
  const label = { antigravity: "Antigravity", dsh: "DeepSeek Harness", codex: "Codex", "claude-code": "Claude Code" }[harness] || harness;
  if (!project || !existsSync(project)) return { woke: false, reason: `${label} isn't set up in a folder on this machine.` };
  const runner = RUNNERS[harness]?.();
  if (!runner) return { woke: false, reason: `${label} can't be started from here. Open it in ${project} and it will pick this up.` };
  const [bin, args] = runner;
  const child = spawnImpl(bin, [...args, PROMPT(agent, from)], { cwd: project, stdio: "ignore", detached: true });
  child.on?.("error", () => {});
  child.unref?.();
  return { woke: true };
}
