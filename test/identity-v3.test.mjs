// Identity v3 (brick three) end to end against the real relay (workerd, via `wrangler dev`):
// per-epoch READ keys on top of v2's signed attribution. The matrix from docs/identity-v2.md:
// authorized reads, unauthorized member/relay/cross-line reads, revocation + rotation,
// late-join history, join/revoke race, restart persistence, distribution authenticity,
// downgrade semantics. Stated everywhere: rotation is NOT retroactive - a revoked member keeps
// the epochs they already held; only messages sent AFTER the rotation are closed to them.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";

process.env.CHAMBER_HOME = mkdtempSync(join(tmpdir(), "chamber-v3-home-")); // member + epoch keys land here (0600)

const ROOT = resolve(import.meta.dirname, "..");
const WRANGLER = join(ROOT, "relay", "node_modules", ".bin", "wrangler");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (name) => mkdtempSync(join(tmpdir(), `chamber-v3-${name}-`));
const hex32 = () => randomBytes(16).toString("hex");
const clients = new Set();

const { Invite } = await import("../lib/protocol.mjs");
const { LineClient } = await import("../lib/client.mjs");
const { newAdminKey, issueCertificate, revocation } = await import("../lib/admin.mjs");
const identity = await import("../lib/identity.mjs");
const epochLib = await import("../lib/epoch.mjs");

let relay;
let relayProc;
const admin = newAdminKey();

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
  relayProc = spawn(WRANGLER, ["dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", tmp("relay"), "--var", `ADMIN_KEY:${admin.public}`], {
    cwd: join(ROOT, "relay"), stdio: "ignore", detached: true,
  });
  relay = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(relay)).ok) break;
    } catch {}
    await sleep(500);
  }
});

after(() => {
  for (const c of clients) c.close();
  if (relayProc) process.kill(-relayProc.pid, "SIGTERM");
});

/** A v3 member: signing + encryption keys on this machine (0600), the admin's v3 certificate. */
async function v3member(chamber, owner) {
  identity.enrollOwner(chamber.lineId, owner);
  const key = identity.loadMemberKey(chamber.lineId, owner);
  assert.ok(key.encPublic && key.encPrivate, "a v3 member key carries a separate X25519 encryption keypair");
  const cert = issueCertificate(admin.private, chamber.lineId, owner, key.public, key.encPublic);
  return { key, cert, invite: await chamber.withCertificate(cert, admin.public).ready() };
}

async function tryJoin(invite, agent, opts = {}) {
  const client = new LineClient(invite, agent, { kind: "human", listens: true, ...opts });
  clients.add(client);
  client.run();
  for (let i = 0; i < 60 && !client.connected && !client.problem; i++) await sleep(100);
  await sleep(200);
  return client;
}

async function waitFor(fn, what, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const value = fn();
    if (value) return value;
    await sleep(100);
  }
  assert.fail(`timed out waiting for ${what}`);
}

const wrapSet = (...members) => members.map((m) => ({ owner: m.owner, enc: m.key.encPublic }));

// ----- the shared v3 chamber ---------------------------------------------------------------------

let lineX, alice, bob, carol;
const E1 = epochLib.generateEpochKey();
const E2 = epochLib.generateEpochKey();

test("setup: a v3 chamber, epoch 1 distributed to two members, authorized reads", async () => {
  lineX = await Invite.create(relay).ready();
  alice = { owner: "ashish", ...(await v3member(lineX, "ashish")) };
  bob = { owner: "nitin", ...(await v3member(lineX, "nitin")) };
  alice.client = await tryJoin(alice.invite, "ashish/board");
  assert.equal(alice.client.connected, true);
  assert.equal(alice.client.lineVersion, 3, "the first v3 admit fixes the line at v3");
  assert.match(alice.client.identityNote, /v3/);
  assert.match(alice.client.identityNote, /not retroactive/, "the note states the revocation limit");
  bob.client = await tryJoin(bob.invite, "nitin/board");
  assert.equal(bob.client.connected, true);

  await alice.client.sendDistribution(admin.private, 1, E1, wrapSet(alice, bob));
  await waitFor(() => alice.client.epochs.current === 1 && bob.client.epochs.current === 1, "epoch 1 to land on both members");
  assert.equal(alice.client.epochs.keys["1"], E1, "the unwrapped key is the admin's epoch key");

  let got = null;
  alice.client.onMessage = (m) => (got = m);
  await bob.client.send("*", "epoch-one hello");
  got = await waitFor(() => got, "ashish to read nitin's epoch-1 message");
  assert.equal(got.text, "epoch-one hello");
});

