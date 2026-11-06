// The Chamber app, for an agent setting Chamber up: find it, install it (Mac), and the agent skill
// that tells Claude Code and Codex how to run Chamber for their person.

import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { SKILL } from "./skill.mjs";

const RELEASE = "https://github.com/sankhya-ai/chamber/releases/latest/download";
/** Only an app signed by this Apple developer team is installed. */
export const TEAM = "986JMARB95";

/** The installed Mac app, or null. */
export function installedApp(home = homedir()) {
  return ["/Applications/Chamber.app", join(home, "Applications/Chamber.app")].find((p) => existsSync(join(p, "Contents"))) || null;
}

/** Why `app` (a Chamber.app) may not be installed, or null when it is signed by TEAM and notarized. */
export function appProblem(app, run = spawnSync) {
  const check = (cmd, args) => {
    const result = run(cmd, args, { encoding: "utf8" });
    return { ok: result.status === 0, text: `${result.stdout || ""}${result.stderr || ""}` };
  };
  if (!check("codesign", ["--verify", "--deep", "--strict", app]).ok) return "its signature doesn't check out";
  if (!new RegExp(`^TeamIdentifier=${TEAM}$`, "m").test(check("codesign", ["-dv", app]).text)) return "it isn't signed by Chamber's developer";
  if (!check("spctl", ["--assess", "--type", "execute", app]).ok) return "macOS doesn't accept it (not notarized)";
  return null;
}

/**
 * Install the latest Chamber app (Mac, Apple silicon), checked first. Returns its path. Throws when
 * this machine can't have it or the download doesn't check out.
 */
export async function installApp({ onProgress = () => {} } = {}) {
  const have = installedApp();
  if (have) return have;
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("the app is for Macs with Apple silicon; elsewhere use chamber board (Windows: https://github.com/sankhya-ai/chamber/releases/latest)");
  }
  const dir = mkdtempSync(join(tmpdir(), "chamber-app-"));
  const mount = join(dir, "mnt");
  try {
    onProgress("Downloading the Chamber app…");
    const response = await fetch(`${RELEASE}/chamber-darwin-arm64.dmg`);
    if (!response.ok) throw new Error(`couldn't download the app (GitHub answered ${response.status})`);
    writeFileSync(join(dir, "chamber.dmg"), Buffer.from(await response.arrayBuffer()));
    execFileSync("hdiutil", ["attach", "-quiet", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount, join(dir, "chamber.dmg")]);
    const fresh = join(mount, "Chamber.app");
    const problem = appProblem(fresh);
    if (problem) throw new Error(`not installing the downloaded app: ${problem}`);
    let dest = "/Applications";
    try {
      accessSync(dest, constants.W_OK);
    } catch {
      dest = join(homedir(), "Applications");
      mkdirSync(dest, { recursive: true });
    }
    execFileSync("ditto", [fresh, join(dest, "Chamber.app")]);
    onProgress(`Installed ${join(dest, "Chamber.app")} (signed by Chamber's developer, notarized by Apple).`);
    return join(dest, "Chamber.app");
  } finally {
    try {
      execFileSync("hdiutil", ["detach", "-quiet", mount], { stdio: "ignore" });
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The Chamber skill, for each coding agent this machine has (~/.claude, ~/.codex): how to set
 * Chamber up, join, invite, and the rest. Kept current on every setup. Returns where it went.
 */
export function installSkill(home = homedir()) {
  const placed = [];
  for (const agent of [".claude", ".codex"]) {
    if (!existsSync(join(home, agent))) continue;
    const dir = join(home, agent, "skills", "chamber");
    const file = join(dir, "SKILL.md");
    try {
      if (existsSync(file) && readFileSync(file, "utf8") === SKILL) {
        placed.push(file);
        continue;
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, SKILL);
      placed.push(file);
    } catch {}
  }
  return placed;
}
