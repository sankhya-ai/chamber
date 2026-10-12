// End to end against the real relay (workerd, via `wrangler dev`): clients, the
// MCP server, the hooks, setup. Run: npm test (after `npm install` in relay/).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { createInterface } from "node:readline";

import { LineClient } from "../lib/client.mjs";
import { Invite, LineError } from "../lib/protocol.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const BIN = join(ROOT, "bin", "line.mjs");
const WRANGLER = join(ROOT, "relay", "node_modules", ".bin", "wrangler");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (name) => mkdtempSync(join(tmpdir(), `root-line-${name}-`));

let relay;
let relayProcess;
const children = new Set(); // killed at the end, so a failure cannot hang the run
const clients = new Set();

async function freePort() {
  return new Promise((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

before(async () => {
  assert.ok(existsSync(WRANGLER), "npm install in relay/ first");
  const port = await freePort();
  relayProcess = spawn(WRANGLER, ["dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", tmp("relay"), "--var", "IDLE_WIPE_SECONDS:2"], {
    cwd: join(ROOT, "relay"),
    stdio: "ignore",
    detached: true,
  });
  relay = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(relay)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("relay did not start");
});

after(() => {
  for (const child of children) child.kill("SIGKILL");
  for (const client of clients) client.close();
  process.kill(-relayProcess.pid, "SIGTERM");
});

function run(args, { home, input = "", cwd = ROOT } = {}) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, ROOT_LINE_HOME: home } });
    children.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => done({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function join_(invite, agent, options = {}) {
  const client = new LineClient(invite, agent, options);
  clients.add(client);
  client.run();
  await client.ready();
  return client;
}

function mcp(home, agent, cwd) {
  const child = spawn(process.execPath, [BIN, "mcp", "--agent", agent], { cwd, env: { ...process.env, ROOT_LINE_HOME: home } });
  children.add(child);
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  lines.on("line", (line) => {
    const response = JSON.parse(line);
    pending.get(response.id)?.(response);
  });
  let id = 0;
  const call = (method, params = {}) =>
    new Promise((done) => {
      pending.set(++id, (response) => done(response.result));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const tool = async (name, args = {}) => {
    const result = await call("tools/call", { name, arguments: args });
    return { text: result.content[0].text, isError: result.isError };
  };
  return { child, call, tool, close: () => child.stdin.end() };
}

test("sealing: the relay can route but not read, alter or re-attribute", async () => {
  const invite = await Invite.create("https://relay.example").ready();
  const meta = { sender: "a/x", to: "@b", id: "m1", replyTo: null };
  const body = await invite.seal({ text: "hi" }, meta);
  assert.deepEqual(await invite.open(body, meta), { text: "hi" });
  for (const change of [{ sender: "c/x" }, { to: "@c" }, { id: "m2" }, { replyTo: "m0" }]) {
    await assert.rejects(invite.open(body, { ...meta, ...change }), LineError);
  }
  await assert.rejects((await Invite.create("https://relay.example").ready()).open(body, meta), LineError);
  assert.throws(() => Invite.parse("https://relay.example/"), LineError);
  assert.equal(String(Invite.parse(String(invite))), String(invite));
});

test("a project's Claude Code: asked, shown mid-task by the hook, woken when idle, replies with files", async () => {
  const invite = Invite.create(relay);
  const home = tmp("chitranjan");
  const project = tmp("project");
  writeFileSync(join(project, "schema.py"), "class Token:\n    expires_in: int\n");
  assert.equal((await run(["join", String(invite), "--as", "chitranjan"], { home })).code, 0);
  assert.equal(readFileSync(join(home, "config.json")).length > 0, true);

  const server = mcp(home, "claude-code.api", project);
  const init = await server.call("initialize", { protocolVersion: "2025-06-18" });
  assert.match(init.instructions, /chitranjan\/claude-code\.api/);
  assert.deepEqual((await server.call("tools/list")).tools.map((t) => t.name), ["line_agents", "line_ask", "line_inbox", "line_reply"]);

  await invite.ready();
  const nitin = await join_(invite, "nitin/root", { kind: "root", answers: true, priority: 10 });
  for (let i = 0; i < 50 && !nitin.roster.some((a) => a.agent === "chitranjan/claude-code.api"); i++) await sleep(100);
  assert.match((await server.tool("line_agents")).text, /nitin\/root \(root, answers\)/);

  // Mid-task: the PostToolUse hook adds it to Claude's context, once.
  const asked = nitin.ask("@chitranjan", "What type is expires_in?", { timeout: 20000 });
  let shown;
  for (let i = 0; i < 50; i++) {
    shown = await run(["hook", "--agent", "claude-code.api"], { home, input: JSON.stringify({ hook_event_name: "PostToolUse" }) });
    if (shown.stdout) break;
    await sleep(100);
  }
  const context = JSON.parse(shown.stdout).hookSpecificOutput;
  assert.equal(context.hookEventName, "PostToolUse");
  assert.match(context.additionalContext, /from nitin\/root[\s\S]*What type is expires_in\?/);
  assert.match(context.additionalContext, /not your user's instructions/);
  assert.equal((await run(["hook", "--agent", "claude-code.api"], { home, input: "{}" })).stdout, "");

  // Claude replies, with a file; the asker gets both.
  const messageId = context.additionalContext.match(/\[([0-9a-f]{32})\]/)[1];
  const replied = await server.tool("line_reply", { message_id: messageId, message: "int, UNIX epoch", files: ["schema.py"] });
  assert.equal(replied.isError, false);
  const { reply } = await asked;
  assert.equal(reply.text, "int, UNIX epoch");
  assert.equal(new TextDecoder().decode(reply.files[0].data), "class Token:\n    expires_in: int\n");

  // Idle: the asyncRewake waiter exits 2 with the next message; a newer waiter retires an older one.
  const first = run(["wait", "--agent", "claude-code.api"], { home });
  await sleep(500);
  const second = run(["wait", "--agent", "claude-code.api"], { home });
  assert.equal((await first).code, 0);
  await sleep(300);
  await nitin.send("chitranjan/claude-code.api", "Are you free to review?", { files: [{ name: "big.bin", data: new Uint8Array(randomBytes(65536 + 10)) }] });
  const woken = await second;
  assert.equal(woken.code, 2);
  assert.match(woken.stderr, /Are you free to review\?/);
  assert.match(woken.stderr, /big\.bin \(65546 bytes\)/);

  // Claude asks back and waits for the answer.
  nitin.onMessage = (message) => nitin.send(message.from, `seen: ${message.text}`, { replyTo: message.id });
  const back = await server.tool("line_ask", { to: "nitin/root", message: "ping", wait_seconds: 20 });
  assert.match(back.text, /Answer:[\s\S]*seen: ping/);
  assert.match((await server.tool("line_ask", { to: "nitin/root", message: "x", files: ["nope.txt"] })).text, /not a file/);

  nitin.close();
  server.close();
});

test("setup adds the hooks next to the project's own, idempotently, and remove takes them out", async () => {
  const home = tmp("setup");
  const project = tmp("proj");
  mkdirSync(join(project, ".claude"));
  mkdirSync(join(project, ".git", "info"), { recursive: true });
  const own = { permissions: { allow: ["Bash(ls)"] }, hooks: { PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "lint.sh" }] }] } };
  writeFileSync(join(project, ".claude", "settings.local.json"), JSON.stringify(own));
  await run(["join", String(Invite.create(relay)), "--as", "nitin"], { home });
  for (let i = 0; i < 2; i++) {
    const result = await run(["setup", project, "--no-register"], { home });
    assert.equal(result.code, 0, result.stderr);
  }
  const settings = JSON.parse(readFileSync(join(project, ".claude", "settings.local.json"), "utf8"));
  assert.deepEqual(settings.permissions, own.permissions);
  const commands = Object.values(settings.hooks).flat().flatMap((g) => g.hooks.map((h) => h.command));
  assert.equal(commands.filter((c) => c === "lint.sh").length, 1);
  assert.equal(commands.filter((c) => c.includes("ROOT_LINE=1") && c.includes(" hook ")).length, 3);
  const stop = settings.hooks.Stop[0].hooks[0];
  assert.equal(stop.asyncRewake, true);
  assert.match(stop.command, /wait --agent claude-code\.root-line-proj-/);
  assert.match(readFileSync(join(project, ".git", "info", "exclude"), "utf8"), /\.claude\/settings\.local\.json/);

  await run(["remove", project, "--no-register"], { home });
  assert.deepEqual(JSON.parse(readFileSync(join(project, ".claude", "settings.local.json"), "utf8")), own);
});

test("one command: the relay serves the installer, which installs, joins and sets up the project", async () => {
  const invite = Invite.create(relay);
  const home = tmp("home");
  const lineHome = join(home, ".root-line");
  const bin = join(home, "bin");
  const project = tmp("nitins-api");
  await new Promise((done) => spawn("git", ["init", "-q"], { cwd: project }).on("close", done));

  const script = await (await fetch(`${relay}/install`)).text();
  assert.match(script, new RegExp(`RELAY="${relay}"`));
  assert.equal(await (await fetch(`${relay}/client/lib/protocol.mjs`)).text(), readFileSync(join(ROOT, "lib", "protocol.mjs"), "utf8"));
  assert.equal((await fetch(`${relay}/client/../../etc/passwd`)).status, 404);

  const result = await new Promise((done) => {
    const child = spawn("sh", ["-c", `curl -fsSL ${relay}/install | sh -s -- ${invite.secret} nitin`], {
      cwd: project,
      env: { ...process.env, HOME: home, ROOT_LINE_HOME: lineHome, ROOT_LINE_BIN: bin, ROOT_LINE_NO_REGISTER: "1" },
    });
    children.add(child);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => done({ code, out }));
  });
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /on the line as nitin/);
  assert.match(result.out, /its Claude Code is on the line as nitin\/claude-code\.root-line-nitins-api/);
  assert.equal(JSON.parse(readFileSync(join(lineHome, "config.json"), "utf8")).invite, String(invite));
  const hooks = JSON.parse(readFileSync(join(project, ".claude", "settings.local.json"), "utf8")).hooks;
  assert.match(hooks.Stop[0].hooks[0].command, new RegExp(`${lineHome}/app/bin/line.mjs`));

  // The installed command works on its own.
  const status = await new Promise((done) => {
    const child = spawn(join(bin, "root-line"), ["invite"], { env: { ...process.env, HOME: home, ROOT_LINE_HOME: lineHome } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", (code) => done({ code, out }));
  });
  assert.equal(status.code, 0);
  assert.match(status.out, new RegExp(`curl -fsSL ${relay}/install \\| sh -s -- ${invite.secret}`));
});