test("1. a member without a wrap cannot read and cannot send (fail closed, never the shared key)", async () => {
  carol = { owner: "mia", ...(await v3member(lineX, "mia")) };
  carol.client = await tryJoin(carol.invite, "mia/board");
  assert.equal(carol.client.connected, true, "the relay admits her: attribution (v2) works for her");
  assert.equal(carol.client.epochs.current, 0, "but no epoch key was wrapped to her");
  let got = null;
  carol.client.onMessage = (m) => (got = m);
  await bob.client.send("*", "not for mia");
  await sleep(1500);
  assert.equal(got, null, "a v3 body does not open without the epoch key - she does not even see it");
  await assert.rejects(() => carol.client.send("*", "can i write?"), /epoch key/, "sending fails closed rather than falling back to the shared key");
});

test("2. ciphertext-only views: the shared key and the relay's rows open nothing v3", async () => {
  // The relay's stored rows (exactly what a relay operator holds)...
  const sync = await (await fetch(lineX.syncUrl(0), { headers: { ...lineX.auth, "x-chamber-pass": alice.cert } })).json();
  const bodies = (sync.messages || sync.rows || []).filter((m) => m.epoch >= 1);
  assert.ok(bodies.length >= 2, "epoch-sealed bodies are stored");
  for (const row of bodies) {
    assert.ok(!row.body.includes("hello") && !row.body.includes("mia"), "no plaintext in stored rows");
    // ...do not open with the SHARED invite key (what a revoked member or invite leaker holds)...
    await assert.rejects(() => lineX.open(row.body, { sender: row.from, to: row.to, id: row.id, replyTo: row.reply_to }), /does not open/);
  }
  // ...nor with the wrong epoch of the RIGHT key set.
  const row = bodies[0];
  await assert.rejects(() => lineX.open(row.body, { sender: row.from, to: row.to, id: row.id, replyTo: row.reply_to }, { n: 99, key: E1 }), /does not open/);
  // Cross-line: the same key material on another line's AAD opens nothing.
  const lineY = await Invite.create(relay).ready();
  const meta = { sender: "nitin/board", to: "*", id: row.id, replyTo: "" };
  await assert.rejects(() => lineY.open(row.body, meta, { n: 1, key: E1 }), /does not open/);
});

test("3. distribution authenticity: forged, tampered and stale distributions are ignored", async () => {
  const before = alice.client.epochs;
  // A distribution whose payload is signed by a MEMBER's key, not the admin's: ignored, even
  // though the transport frame itself is properly signed by that member.
  const evilKey = epochLib.generateEpochKey();
  await bob.client.sendDistribution(bob.key.private, 7, evilKey, wrapSet(alice));
  await sleep(1200);
  assert.equal(alice.client.epochs.current, before.current, "a member-signed distribution installs nothing");
  assert.equal(alice.client.epochs.keys["7"], undefined);
  // A tampered wrap (the admin's signature no longer matches): ignored.
  const wrap = await epochLib.wrapEpochKey(alice.key.encPublic, { line: lineX.lineId, epoch: 7, owner: "ashish", key: evilKey });
  const tampered = { line: lineX.lineId, epoch: 7, wraps: { ashish: { eph: wrap.eph, sealed: wrap.sealed.slice(0, -2) + "AA" } } };
  const sig = epochLib.signDistribution(admin.private, { line: lineX.lineId, epoch: 7, wraps: { ashish: wrap } }); // signed BEFORE tampering
  const payload = { type: "chamber-epoch", text: "", thread: "", ...tampered, sig };
  const id = hex32();
  const ts = Date.now();
  const sealed = await lineX.seal(payload, { sender: "ashish/board", to: "*", id, replyTo: null });
  await alice.client.testFrame({ t: "msg", seq: 91001, id, from: "ashish/board", to: "*", to_owner: null, reply_to: null, body: sealed, ts, epoch: 0, sig: identity.signEnvelope(alice.key.private, { line: lineX.lineId, from: "ashish/board", to: "*", id, replyTo: "", ts, hash: identity.bodyHash(sealed) }) });
  assert.equal(alice.client.epochs.keys["7"], undefined, "a tampered distribution installs nothing");
  // A legitimately signed re-distribution of an OLD epoch never rolls the current epoch back.
  await alice.client.sendDistribution(admin.private, 1, E1, wrapSet(alice, bob));
  await sleep(1200);
  assert.equal(alice.client.epochs.current, 1, "still 1 (epoch 2 has not happened yet)");
});

