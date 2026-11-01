// Verified chambers as teams use them, end to end against the real relay (workerd, via
// `wrangler dev`): an existing chamber upgrades and its members rejoin on their own; teammates
// join with an ordinary invite and the admin's app lets them in; removing someone always hands
// everyone else a new key; what a removed member signed stays verifiable; a newcomer reads the
// history; keys outlive message retention; and the admin's keys heal after an interruption.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";

process.env.CHAMBER_HOME = mkdtempSync(join(tmpdir(), "chamber-flow-home-")); // the admin's records; everyone's keys (by name)

const ROOT = resolve(import.meta.dirname, "..");
const WRANGLER = join(ROOT, "relay", "node_modules", ".bin", "wrangler");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clients = new Set();

const { Invite } = await import("../lib/protocol.mjs");
const { LineClient } = await import("../lib/client.mjs");
const { issuePass, newAdminKey, removeMember, approvePending, secureChamber, revocation, rotation } = await import("../lib/admin.mjs");
const { loadConfig, markAdmin, saveConfig } = await import("../lib/inbox.mjs");
const { TeamMemory } = await import("../lib/memory.mjs");
const epochLib = await import("../lib/epoch.mjs");

const admin = newAdminKey();
let relay;
let relayProc;

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
  // MAX_MESSAGES: a tiny retention, so the test can show key distributions outlive it.
  relayProc = spawn(WRANGLER, ["dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", mkdtempSync(join(tmpdir(), "chamber-flow-relay-")), "--var", `ADMIN_KEY:${admin.public}`, "MAX_MESSAGES:12"], {
    cwd: join(ROOT, "relay"), stdio: "ignore", detached: true,
  });
  relay = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(relay)).ok) return;
    } catch {}
    await sleep(500);
  }
  assert.fail("relay did not start");
});

after(() => {
  for (const c of clients) c.close();
  if (relayProc) process.kill(-relayProc.pid, "SIGTERM");
});

async function waitFor(fn, what, tries = 100) {
  for (let i = 0; i < tries; i++) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  assert.fail(`timed out waiting for ${what}`);
}

function start(invite, agent, opts = {}) {
  const client = new LineClient(invite, agent, { kind: "human", listens: true, ...opts });
  clients.add(client);
  client.run();
  return client;
}

/** A teammate's invite, as `chamber invite` makes it: the chamber key, a personal pass, the admin's public key. */
const inviteFor = async (line, withAdminPub = true) => new Invite(relay, line.secret, issuePass(admin.private, line.lineId), withAdminPub ? admin.public : "").ready();

const order = (line, claims) => fetch(`${relay}/v1/lines/${line.lineId}/admin`, { method: "POST", headers: { ...line.auth, "content-type": "application/json" }, body: JSON.stringify({ order: claims }) });

let line, config, seat, nitin, nitinInvite, oldNitinPass;
const heard = [];

