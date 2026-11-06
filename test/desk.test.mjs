// Desks: each agent's live state, published for the team; overlaps noticed; sessions briefed.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.CHAMBER_HOME = mkdtempSync(join(tmpdir(), "chamber-desk-"));
const desk = await import("../lib/desk.mjs");
const { describe, Inbox } = await import("../lib/inbox.mjs");

// TeamMemory-shaped: list/read/write/commit over a map, refusing stale bases like the relay.
function stubMemory() {
  const files = new Map();
  let writes = 0;
  return {
    files,
    get writes() {
      return writes;
    },
    async list() {
      return [...files].map(([path, f]) => ({ path, version: f.version }));
    },
    async read(path) {
      const f = files.get(path);
      return f ? { path, ...f } : null;
    },
    async write(path, text) {
      writes++;
      const f = files.get(path) || { version: 0 };
      files.set(path, { version: f.version + 1, text });
      return { ok: true };
    },
    async commit(changes) {
      for (const c of changes) if ((files.get(c.path)?.version ?? 0) !== c.base) return { ok: false, current: [] };
      for (const c of changes) files.set(c.path, { version: c.base + 1, text: c.text });
      return { ok: true };
    },
    async search() {
      return [];
    },
  };
}

/** A clone of `from` (shared history), as `name` would have it. */
function cloneOf(from, name, remote = "https://github.com/sankhya-ai/chamber") {
  const dir = mkdtempSync(join(tmpdir(), `chamber-${name}-`));
  execFileSync("git", ["clone", "-q", from, dir], { stdio: "pipe" });
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("config", "user.email", `${name}@example.com`);
  git("config", "user.name", name);
  git("remote", "set-url", "origin", remote);
  return { dir, git };
}

function repo(name, remote = "git@github.com:sankhya-ai/chamber.git") {
  const dir = mkdtempSync(join(tmpdir(), `chamber-${name}-`));
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", `${name}@example.com`);
  git("config", "user.name", name);
  git("remote", "add", "origin", remote);
  mkdirSync(join(dir, "lib"));
  writeFileSync(join(dir, "lib", "mcp.mjs"), "export {}\n");
  writeFileSync(join(dir, "README.md"), "hi\n");
  git("add", ".");
  git("commit", "-q", "-m", "first");
  return dir;
}

test("prompts leave the machine without secrets, and short", () => {
  const out = desk.redact("deploy with key sk-proj-abcdefghijklmnopqrstuvwx and password: hunter22 then ghp_abcdefghijklmnopqrstuvwxyz0123 ok");
  assert.doesNotMatch(out, /abcdefghijklmnop|hunter22|ghp_/);
  assert.match(out, /password: \[redacted\]/);
  assert.match(desk.redact("fix lib/components/really/long/path/to/some/file/in/the/repo.tsx please"), /lib\/components\/really\/long\/path/, "paths are kept");
  assert.equal(Array.from(desk.redact("x".repeat(500), 50)).length, 50);
  assert.equal(desk.redact("a <pasted_content id=1>SECRET STUFF</pasted_content> b"), "a [pasted] b");
});

test("which files a tool call changed, across harnesses", () => {
  assert.deepEqual(desk.editedFiles("Edit", { file_path: "/p/lib/a.mjs", old_string: "x" }), ["/p/lib/a.mjs"]);
  assert.deepEqual(desk.editedFiles("Write", { file_path: "/p/b.md" }), ["/p/b.md"]);
  assert.deepEqual(desk.editedFiles("Read", { file_path: "/p/b.md" }), [], "reading is not changing");
  assert.deepEqual(desk.editedFiles("apply_patch", { input: "*** Begin Patch\n*** Update File: src/x.ts\n@@\n*** Add File: src/y.ts\n" }), ["src/x.ts", "src/y.ts"]);
});

test("two clones of one repo compare equal, whatever the remote's form", () => {
  const ids = ["git@github.com:Sankhya-AI/chamber.git", "https://github.com/sankhya-ai/chamber", "https://user@github.com/sankhya-ai/chamber.git/", "ssh://git@github.com/sankhya-ai/chamber.git"].map((r) => desk.repoId(r));
  assert.deepEqual(new Set(ids), new Set(["github.com/sankhya-ai/chamber"]));
  assert.equal(desk.repoId("", "plank"), "plank");
});

