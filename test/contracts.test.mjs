// The contract registry: producers publish versions, consumers are notified and
// acknowledge — and "told" stays visibly separate from "adapted".

import assert from "node:assert/strict";
import { test } from "node:test";

import { ContractRegistry, REGISTRY_PATH } from "../lib/contracts.mjs";
import { DecisionLedger } from "../lib/decisions.mjs";
import { LineTools } from "../lib/mcp.mjs";

// A TeamMemory-shaped stub: whole files in a map, with memory.mjs's read/write/edit/commit
// semantics (a commit based on an old version is refused, as the relay does).
function stubMemory() {
  const files = new Map(); // path -> { version, text }
  return {
    async commit(changes) {
      for (const c of changes) if ((files.get(c.path)?.version ?? 0) !== c.base) return { ok: false, current: [] };
      for (const c of changes) files.set(c.path, { version: c.base + 1, text: c.text });
      return { ok: true };
    },
    async read(path) {
      const f = files.get(path);
      return f ? { path, ...f } : null;
    },
    async write(path, text) {
      const f = files.get(path) || { version: 0 };
      files.set(path, { version: f.version + 1, text });
      return { ok: true };
    },
    async edit(path, oldText, newText) {
      const f = files.get(path);
      if (!f?.text) return { ok: false, error: `no such file: ${path} (write it instead)` };
      const count = f.text.split(oldText).length - 1;
      if (count !== 1) return { ok: false, error: `the snippet matches ${count} times in ${path}` };
      files.set(path, { version: f.version + 1, text: f.text.replace(oldText, newText) });
      return { ok: true };
    },
  };
}

// A LineClient-shaped fake: records what would have been sent.
function fakeClient(agent) {
  const sent = [];
  return {
    sent,
    invite: null,
    agent,
    roster: [],
    channels: [],
    connected: true,
    async send(to, text, { title } = {}) {
      sent.push({ to, text, title });
      return { id: `m${sent.length}`, to, thread: `m${sent.length}`, held: false };
    },
  };
}

function lineTools(agent) {
  const client = fakeClient(agent);
  const tools = new LineTools(client, null, process.cwd());
  const memory = stubMemory();
  tools.memory = memory;
  tools.contracts = new ContractRegistry(memory, agent);
  tools.decisions = new DecisionLedger(memory, agent);
  return { tools, client, memory };
}

test("a producer registers a contract; names and duplicates are checked", async () => {
  const registry = new ContractRegistry(stubMemory(), "nitin/claude-code.api");
  await assert.rejects(() => registry.register({ name: "Auth Token", title: "x" }), /lowercase letters/);
  await assert.rejects(() => registry.register({ name: "auth-token", title: "" }), /title is required/);

  const { version } = await registry.register({ name: "auth-token", title: "Auth token response", summary: "expires_in: ISO string" });
  assert.equal(version, 1);
  await assert.rejects(() => registry.register({ name: "auth-token", title: "again" }), /already registered/);

  const entry = await registry.get("auth-token");
  assert.equal(entry.version, 1);
  assert.equal(entry.producer, "nitin/claude-code.api");
  assert.deepEqual(entry.consumers, []);
});

test("publish bumps the version, names the consumers to notify, and records the announcement", async () => {
  const registry = new ContractRegistry(stubMemory(), "nitin/claude-code.api");
  await registry.register({ name: "auth-token", title: "Auth token response" });

  const rohan = new ContractRegistry(registry.memory, "rohan/codex.web");
  await rohan.subscribe("auth-token");
  await rohan.subscribe("auth-token"); // idempotent
  assert.equal((await registry.get("auth-token")).consumers.length, 1);

  await assert.rejects(() => registry.publish({ name: "auth-token", summary: "" }), /say what changed/);
  await assert.rejects(() => rohan.publish({ name: "auth-token", summary: "sneaky" }), /only the producer publishes/);
  await assert.rejects(() => registry.publish({ name: "nope", summary: "x" }), /no contract/);

  const { entry, version, notify } = await registry.publish({ name: "auth-token", summary: "expires_at_epoch_seconds added alongside the ISO field", decision: "d-20261029-02" });
  assert.equal(version, 2);
  assert.deepEqual(notify, ["rohan/codex.web"]);
  assert.equal(entry.decision, "d-20261029-02");
  assert.deepEqual(entry.notices.at(-1).to, ["rohan/codex.web"]);
  assert.equal(entry.notices.at(-1).version, 2);
});