test("an existing unverified chamber upgrades; its members rejoin on their own and keep reading team memory", async () => {
  line = await Invite.create(relay).ready();
  // The chamber as it is today: v1, personal invites, the admin and a teammate connected, memory written.
  saveConfig(line.withPass(issuePass(admin.private, line.lineId)), "ashish");
  markAdmin(line, { adminPublic: admin.public, adminPrivate: admin.private });
  config = loadConfig();
  await config.invite.ready();
  seat = start(config.invite, "ashish/board", { onMessage: (m) => heard.push(m) });
  await seat.ready();
  assert.equal(seat.lineVersion, 1);
  nitinInvite = await inviteFor(line, false); // an invite from before: no admin public key in it
  oldNitinPass = nitinInvite.pass;
  nitin = start(nitinInvite, "nitin/board");
  await nitin.ready();
  assert.equal(nitin.lineVersion, 1);
  assert.equal((await new TeamMemory(config.invite, "ashish/test").write("MEMORY.md", "# Team\n- Billing is on Stripe\n", "seed")).ok, true);

  // `chamber upgrade`.
  const result = await secureChamber(config);
  assert.equal(result.version, 3);
  assert.equal(result.resealed, 1, "team memory is sealed again under the chamber's own key");
  assert.equal(JSON.parse(Buffer.from(loadConfig().invite.pass.split(".")[0], "base64url")).v, 3, "the admin's config now holds their certificate");

  // The admin's app reconnects verified; the teammate's app asks to join with the pass it has.
  await waitFor(() => seat.connected && seat.lineVersion === 3, "the admin's seat to come back verified");
  await waitFor(() => /waiting for the chamber's admin/.test(nitin.problem || ""), "the teammate to ask to join");
  const round = await approvePending(config, seat); // what the admin's app does every few seconds
  assert.deepEqual(round.approved, ["nitin"]);
  await waitFor(() => nitin.connected && nitin.lineVersion === 3, "the teammate to rejoin verified");
  assert.equal(nitinInvite.adminPub, admin.public, "the admin's public key arrived in the sealed grant");
  await waitFor(() => nitin.epochs.current === 1, "the teammate to hold epoch 1's key");

  // Memory: sealed under epoch 1 now, and the teammate reads it.
  const memory = await new TeamMemory(nitinInvite, "nitin/test").read("MEMORY.md");
  assert.match(memory.text, /Billing is on Stripe/);
  const raw = await (await fetch(`${relay}/v1/lines/${line.lineId}/memory/file?path=MEMORY.md`, { headers: { ...line.auth, "x-chamber-pass": nitinInvite.pass } })).json();
  assert.match(raw.body, /^e1\./, "the relay holds it sealed under epoch 1");
  // The old pass no longer opens memory, files, coordination or sync on a verified chamber.
  for (const path of ["memory", "coordination", "sync"]) {
    const refused = await fetch(`${relay}/v1/lines/${line.lineId}/${path}`, { headers: { ...line.auth, "x-chamber-pass": oldNitinPass } });
    assert.equal(refused.status, 403, `${path} refuses the pre-upgrade pass`);
  }

  // And talk is signed and sealed under the epoch.
  await nitin.send("@ashish", "hello from verified nitin");
  await waitFor(() => heard.some((m) => m.text === "hello from verified nitin"), "the admin to read it");
});

test("joining with an ordinary invite: the admin's app checks the name and lets them in", async () => {
  const carolInvite = await inviteFor(line);
  const carolPass = carolInvite.pass; // the client swaps it for her certificate once she's in
  const carol = start(carolInvite, "carol/board");
  await waitFor(() => /waiting for the chamber's admin/.test(carol.problem || ""), "carol to ask to join");
  // Someone asking for a name another member holds is declined, with the reason.
  const impostor = start(await inviteFor(line), "nitin/laptop");
  await waitFor(() => /waiting for the chamber's admin/.test(impostor.problem || ""), "the impostor to ask");
  const round = await approvePending(config, seat);
  assert.deepEqual(round.approved, ["carol"]);
  assert.match(round.rejected[0].reason, /belongs to someone else/);
  await waitFor(() => /declined.*belongs to someone else/.test(impostor.problem || ""), "the impostor to be told");
  impostor.close();
  await waitFor(() => carol.connected && carol.epochs.current === 1, "carol to be in, with the key");
  // A used invite asks to join once: the same pass can't get a second key certified...
  const enroll = (pass) => fetch(`${relay}/v1/lines/${line.lineId}/enroll`, { method: "POST", headers: { ...line.auth, "x-chamber-pass": pass, "content-type": "application/json" }, body: JSON.stringify({ request: "another machine's request" }) });
  assert.equal((await enroll(carolPass)).status, 409, "a used invite pass");
  // ...and a certificate (shown to every member) is never accepted as one.
  assert.equal((await enroll(carolInvite.pass)).status, 403, "a certificate is not an invite pass");
  await carol.send("*", "carol was here");
  await waitFor(() => heard.some((m) => m.text === "carol was here"), "the admin to read carol");
  carol.close();
});

test("removal on a verified chamber always rotates, and what the removed member signed stays verifiable", async () => {
  // The relay refuses a removal that doesn't start a new epoch (what older apps would send).
  const bare = await order(line, revocation(admin.private, line.lineId, "carol"));
  assert.equal(bare.status, 400);
  assert.match((await bare.json()).error, /must start a new epoch/);

  // `chamber revoke carol` / the app's Remove: remove + rotate in one order, then the new key to the rest.
  const result = await removeMember(config, "carol", seat);
  assert.equal(result.epoch, 2);
  assert.deepEqual(result.rekeyed.sort(), ["ashish", "nitin"]);
  await waitFor(() => nitin.epochs.current === 2, "nitin to hold epoch 2");
  assert.equal(epochLib.loadEpochs(line.lineId, "carol").keys["2"], undefined, "carol never gets epoch 2");
  await nitin.send("*", "after carol left");
  await waitFor(() => heard.some((m) => m.text === "after carol left"), "the admin to read it");

  // A fresh session replays the history: carol's message (signed before her removal) still verifies.
  const replay = [];
  const fresh = start(config.invite, "ashish/fresh", { cursorPath: join(mkdtempSync(join(tmpdir(), "chamber-flow-cur-")), "c.json"), onMessage: (m) => replay.push(m.text) });
  await fresh.ready();
  await waitFor(() => replay.includes("after carol left"), "the replay");
  assert.ok(replay.includes("carol was here"), "a removed member's past messages stay verifiable");
  fresh.close();
});

test("a newcomer gets every epoch's key (so they read the history), even after retention dropped the old messages", async () => {
  const daveInvite = await inviteFor(line);
  const asking = start(daveInvite, "dave/board");
  await waitFor(() => /waiting for the chamber's admin/.test(asking.problem || ""), "dave to ask");
  asking.close(); // dave's laptop sleeps before the admin's app gets to it
  assert.deepEqual((await approvePending(config, seat)).approved, ["dave"]);
  // Busy chamber: far more messages than the relay keeps (MAX_MESSAGES=12) arrive meanwhile.
  for (let i = 0; i < 20; i++) await nitin.send("*", `busy ${i}`);
  const dave = start(daveInvite, "dave/board");
  await waitFor(() => dave.connected && dave.epochs.current === 2, "dave to hold the current epoch");
  assert.ok(dave.epochs.keys["1"] && dave.epochs.keys["2"], "and every earlier one");
  const memory = await new TeamMemory(daveInvite, "dave/test").read("MEMORY.md");
  assert.match(memory.text, /Billing is on Stripe/, "so the team's memory opens for the newcomer");
  let got = null;
  dave.onMessage = (m) => (got = m);
  await nitin.send("@dave", "welcome dave");
  await waitFor(() => got?.text === "welcome dave", "dave to read new messages");
  dave.close();
});

test("the admin's keys heal: an epoch the relay started but nobody holds is replaced, and a lost handout is sent again", async () => {
  // The relay moved on to an epoch whose key this admin never kept (the app quit mid-removal).
  assert.equal((await order(line, rotation(admin.private, line.lineId, 3))).status, 200);
  await assert.rejects(nitin.send("*", "stale"), /stale epoch 2/);
  await approvePending(config, seat); // the app's next round
  await waitFor(() => nitin.epochs.current === 4, "a fresh epoch 4 to reach nitin");
  await nitin.send("*", "healed");
  await waitFor(() => heard.some((m) => m.text === "healed"), "the admin to read it");

  // The handout of the current epoch never landed (marked undistributed): the next round resends it.
  markAdmin(config.invite, { distributed: 3 });
  const before = (await (await fetch(`${relay}/v1/lines/${line.lineId}/members`, { headers: line.auth })).json()).epoch;
  await approvePending(config, seat);
  assert.equal((await (await fetch(`${relay}/v1/lines/${line.lineId}/members`, { headers: line.auth })).json()).epoch, before, "a resend, not a rotation");
});