test("the hooks' record becomes a desk: task, files edited during it, uncommitted files, commits", () => {
  const dir = repo("maya");
  const agent = "maya/claude-code.chamber";
  const t0 = Date.now() - 60_000;
  desk.record(agent, "SessionStart", { cwd: dir });
  desk.record(agent, "UserPromptSubmit", { cwd: dir, prompt: "make the session expiry milliseconds" });
  desk.record(agent, "PostToolUse", { cwd: dir, tool_name: "Edit", tool_input: { file_path: join(dir, "lib", "mcp.mjs") } });
  writeFileSync(join(dir, "lib", "mcp.mjs"), "export const ms = 1\n");
  const d = desk.snapshot(agent, dir);
  assert.equal(d.repo, "github.com/sankhya-ai/chamber");
  assert.equal(d.branch, "main");
  assert.equal(d.state, "working");
  assert.equal(d.task.text, "make the session expiry milliseconds");
  assert.deepEqual(d.task.edited, ["lib/mcp.mjs"]);
  assert.deepEqual(d.dirty, ["lib/mcp.mjs"]);
  assert.equal(d.commits[0].subject, "first");
  assert.ok(d.lastActive >= t0);

  desk.addNote(agent, { kind: "decided", text: "expiry is int milliseconds from now on" });
  const text = desk.render(desk.snapshot(agent, dir));
  assert.match(text, /^<!-- desk /);
  assert.match(text, /## Now[\s\S]*make the session expiry milliseconds/);
  assert.match(text, /\[decided\] .* expiry is int milliseconds/);
  assert.equal(desk.parse(text).agent, agent, "the data comes back out");
  assert.equal(desk.parse("# not a desk"), null);
});

test("an agent that hasn't worked for a while is idle; one whose connection closed is offline", () => {
  const dir = repo("dev");
  const agent = "dev/codex.chamber";
  desk.record(agent, "UserPromptSubmit", { cwd: dir, prompt: "old work" });
  assert.equal(desk.snapshot(agent, dir, { now: Date.now() + 3600_000 }).state, "idle");
  assert.equal(desk.snapshot(agent, dir, { online: false }).state, "offline");
});

test("overlap: same repo and same file only", () => {
  const a = { agent: "a/x", repo: "github.com/t/r", dirty: ["lib/mcp.mjs", "README.md"], task: { edited: [] } };
  const b = { agent: "b/y", repo: "github.com/t/r", dirty: [], task: { edited: ["lib/mcp.mjs"] } };
  assert.deepEqual(desk.overlap(a, b), ["lib/mcp.mjs"]);
  assert.deepEqual(desk.overlap(a, { ...b, repo: "github.com/t/other" }), [], "another repo's lib/mcp.mjs is another file");
  assert.deepEqual(desk.overlap(a, { ...a }), [], "not with yourself");
});

test("the keeper publishes when the desk changes (not on every tick), and tells this agent of an overlap once", async () => {
  const mine = repo("ashish");
  const { dir: theirs, git: nitinGit } = cloneOf(mine, "nitin");
  const memory = stubMemory();
  const inbox = new Inbox("ashish/claude-code.chamber");

  const nitin = new desk.DeskKeeper({ agent: "nitin/claude-code.chamber", cwd: theirs, memory });
  desk.record("nitin/claude-code.chamber", "UserPromptSubmit", { prompt: "windows port of the wake rules" });
  writeFileSync(join(theirs, "lib", "mcp.mjs"), "// nitin's change\n");
  await nitin.tick();

  const keeper = new desk.DeskKeeper({ agent: "ashish/claude-code.chamber", cwd: mine, memory, inbox });
  desk.record("ashish/claude-code.chamber", "UserPromptSubmit", { prompt: "desks for agents" });
  writeFileSync(join(mine, "lib", "mcp.mjs"), "// ashish's change\n");
  const now = Date.now();
  await keeper.tick(now);
  assert.ok(memory.files.has("desks/ashish/claude-code.chamber.md"));
  const writes = memory.writes;
  await keeper.tick(now + 1000);
  assert.equal(memory.writes, writes, "nothing changed: nothing written");

  const notices = inbox.claim().filter((r) => r.type === "notice");
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /nitin\/claude-code\.chamber is also changing lib\/mcp\.mjs in github\.com\/sankhya-ai\/chamber/);
  assert.match(notices[0].text, /windows port of the wake rules/);
  await keeper.tick(now + 120_000);
  assert.equal(inbox.claim().filter((r) => r.type === "notice").length, 0, "told once, not every tick");

  const shown = describe(notices);
  assert.match(shown, /Chamber noticed — Overlap with nitin/);
  assert.doesNotMatch(shown, /reply` tool/, "a notice is not a message to answer");

  const brief = desk.briefing(keeper.team, "ashish/claude-code.chamber");
  assert.match(brief, /Where you left off[\s\S]*desks for agents/);
  assert.match(brief, /Your team right now[\s\S]*nitin\/claude-code\.chamber — working/);
  assert.match(brief, /OVERLAP: nitin\/claude-code\.chamber is also changing lib\/mcp\.mjs/);

  // Nitin commits README.md, which Ashish has uncommitted and doesn't have the commit for: pull first.
  writeFileSync(join(theirs, "README.md"), "nitin's readme\n");
  nitinGit("commit", "-qam", "readme: windows install steps");
  writeFileSync(join(mine, "README.md"), "ashish's readme\n");
  await nitin.tick(now + 200_000);
  await keeper.refresh(now + 200_000);
  await keeper.tick(now + 200_000);
  const landed = inbox.claim().filter((r) => r.type === "notice");
  assert.equal(landed.length, 1);
  assert.equal(landed[0].title, "nitin/claude-code.chamber committed to files you're changing");
  assert.match(landed[0].text, /committed changes to README\.md, lib\/mcp\.mjs .*"readme: windows install steps".*isn't in your branch[\s\S]*same branch: pull \(once it's pushed\) or rebase/);
});

test("right after an edit, the hook says if another agent is changing that file (from the cached team, once)", () => {
  const dir = repo("paarth");
  const team = {
    "maya/claude-code.web": { agent: "maya/claude-code.web", repo: "github.com/sankhya-ai/chamber", branch: "onboarding", state: "working", updated: Date.now(), lastActive: Date.now(), dirty: ["lib/mcp.mjs"], task: { text: "onboarding S01", edited: ["lib/mcp.mjs"] }, commits: [], notes: [] },
  };
  desk.saveTeam(team);
  const input = { cwd: dir, tool_name: "Edit", tool_input: { file_path: join(dir, "lib", "mcp.mjs") } };
  const found = desk.afterEdit("paarth/claude-code.chamber", input);
  assert.equal(found.length, 1);
  assert.match(desk.noticeText(found[0].item, found[0].mine), /maya\/claude-code\.web is also changing lib\/mcp\.mjs .*its branch: onboarding.*"onboarding S01"/);
  assert.equal(desk.afterEdit("paarth/claude-code.chamber", input).length, 0, "said once");
  assert.equal(desk.afterEdit("paarth/claude-code.chamber", { ...input, tool_input: { file_path: join(dir, "README.md") } }).length, 0, "another file: nothing");
});

test("an agent's own `now` note is its task's headline; a private prompt says so", () => {
  const dir = repo("nina");
  const agent = "nina/claude-code.chamber";
  desk.record(agent, "UserPromptSubmit", { cwd: dir, prompt: "do it then sir" });
  assert.equal(desk.taskText(desk.snapshot(agent, dir).task), '"do it then sir"');
  desk.addNote(agent, { kind: "now", text: "building agent desks: look, ask, note" });
  const d = desk.snapshot(agent, dir);
  assert.equal(desk.taskText(d.task), '"building agent desks: look, ask, note"');
  assert.equal(d.notes.length, 0, "a now note is the headline, not a note");
  assert.equal(desk.taskText({ text: "", private: true }), "(kept private)");
});

test("a session's briefing leads with what teammates wait on from its person, and what they decided in its repo", () => {
  const now = Date.now();
  const base = { repo: "github.com/sankhya-ai/chamber", branch: "main", state: "working", updated: now, lastActive: now, dirty: [], dirtyCount: 0, commits: [], recent: [] };
  const brief = desk.briefing({
    "ashish/claude-code.chamber": { ...base, agent: "ashish/claude-code.chamber", task: { text: "desks" }, notes: [] },
    "nitin/claude-code.chamber": { ...base, agent: "nitin/claude-code.chamber", task: { text: "windows" }, notes: [
      { ts: now - 60_000, kind: "blocked", text: "need a Windows code-signing cert from ashish" },
      { ts: now - 60_000, kind: "decided", text: "wake default becomes team/answer" },
      { ts: now - 60_000, kind: "blocked", text: "waiting on ashishk's review" },
    ] },
  }, "ashish/claude-code.chamber", { now });
  assert.match(brief, /^Teammates' agents say they're waiting on ashish \(your person\)[^\n]*\n- nitin\/claude-code\.chamber \(blocked, just now\): need a Windows code-signing cert from ashish$/m);
  assert.doesNotMatch(brief.split("\n\n")[0], /ashishk/, "another name that starts the same is not ashish");
  assert.match(brief, /Decided lately in this repo, as teammates' agents noted it[^\n]*\n- nitin\/claude-code\.chamber: wake default becomes team\/answer/);
});

test("the standup is what the desks say: per person, done / doing / decided / blocked, overlaps, and who was quiet", () => {
  const now = Date.now();
  const d = (agent, extra) => ({ agent, repo: "github.com/sankhya-ai/chamber", branch: "main", state: "idle", updated: now - 60_000, lastActive: now - 3600_000, dirty: [], dirtyCount: 0, commits: [], recent: [], notes: [], task: null, ...extra });
  const text = desk.standup({
    "ashish/claude-code.chamber": d("ashish/claude-code.chamber", { task: { text: "", headline: "agent desks" }, commits: [{ sha: "abc1234", ts: now - 7200_000, subject: "desks: look, ask, note", files: [] }], dirty: ["lib/wake.mjs"], dirtyCount: 1, notes: [{ ts: now - 600_000, kind: "decided", text: "wake default is team/answer" }] }),
    "nitin/claude-code.tura": d("nitin/claude-code.tura", { task: { text: "windows wake rules" }, dirty: ["lib/wake.mjs"], dirtyCount: 1, notes: [{ ts: now - 600_000, kind: "blocked", text: "needs a Windows signing cert from ashish" }] }),
    "mira/claude-code.atlas": d("mira/claude-code.atlas", { updated: now - 5 * 86400_000, lastActive: now - 5 * 86400_000 }),
  }, { now, people: ["ashish", "nitin", "paarth", "mira"] });
  assert.match(text, /^Standup, /);
  assert.match(text, /ashish\n- claude-code\.chamber \(idle, 60m ago\) in github\.com\/sankhya-ai\/chamber@main: "agent desks"\n  committed: abc1234 desks: look, ask, note/);
  assert.match(text, /decided: wake default is team\/answer/);
  assert.match(text, /Overlaps\n- ashish\/claude-code\.chamber and nitin\/claude-code\.tura are both changing lib\/wake\.mjs/);
  assert.match(text, /Blocked\n- nitin\/claude-code\.tura: needs a Windows signing cert from ashish/);
  assert.match(text, /No agent activity: paarth, mira/, "mira's desk is days old: quiet today");
});

test("a desk's state as a reader takes it: a dead session's 'working' desk has gone quiet", () => {
  const now = Date.now();
  assert.equal(desk.stateOf({ state: "working", updated: now - 60_000, lastActive: now - 60_000 }, now), "working");
  assert.equal(desk.stateOf({ state: "working", updated: now - 3 * 3600_000, lastActive: now - 3 * 3600_000 }, now), "gone quiet");
  assert.equal(desk.stateOf({ state: "offline", updated: now - 86400_000 }, now), "offline");
});

test("repos are told apart by origin, else by first commit; never by folder name; no git, no comparing", () => {
  const a = repo("same-name", "");
  const b = repo("same-name", "");
  execFileSync("git", ["remote", "remove", "origin"], { cwd: a, stdio: "pipe" });
  execFileSync("git", ["remote", "remove", "origin"], { cwd: b, stdio: "pipe" });
  writeFileSync(join(b, "README.md"), "different history\n");
  execFileSync("git", ["commit", "-qam", "b"], { cwd: b, stdio: "pipe" });
  const ida = desk.repoOf(a);
  assert.match(ida, /^git:[0-9a-f]{12}$/);
  const clone = mkdtempSync(join(tmpdir(), "chamber-clone-"));
  execFileSync("git", ["clone", "-q", a, clone], { stdio: "pipe" });
  execFileSync("git", ["remote", "remove", "origin"], { cwd: clone, stdio: "pipe" });
  assert.equal(desk.repoOf(clone), ida, "a clone without a remote is still the same repo");
  const plain = mkdtempSync(join(tmpdir(), "chamber-plain-"));
  assert.equal(desk.snapshot("x/claude-code.plain", plain).repo, null);
  assert.deepEqual(desk.overlap({ agent: "a/x", repo: null, dirty: ["a"] }, { agent: "b/y", repo: null, dirty: ["a"] }), []);
});

test("a commit on another branch: don't pull it, coordinate; one already brought in (squash) isn't news", async () => {
  const mine = repo("lena");
  const { dir: theirs, git: tg } = cloneOf(mine, "omar");
  const memory = stubMemory();
  tg("checkout", "-qb", "feature");
  await new Promise((r) => setTimeout(r, 1100)); // git times are in seconds
  const omar = new desk.DeskKeeper({ agent: "omar/claude-code.chamber", cwd: theirs, memory });
  desk.record("omar/claude-code.chamber", "UserPromptSubmit", { prompt: "feature work" });
  writeFileSync(join(theirs, "README.md"), "omar\n");
  tg("commit", "-qam", "readme on feature");
  await omar.tick();
  const inbox = new Inbox("lena/claude-code.chamber");
  const lena = new desk.DeskKeeper({ agent: "lena/claude-code.chamber", cwd: mine, memory, inbox });
  desk.record("lena/claude-code.chamber", "UserPromptSubmit", { prompt: "docs" });
  writeFileSync(join(mine, "README.md"), "lena\n");
  await lena.tick();
  const [n] = inbox.claim().filter((r) => r.type === "notice");
  assert.match(n.text, /on feature\), and that commit isn't in your branch[\s\S]*another branch, so don't pull it in/);
  // Lena's HEAD later changes README itself (a squash merge of Omar's work, say): not news anymore.
  const g = (...a) => execFileSync("git", a, { cwd: mine, stdio: "pipe" });
  await new Promise((r) => setTimeout(r, 1100));
  g("commit", "-qam", "squash: readme");
  const c = omar.desk.commits[0];
  assert.equal(lena.has(c.sha, "README.md", c.ts, Date.now() + 61_000), true, "Lena's README commit is later than Omar's");
});

test("an agent sees five tools; a woken one also gets the inbox its wake prompt points to", async () => {
  const { LineTools } = await import("../lib/mcp.mjs");
  const client = { agent: "ashish/claude-code.x", invite: { ready: async () => { throw new Error("offline"); } }, roster: [], channels: [] };
  const tools = new LineTools(client, null, process.cwd());
  assert.deepEqual((await tools.listTools()).map((t) => t.name), ["look", "ask", "reply", "note", "search"]);
  process.env.CHAMBER_WOKEN = "maya/claude-code.web";
  try {
    assert.deepEqual((await tools.listTools()).map((t) => t.name), ["look", "ask", "reply", "note", "search", "inbox"]);
  } finally {
    delete process.env.CHAMBER_WOKEN;
  }
});