test("acks keep receipt (seen) separate from adaptation (adapted), and objections need a reason", async () => {
  const memory = stubMemory();
  const producer = new ContractRegistry(memory, "nitin/claude-code.api");
  await producer.register({ name: "auth-token", title: "Auth token response" });
  const consumer = new ContractRegistry(memory, "rohan/codex.web");
  await consumer.subscribe("auth-token");

  await assert.rejects(() => consumer.ack("auth-token", { stance: "maybe" }), /seen, adapted or object/);
  await assert.rejects(() => consumer.ack("auth-token", { stance: "object" }), /needs a reason/);
  await assert.rejects(() => consumer.ack("auth-token", { stance: "seen", version: 9 }), /cannot ack v9/);

  const outsider = new ContractRegistry(memory, "dev/codex.api");
  await assert.rejects(() => outsider.ack("auth-token", { stance: "seen" }), /does not consume/);

  await consumer.ack("auth-token", { stance: "seen" });
  await assert.rejects(() => consumer.ack("auth-token", { stance: "seen" }), /already recorded seen/);
  await consumer.ack("auth-token", { stance: "adapted", note: "contract tests pass both rollout orders" });
  await assert.rejects(() => consumer.ack("auth-token", { stance: "seen" }), /would overwrite evidence/);

  const { consumers } = await producer.status("auth-token");
  assert.equal(consumers.length, 1);
  assert.equal(consumers[0].state, "adapted");
  assert.equal(consumers[0].ack.note, "contract tests pass both rollout orders");
});

test("a new version makes every consumer outstanding again; session start lists only those", async () => {
  const memory = stubMemory();
  const producer = new ContractRegistry(memory, "nitin/claude-code.api");
  await producer.register({ name: "auth-token", title: "Auth token response" });
  const consumer = new ContractRegistry(memory, "rohan/codex.web");
  await consumer.subscribe("auth-token");
  await consumer.ack("auth-token", { stance: "adapted", note: "v1 done" });

  assert.deepEqual(await producer.pendingFor("rohan/codex.web"), []);
  assert.equal(await producer.bootstrapFor("rohan/codex.web"), "");

  await producer.publish({ name: "auth-token", summary: "epoch seconds added" });

  let { consumers } = await producer.status("auth-token");
  assert.equal(consumers[0].state, "outstanding");
  assert.equal(consumers[0].lastVersion, 1);

  const bootstrap = await producer.bootstrapFor("rohan/codex.web");
  assert.match(bootstrap, /auth-token v2: epoch seconds added/);
  assert.match(bootstrap, /nitin\/claude-code\.api/);
  assert.deepEqual(await producer.pendingFor("dev/codex.api"), []); // not a consumer

  await consumer.ack("auth-token", { stance: "adapted", note: "web/auth.ts prefers seconds, ISO fallback; tests pass" });
  ({ consumers } = await producer.status("auth-token"));
  assert.equal(consumers[0].state, "adapted");
  assert.equal(await producer.bootstrapFor("rohan/codex.web"), "");
});

test("an objection is a standing state, not a pending one", async () => {
  const memory = stubMemory();
  const producer = new ContractRegistry(memory, "nitin/claude-code.api");
  await producer.register({ name: "auth-token", title: "Auth token response" });
  const consumer = new ContractRegistry(memory, "rohan/codex.web");
  await consumer.subscribe("auth-token");

  await consumer.ack("auth-token", { stance: "object", note: "dropping the ISO field breaks every v1 web client" });
  const { consumers } = await producer.status("auth-token");
  assert.equal(consumers[0].state, "object");
  assert.deepEqual(await producer.pendingFor("rohan/codex.web"), []); // resolved to an exception, not nagged
});

test("unsubscribe stops notices; past acks stay on the record", async () => {
  const memory = stubMemory();
  const producer = new ContractRegistry(memory, "nitin/claude-code.api");
  await producer.register({ name: "auth-token", title: "Auth token response" });
  const consumer = new ContractRegistry(memory, "rohan/codex.web");
  await consumer.subscribe("auth-token");
  await consumer.ack("auth-token", { stance: "seen" });
  const { removed } = await consumer.unsubscribe("auth-token");
  assert.equal(removed, true);

  const { notify } = await producer.publish({ name: "auth-token", summary: "v2" });
  assert.deepEqual(notify, []);
  const entry = await producer.get("auth-token");
  assert.equal(entry.acks.length, 1); // history kept
});