test("4. revocation + rotation: the revoked member keeps the past, loses the future", async () => {
  // The admin removes nitin at the relay AND rotates: epoch 2 wraps only ashish.
  const order = await fetch(`${relay}/v1/lines/${lineX.lineId}/admin`, { method: "POST", headers: { ...lineX.auth, "content-type": "application/json" }, body: JSON.stringify({ order: revocation(admin.private, lineX.lineId, "nitin") }) });
  assert.equal(order.status, 200);
  await alice.client.sendDistribution(admin.private, 2, E2, wrapSet(alice));
  await waitFor(() => alice.client.epochs.current === 2, "epoch 2 to land on ashish");
  for (let i = 0; i < 40 && bob.client.connected; i++) await sleep(100);
  assert.equal(bob.client.connected, false, "the revoked member's socket is dropped");

  await alice.client.send("*", "post-rotation secret");

  // NOT retroactive, stated and tested: nitin's client still holds epoch 1 and opens old bodies.
  await sleep(500); // let the relay store the epoch-2 message
  const sync = await (await fetch(lineX.syncUrl(0), { headers: { ...lineX.auth, "x-chamber-pass": alice.cert } })).json();
  const rows = (sync.messages || sync.rows || []).filter((m) => m.epoch >= 1);
  const oldRow = rows.find((r) => r.epoch === 1);
  const oldOpened = await lineX.open(oldRow.body, { sender: oldRow.from, to: oldRow.to, id: oldRow.id, replyTo: oldRow.reply_to }, { n: 1, key: bob.client.epochs.keys["1"] });
  assert.ok(oldOpened.text, "old ciphertext still opens with a key the revoked member already held - documented, not a leak");
  // ...but the future is closed: epoch-2 bodies do not open with anything nitin has.
  const newRow = rows.find((r) => r.epoch === 2);
  assert.ok(newRow, "the epoch-2 message is stored");
  await assert.rejects(() => lineX.open(newRow.body, { sender: newRow.from, to: newRow.to, id: newRow.id, replyTo: newRow.reply_to }, { n: 2, key: bob.client.epochs.keys["1"] }), /does not open/, "epoch-1 keys open nothing from epoch 2");
  // His client, injected with the epoch-2 frame directly, drops it silently.
  let bobGot = null;
  bob.client.onMessage = (m) => (bobGot = m);
  await bob.client.testFrame({ t: "msg", seq: 91002, id: newRow.id, from: newRow.from, to: "*", to_owner: null, reply_to: null, body: newRow.body, ts: newRow.ts, epoch: 2, sig: newRow.sig });
  assert.equal(bobGot, null, "no key for epoch 2: the frame is dropped, not delivered");
  // And he cannot rejoin or send: his certificate is dead (the relay side of revocation).
  const again = await tryJoin(bob.invite, "nitin/board");
  assert.equal(again.connected, false);
  assert.match(again.problem, /removed/);
  again.close();
});

