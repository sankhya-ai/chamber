import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { LineTools } from "../lib/mcp.mjs";
import { Inbox } from "../lib/inbox.mjs";
import { AwayResponder } from "../lib/away.mjs";

test("send_patch and review_patch: verifies git patches cleanly without applying", async () => {
  const tmpRepo = mkdtempSync(join(tmpdir(), "chamber-patch-repo-"));
  const tmpHome = mkdtempSync(join(tmpdir(), "chamber-patch-home-"));

  try {
    // Initialize git repo with initial commit
    spawnSync("git", ["init", "-q"], { cwd: tmpRepo });
    spawnSync("git", ["config", "user.name", "Tester"], { cwd: tmpRepo });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: tmpRepo });
    writeFileSync(join(tmpRepo, "file.txt"), "line 1\nline 2\nline 3\n");
    spawnSync("git", ["add", "file.txt"], { cwd: tmpRepo });
    spawnSync("git", ["commit", "-q", "-m", "initial commit"], { cwd: tmpRepo });

    const clientMock = {
      agent: "ashish/claude-code.web",
      invite: { relay: "http://example.com", secret: "0123456789abcdef0123456789abcdef", auth: {} },
      roster: [],
      channels: [],
      async send(to, text, options) {
        return { id: "patch-msg-1", to, thread: "patch-msg-1", ...options };
      },
    };

    const inbox = new Inbox("ashish/claude-code.web");
    // Mock the inbox dir to tmpHome
    inbox.dir = tmpHome;
    inbox.path = join(tmpHome, "inbox.jsonl");
    inbox.sentPath = join(tmpHome, "sent.jsonl");

    const tools = new LineTools(clientMock, inbox, tmpRepo);

    // Valid patch that changes line 2
    const validPatch = [
      "diff --git a/file.txt b/file.txt",
      "--- a/file.txt",
      "+++ b/file.txt",
      "@@ -1,3 +1,3 @@",
      " line 1",
      "-line 2",
      "+line 2 (updated)",
      " line 3",
      "",
    ].join("\n");

    const sentResult = await tools.call("send_patch", {
      to: "@nitin",
      patch: validPatch,
      description: "Update line 2 in file.txt",
      branch: "feat/line-update",
    });
    assert.match(sentResult, /Patch sent to @nitin/);

    // Simulate Nitin receiving the patch message in inbox
    inbox.add({
      id: "patch-msg-1",
      from: "ashish/claude-code.web",
      to: "@nitin",
      replyTo: null,
      thread: "patch-msg-1",
      title: "Patch: Update line 2",
      text: "Update line 2 in file.txt",
      type: "patch",
      patch: validPatch,
      branch: "feat/line-update",
      ts: Date.now(),
      files: [],
    });

    const reviewClean = await tools.call("review_patch", { message_id: "patch-msg-1" });
    assert.match(reviewClean, /✔ Patch applies cleanly/);

    // Now test a conflicting patch
    const conflictingPatch = [
      "diff --git a/file.txt b/file.txt",
      "--- a/file.txt",
      "+++ b/file.txt",
      "@@ -1,3 +1,3 @@",
      " completely wrong line",
      "-nonexistent",
      "+replacement",
      " line 3",
      "",
    ].join("\n");

    inbox.add({
      id: "patch-msg-2",
      from: "ashish/claude-code.web",
      to: "@nitin",
      replyTo: null,
      thread: "patch-msg-2",
      title: "Patch: Conflicting",
      text: "Broken patch",
      type: "patch",
      patch: conflictingPatch,
      ts: Date.now(),
      files: [],
    });

    const reviewConflict = await tools.call("review_patch", { message_id: "patch-msg-2" });
    assert.match(reviewConflict, /✖ Patch failed to apply cleanly/);
  } finally {
    rmSync(tmpRepo, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  }
});