test("through the MCP tools: publish notifies every subscriber, and outcomes reach the producer", async () => {
  const { tools: be, client: beClient } = lineTools("nitin/claude-code.api");
  assert.match(await be.call("contract", { action: "register", name: "auth-token", title: "Auth token response", summary: "expires_in ISO" }), /Registered auth-token \(v1\)/);

  const { tools: fe, client: feClient } = lineTools("rohan/codex.web");
  fe.memory = be.memory; // the same shared memory
  fe.contracts = new ContractRegistry(be.memory, "rohan/codex.web");
  assert.match(await fe.call("contract", { action: "subscribe", name: "auth-token" }), /Subscribed to auth-token/);

  // BE publishes: the consumer gets a short, self-sufficient notice through the normal message path.
  const published = await be.call("contract", { action: "publish", name: "auth-token", summary: "expires_at_epoch_seconds added alongside the ISO field", decision: "d-20261029-02" });
  assert.match(published, /Published auth-token v2/);
  assert.match(published, /Notified 1 consumer/);
  assert.equal(beClient.sent.length, 1);
  assert.equal(beClient.sent[0].to, "rohan/codex.web");
  assert.match(beClient.sent[0].title, /\[contract\] auth-token v2/);
  assert.match(beClient.sent[0].text, /action=ack name=auth-token version=2 stance=adapted/);
  assert.match(beClient.sent[0].text, /decision d-20261029-02/);

  // seen is receipt only: recorded, but the producer is not pinged for it.
  assert.match(await fe.call("contract", { action: "ack", name: "auth-token", stance: "seen" }), /seen/);
  assert.equal(feClient.sent.length, 0, "a seen ack stays quiet");

  // adapted carries evidence and tells the producer.
  assert.match(await fe.call("contract", { action: "ack", name: "auth-token", stance: "adapted", note: "web/auth.ts prefers seconds with ISO fallback; both rollout orders pass" }), /producer has been told/);
  assert.equal(feClient.sent.length, 1);
  assert.equal(feClient.sent[0].to, "nitin/claude-code.api");
  assert.match(feClient.sent[0].text, /adapted to auth-token v2/);
  assert.match(feClient.sent[0].text, /both rollout orders pass/);

  const status = await be.call("contract", { action: "status", name: "auth-token" });
  assert.match(status, /auth-token v2/);
  assert.match(status, /rohan\/codex\.web: ADAPTED — web\/auth\.ts prefers seconds/);
});

test("through the MCP tools: an objection requires a reason and reaches the producer", async () => {
  const { tools: be, client: beClient } = lineTools("nitin/claude-code.api");
  await be.call("contract", { action: "register", name: "auth-token", title: "Auth token response" });
  const { tools: fe, client: feClient } = lineTools("rohan/codex.web");
  fe.memory = be.memory;
  fe.contracts = new ContractRegistry(be.memory, "rohan/codex.web");
  await fe.call("contract", { action: "subscribe", name: "auth-token" });

  const refused = await be.call("contract", { action: "publish", name: "auth-token", summary: " " }).catch((e) => e);
  assert.match(String(refused.message), /say what changed/);

  await be.call("contract", { action: "publish", name: "auth-token", summary: "ISO field removed, epoch seconds only" });
  assert.equal(beClient.sent.length, 1);

  const objection = await fe.call("contract", { action: "ack", name: "auth-token", stance: "object", note: "breaks every v1 web client; propose a transition instead" });
  assert.match(objection, /objection is on the record/);
  assert.equal(feClient.sent.length, 1);
  assert.equal(feClient.sent[0].to, "nitin/claude-code.api");
  assert.match(feClient.sent[0].text, /objects to auth-token v2/);
  assert.match(feClient.sent[0].text, /propose a transition/);
});

test("a proposal affecting a registered contract points at the publish loop", async () => {
  const { tools: be } = lineTools("nitin/claude-code.api");
  await be.call("contract", { action: "register", name: "auth-token", title: "Auth token response" });
  const { tools: fe, client: feClient } = lineTools("rohan/codex.web");
  fe.memory = be.memory;
  fe.contracts = new ContractRegistry(be.memory, "rohan/codex.web");
  await fe.call("contract", { action: "subscribe", name: "auth-token" });

  const proposed = await be.call("decision", { action: "propose", title: "Add epoch seconds to the auth token response", affects: "api/auth/schema.py, contracts/auth-token" });
  assert.match(proposed, /auth-token has 1 subscribed consumer \(rohan\/codex\.web\)/);
  assert.match(proposed, /contract action=publish name=auth-token/);
});

test("a consumer subscribing while the producer publishes is kept, and told", async () => {
  const memory = stubMemory();
  const producer = new ContractRegistry(memory, "nitin/claude-code.api");
  await producer.register({ name: "auth-token", title: "Auth token response" });
  await new ContractRegistry(memory, "rohan/codex.web").subscribe("auth-token");
  await producer.publish({ name: "auth-token", summary: "expires_at added" });
  // Between the next publish's read and its commit, a second consumer subscribes.
  const read = memory.read.bind(memory);
  let raced = false;
  memory.read = async (path) => {
    const file = await read(path);
    if (!raced) {
      raced = true;
      await new ContractRegistry({ ...memory, read }, "dev/codex.jobs").subscribe("auth-token");
    }
    return file;
  };
  const { version, notify } = await producer.publish({ name: "auth-token", summary: "expires_at_epoch_seconds added" });
  memory.read = read;
  assert.equal(version, 3);
  assert.deepEqual(notify, ["rohan/codex.web", "dev/codex.jobs"]);
  assert.deepEqual((await producer.get("auth-token")).consumers.map((c) => c.agent), ["rohan/codex.web", "dev/codex.jobs"]);
});