test("5. late join + join/revoke race in one rotation: reads from the join epoch forward", async () => {
  // Carol (mia) was admitted but never wrapped; the admin's epoch-2 rotation (which removed
  // nitin) now ALSO adds mia - one distribution, the new membership set.
  await alice.client.sendDistribution(admin.private, 2, E2, wrapSet(alice, carol));
  await waitFor(() => carol.client.epochs.current === 2, "epoch 2 to reach mia");
  assert.equal(carol.client.epochs.keys["1"], undefined, "she was never wrapped epoch 1");
  // History before her join epoch stays closed even when replayed straight into her client.
  const sync = await (await fetch(lineX.syncUrl(0), { headers: { ...lineX.auth, "x-chamber-pass": alice.cert } })).json();
  const rows = (sync.messages || sync.rows || []).filter((m) => m.epoch >= 1);
  const oldRow = rows.find((r) => r.epoch === 1);
  let got = null;
  carol.client.onMessage = (m) => (got = m);
  await carol.client.testFrame({ t: "msg", seq: 91003, id: oldRow.id, from: oldRow.from, to: "*", to_owner: null, reply_to: null, body: oldRow.body, ts: oldRow.ts, epoch: 1, sig: oldRow.sig });
  assert.equal(got, null, "epoch-1 history does not open for a member wrapped from epoch 2");
  // ...while current traffic flows for her.
  await alice.client.send("*", "welcome mia");
  got = await waitFor(() => got, "mia reads epoch-2 traffic");
  assert.equal(got.text, "welcome mia");
});

test("6. restart persistence: a fresh client on the same machine reads and sends from disk", async () => {
  const restarted = await tryJoin(alice.invite, "ashish/board");
  assert.equal(restarted.connected, true);
  assert.equal(restarted.epochs.current, 2, "epoch keys loaded from the 0600 file, no new distribution needed");
  assert.equal(restarted.epochs.keys["2"], E2);
  let got = null;
  carol.client.onMessage = (m) => (got = m); // the relay never echoes to the sender; mia holds epoch 2
  await restarted.send("*", "after restart");
  got = await waitFor(() => got, "the restarted client sends under the current epoch");
  assert.equal(got.text, "after restart");
  assert.equal(statSync(epochLib.epochPath(lineX.lineId, "ashish")).mode & 0o777, 0o600, "the epoch key file is owner-only");
  restarted.close();
});

test("7. downgrade semantics: no silent path onto or off a v3 line", async () => {
  // A v2 certificate on the v3 line: explicit refusal, never shared-key reads.
  const dave = identity.enrollOwner(lineX.lineId, "dave");
  const daveKey = identity.loadMemberKey(lineX.lineId, "dave");
  const v2cert = issueCertificate(admin.private, lineX.lineId, "dave", daveKey.public); // no enc: v2
  const davesTry = await tryJoin(await lineX.withCertificate(v2cert, admin.public).ready(), "dave/board");
  assert.equal(davesTry.connected, false);
  assert.match(davesTry.problem, /needs chamber >= v3/);
  davesTry.close();
  void dave;
  // A v3 certificate on a v2 line: explicit mismatch, never silent v2.
  const lineV2 = await Invite.create(relay).ready();
  const eli = identity.enrollOwner(lineV2.lineId, "eli");
  const eliKey = identity.loadMemberKey(lineV2.lineId, "eli");
  const eliV2 = await tryJoin(await lineV2.withCertificate(issueCertificate(admin.private, lineV2.lineId, "eli", eliKey.public), admin.public).ready(), "eli/board");
  assert.equal(eliV2.connected, true);
  assert.equal(eliV2.lineVersion, 2, "the v2 line is claimed at v2 by the v2 certificate");
  const eliV3 = await tryJoin(await lineV2.withCertificate(issueCertificate(admin.private, lineV2.lineId, "fay", eliKey.public, eliKey.encPublic), admin.public).ready(), "fay/board");
  assert.equal(eliV3.connected, false);
  assert.match(eliV3.problem, /v2 but your certificate is v3/);
  eliV3.close();
  // requireV3 on a v2 line refuses instead of downgrading.
  const strict = await tryJoin(eliV2.invite, "eli/strict", { requireV3: true });
  assert.equal(strict.connected, false);
  assert.match(strict.problem, /v3 read scope was required/);
  strict.close();
  // requireV2 is SATISFIED by a v3 line (v3 includes v2's attribution).
  const ok = await tryJoin(alice.invite, "ashish/strict2", { requireV2: true });
  assert.equal(ok.connected, true);
  assert.equal(ok.lineVersion, 3);
  ok.close();
  eliV2.close();
});
