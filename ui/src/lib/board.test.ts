import assert from "node:assert/strict";
import { test } from "node:test";

import { address, ago, column, defaultRecipient, recipients, who, type Card, type Talk } from "./board.ts";

const card = (id: string, status: Card["status"], people: string[]): Card => ({
  id, title: id, status, people, with: people.filter((p) => !p.startsWith("ashish/")), count: 1, last: { from: people[0], text: "", ts: 0 }, updated: 0,
});

test("names read as people, not addresses", () => {
  assert.equal(who("ashish/board", "ashish"), "you");
  assert.equal(who("@ashish", "ashish"), "you");
  assert.equal(who("ashish/root", "ashish"), "your root");
  assert.equal(who("ashish/claude-code.api", "ashish"), "your Claude · api");
  assert.equal(who("nitin/claude-code.web", "ashish"), "Nitin's Claude · web");
  assert.equal(who("@nitin", "ashish"), "Nitin");
});

test("a workspace narrows the board to the talks its agent is in", () => {
  const cards = [card("a", "waiting", ["nitin/root", "ashish/claude-code.api"]), card("b", "waiting", ["nitin/root", "ashish/board"]), card("c", "done", ["ashish/claude-code.api"])];
  assert.deepEqual(column(cards, "waiting", null).map((c) => c.id), ["a", "b"]);
  assert.deepEqual(column(cards, "waiting", "ashish/claude-code.api").map((c) => c.id), ["a"]);
  assert.deepEqual(column(cards, "done", "ashish/claude-code.api").map((c) => c.id), ["c"]);
});

test("you reply to whoever spoke last, and can also prompt your own agents", () => {
  const talk: Talk = {
    ...card("t", "waiting", ["nitin/claude-code.web", "ashish/claude-code.api"]),
    messages: [
      { id: "1", from: "ashish/claude-code.api", to: "nitin/claude-code.web", text: "q", ts: 1, files: [] },
      { id: "2", from: "nitin/claude-code.web", to: "ashish/claude-code.api", text: "a", ts: 2, files: [] },
    ],
  };
  assert.equal(defaultRecipient(talk, "ashish"), "nitin/claude-code.web");
  const agents = [{ agent: "ashish/board" }, { agent: "ashish/claude-code.api" }, { agent: "nitin/root" }];
  assert.deepEqual(recipients(talk, "ashish", agents), ["nitin/claude-code.web", "@nitin", "nitin/root", "ashish/claude-code.api"]);
});

test("you can write to anyone, online or not: a name means that person", () => {
  assert.deepEqual(recipients(null, "ashish", [{ agent: "ashish/board" }], ["@nitin", "rohan/root"]), ["@nitin", "@rohan", "rohan/root"]);
  assert.equal(address(" Nitin "), "@nitin");
  assert.equal(address("nitin/root"), "nitin/root");
  assert.equal(address("@nitin"), "@nitin");
});

test("times are short", () => {
  assert.equal(ago(1000, 1000 + 10_000), "now");
  assert.equal(ago(0, 5 * 60_000), "5m");
  assert.equal(ago(0, 3 * 3_600_000), "3h");
});
