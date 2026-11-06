// Agent-driven setup and the guards around it: join links (sealed, one-time), and secrets that
// never leave in a message. The relay side runs end to end in chamber.test.mjs.

import assert from "node:assert/strict";
import { test } from "node:test";

import { LineClient } from "../lib/client.mjs";
import { Invite, redeemTicket, resolveInvite, scrubSecrets, SECRET_FILE, sealTicket, TICKET_LINK } from "../lib/protocol.mjs";

test("scrubSecrets takes out what is surely a secret and leaves hashes, ids and paths", () => {
  const sha = "3f9a2b1c4d5e6f708192a3b4c5d6e7f809123456";
  const input = [
    `fixed in ${sha}`,
    "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456",
    'export DB_PASSWORD="hunter2hunter2"',
    "postgres://app:s3cretpass@db.internal:5432/app",
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "AKIAABCDEFGHIJKLMNOP",
    "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----",
    `https://relay.dev/#${"k".repeat(43)}~pass.sig`,
    "src/components/some-long-component-name-with-numbers-12345.tsx",
    "the token expiry is an int",
  ].join("\n");
  const { text, count } = scrubSecrets(input);
  for (const secret of ["sk-proj-abc", "hunter2", "s3cretpass", "ghp_abc", "AKIAABCD", "b3BlbnNzaC1rZXktdjEAAAAA", "k".repeat(43)]) assert.ok(!text.includes(secret), secret);
  assert.ok(text.includes(sha), "commit hashes go through");
  assert.ok(text.includes("OPENAI_API_KEY=[redacted]"), "the name stays, so the reader knows what was there");
  assert.ok(text.includes("some-long-component-name-with-numbers-12345.tsx"));
  assert.ok(text.includes("the token expiry is an int"), "talking about tokens is fine");
  assert.ok(count >= 7);
});

test("secrets files are known by name", () => {
  for (const f of [".env", ".env.local", "config/.env.production", "id_ed25519", "server.pem", "credentials.json", ".npmrc", "gcp-service-account.json"]) assert.ok(SECRET_FILE.test(f), f);
  for (const f of ["README.md", "env.ts", "keys.ts", "environment.md", "tokens.css"]) assert.ok(!SECRET_FILE.test(f), f);
});

test("a message never carries a secrets file or a private key, and its text is scrubbed", async () => {
  const invite = await Invite.create("http://127.0.0.1:1").ready();
  const client = new LineClient(invite, "ashish/claude-code.api");
  let sent = null;
  client.ready = async () => {};
  client.ws = { send: (frame) => (sent = JSON.parse(frame)) };
  const file = (name, text) => ({ name, data: new TextEncoder().encode(text) });
  await assert.rejects(client.send("maya/claude-code.web", "here", { files: [file(".env", "A=1")] }), /secrets file/);
  await assert.rejects(client.send("maya/claude-code.web", "here", { files: [file("notes.txt", "-----BEGIN RSA PRIVATE KEY-----\nabc")] }), /private key/);
  assert.equal(sent, null, "nothing went out");
  const pending = client.send("maya/claude-code.web", "use STRIPE_SECRET_KEY=sk_live_abcdefghijklmnop1234");
  await new Promise((r) => setTimeout(r, 20));
  const body = await invite.open(sent.body, { sender: "ashish/claude-code.api", to: "maya/claude-code.web", id: sent.id, replyTo: null });
  assert.equal(body.text, "use STRIPE_SECRET_KEY=[redacted]");
  client.acks.get(sent.id).resolve({ delivered: [] });
  await pending;
});

test("join links: sealed for one chamber, opened once, checked against the link", async () => {
  const invite = await Invite.create("https://relay.example.dev").ready();
  const ticket = await sealTicket(invite.lineId, { invite: String(invite.withPass("p.s")), name: "maya", from: "ashish" });
  const link = `https://relay.example.dev/join/${invite.lineId}.${ticket.id}#${ticket.key}`;
  assert.ok(TICKET_LINK.test(`Set me up.\n  My one-time join link: ${link}\n`));
  let used = false;
  const relay = async (url, init) => {
    assert.equal(init.method, "POST");
    assert.equal(url, `https://relay.example.dev/v1/join/${invite.lineId}/${ticket.id}`, "the key never goes to the relay");
    if (used) return new Response(JSON.stringify({ error: "this invite was used already" }), { status: 410 });
    used = true;
    return new Response(JSON.stringify({ sealed: ticket.sealed }));
  };
  const joined = await redeemTicket(`paste: ${link}`, { fetchImpl: relay });
  assert.equal(joined.name, "maya");
  assert.equal(joined.from, "ashish");
  assert.equal(joined.invite.secret, invite.secret);
  assert.equal(joined.invite.pass, "p.s");
  await assert.rejects(redeemTicket(link, { fetchImpl: relay }), /used already/);

  // A ticket that opens to another chamber than its link names is refused.
  const other = await Invite.create("https://elsewhere.dev").ready();
  const swapped = await sealTicket(invite.lineId, { invite: String(other) });
  await assert.rejects(
    redeemTicket(`https://relay.example.dev/join/${invite.lineId}.${swapped.id}#${swapped.key}`, { fetchImpl: async () => new Response(JSON.stringify({ sealed: swapped.sealed })) }),
    /different chamber/,
  );
  // The wrong key opens nothing.
  await assert.rejects(
    redeemTicket(`https://relay.example.dev/join/${invite.lineId}.${ticket.id}#${"A".repeat(43)}`, { fetchImpl: async () => new Response(JSON.stringify({ sealed: ticket.sealed })) }),
    /doesn't open/,
  );
  // An invite code still works as before.
  assert.equal((await resolveInvite(String(invite))).invite.secret, invite.secret);
});

test("a headless session (claude -p, the SDK, a woken agent) never waits for messages at Stop", async () => {
  const { unattended, wait } = await import("../lib/hooks.mjs");
  assert.equal(unattended({ CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" }), false);
  assert.equal(unattended({ CLAUDE_CODE_ENTRYPOINT: "sdk-cli", CLAUDE_CODE_SESSION_ATTENDED: "0" }), true);
  assert.equal(unattended({ CLAUDE_CODE_SESSION_ATTENDED: "0" }), true);
  assert.equal(unattended({ CHAMBER_WOKEN: "maya/claude-code.web" }), true);
  const started = Date.now();
  assert.equal(await wait("claude-code.x", { env: { CLAUDE_CODE_SESSION_ATTENDED: "0" } }), 0);
  assert.ok(Date.now() - started < 500, "returns at once");
});

// ----- the skill and the app, for an agent setting Chamber up --------------------------------

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appProblem, installSkill, TEAM } from "../lib/app.mjs";
import { SKILL } from "../lib/skill.mjs";
import { SETUP } from "../relay/src/guide.js";

const repo = new URL("..", import.meta.url).pathname;

test("the shipped skill is the one in skills/chamber, and covers what a person asks for", () => {
  assert.equal(SKILL, readFileSync(join(repo, "skills/chamber/SKILL.md"), "utf8"), "run node scripts/skill.mjs");
  assert.match(SKILL, /^---\nname: chamber\ndescription: .+\n---\n/);
  for (const command of ["chamber doctor", "get.sh", "chamber deploy . --as", "chamber new --relay cloud", "chamber join '", "chamber invite <their name>", "chamber setup ", "chamber app", "chamber revoke"]) {
    assert.ok(SKILL.includes(command), command);
  }
  assert.match(SKILL, /Never send or post it yourself/);
  assert.match(SKILL, /only when your person gave it to you themselves/);
});

test("installSkill puts the skill only where a coding agent lives, and keeps it current", () => {
  const home = mkdtempSync(join(tmpdir(), "chamber-skill-"));
  try {
    assert.deepEqual(installSkill(home), []);
    mkdirSync(join(home, ".claude"));
    const [placed] = installSkill(home);
    assert.equal(placed, join(home, ".claude/skills/chamber/SKILL.md"));
    assert.ok(!existsSync(join(home, ".codex")));
    writeFileSync(placed, "old");
    installSkill(home);
    assert.equal(readFileSync(placed, "utf8"), SKILL);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("appProblem installs only an app signed by Chamber's developer and notarized", () => {
  const runner = (outcomes) => (cmd, args) => {
    const key = `${cmd} ${args[0]}`;
    const [status, text] = outcomes[key] ?? [0, ""];
    return { status, stdout: "", stderr: text };
  };
  const good = { "codesign -dv": [0, `Identifier=com.turalearn.chamber\nTeamIdentifier=${TEAM}\n`] };
  assert.equal(appProblem("/x/Chamber.app", runner(good)), null);
  assert.match(appProblem("/x", runner({ ...good, "codesign --verify": [1, "invalid"] })), /signature/);
  assert.match(appProblem("/x", runner({ "codesign -dv": [0, "TeamIdentifier=EVIL123456\n"] })), /Chamber's developer/);
  assert.match(appProblem("/x", runner({ "codesign -dv": [0, `TeamIdentifier=${TEAM}0\n`] })), /Chamber's developer/);
  assert.match(appProblem("/x", runner({ ...good, "spctl --assess": [3, "rejected"] })), /notarized/);
});

test("get.sh is valid sh and checks the app before installing it; the relay's guide has every way in", () => {
  assert.equal(spawnSync("sh", ["-n", join(repo, "get.sh")]).status, 0);
  const script = readFileSync(join(repo, "get.sh"), "utf8");
  assert.ok(script.includes(`TEAM="${TEAM}"`));
  for (const step of ["codesign --verify --deep --strict", "spctl --assess --type execute", "TeamIdentifier=$TEAM"]) assert.ok(script.includes(step), step);
  // codesign and spctl come before ditto copies anything into Applications
  assert.ok(script.indexOf("spctl --assess") < script.indexOf("ditto "));
  for (const way of ["chamber join '<their join link>'", "__RELAY__/install", "get.sh", "chamber app"]) assert.ok(SETUP.includes(way), way);
});
