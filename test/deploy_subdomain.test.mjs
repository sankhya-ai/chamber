// The workers.dev subdomain Chamber registers for a new Cloudflare account must be one Cloudflare accepts,
// whatever the computer's username looks like.

import assert from "node:assert/strict";
import { test } from "node:test";

import { subdomainName } from "../lib/deploy.mjs";

test("a workers.dev subdomain is lowercase, hyphen-trimmed and short enough, whatever the username", () => {
  const valid = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  for (const username of ["Ashish", "-root-", "First.Last", "a".repeat(100), "dev--", "", "ÜBER"]) {
    const name = subdomainName(username);
    assert.match(name, valid, `${JSON.stringify(username)} gave ${name}`);
  }
  assert.match(subdomainName("Ashish"), /^ashish-[0-9a-f]{4}$/);
  assert.match(subdomainName("!!!"), /^chamber-[0-9a-f]{6}$/);
});

// What wrangler printed on a teammate's Mac when their account had no workers.dev address (from a
// screenshot): colour codes, banner glyphs and a log path - shown raw in the app before.
const NO_SUBDOMAIN =
  "\x1b[33m▲ \x1b[43;33m[\x1b[43;30mWARNING\x1b[43;33m]\x1b[0m \x1b[1mYou need to register a workers.dev subdomain before publishing to workers.dev\x1b[0m\n\n" +
  "\x1b[31m✘ \x1b[41;31m[\x1b[41;97mERROR\x1b[41;31m]\x1b[0m \x1b[1mYou can either deploy your worker to one or more routes by specifying them in your wrangler.toml file, or register a workers.dev subdomain here:\x1b[0m\n\n" +
  "  \x1b[4mhttps://dash.cloudflare.com/dbf0178981b0acfadfbcef227a158750/workers/onboarding\x1b[0m\n\n" +
  "🪵  Logs were written to \"/Users/someone/Library/Preferences/.wrangler/logs/wrangler-2026-10-26_14-46-03_936.log\"\n";

test("wrangler's failures read as a sentence: no colour codes, glyphs or log paths", async () => {
  const { wranglerError } = await import("../lib/deploy.mjs");
  const said = wranglerError({ stderr: NO_SUBDOMAIN });
  assert.doesNotMatch(said, /\x1b|\[0m|▲|✘|Logs were written/);
  assert.match(said, /^You can either deploy your worker/);
  assert.equal(wranglerError({ stderr: "\x1b[31m✘ \x1b[41;31m[\x1b[41;97mERROR\x1b[41;31m]\x1b[0m \x1b[1mMore than one account available\x1b[0m" }), "More than one account available");
});

/** A stand-in for Cloudflare's subdomain API: GET says none yet; PUT answers `put`. */
function cloudflare(put) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
    if (!init.method) return new Response(JSON.stringify({ success: false, errors: [{ code: 10007, message: "workers.api.error.not_found" }] }), { status: 404 });
    return put(calls.length);
  };
  return { fetchImpl, calls };
}

test("a new account gets a workers.dev address registered for it, in the account the relay goes to", async () => {
  const { ensureWorkersSubdomain } = await import("../lib/deploy.mjs");
  const cf = cloudflare(() => new Response(JSON.stringify({ success: true, result: { subdomain: "x" } }), { status: 200 }));
  const steps = [];
  const result = await ensureWorkersSubdomain((s) => steps.push(s), null, "acc123", { fetchImpl: cf.fetchImpl, token: "tok" });
  assert.deepEqual(result, { ok: true });
  assert.equal(cf.calls[1].method, "PUT");
  assert.match(cf.calls[1].body.subdomain, /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
  assert.equal(cf.calls[1].auth, "Bearer tok");
  assert.match(steps[0], /Registering .*\.workers\.dev/);
});

test("when Cloudflare won't register one, the person is told why and exactly where to go", async () => {
  const { ensureWorkersSubdomain, subdomainHelp } = await import("../lib/deploy.mjs");
  const cf = cloudflare(() => new Response(JSON.stringify({ success: false, errors: [{ code: 10034, message: "Please verify your email address before creating a subdomain" }] }), { status: 400 }));
  const result = await ensureWorkersSubdomain(() => {}, null, "dbf0178981b0acfadfbcef227a158750", { fetchImpl: cf.fetchImpl, token: "tok" });
  assert.equal(result.ok, false);
  assert.equal(cf.calls.filter((c) => c.method === "PUT").length, 2, "a second, random name is tried");
  assert.match(result.reason, /verify your email/);
  const help = subdomainHelp("dbf0178981b0acfadfbcef227a158750", result.reason);
  assert.match(help, /https:\/\/dash\.cloudflare\.com\/dbf0178981b0acfadfbcef227a158750\/workers\/onboarding/);
  assert.match(help, /verify your email address first/);
  assert.match(help, /press Create chamber again/);
  assert.doesNotMatch(help, /\x1b/);
});

test("without a sign-in token or account, it says so instead of failing silently", async () => {
  const { ensureWorkersSubdomain } = await import("../lib/deploy.mjs");
  assert.match((await ensureWorkersSubdomain(() => {}, null, null, { token: "tok" })).reason, /which Cloudflare account/);
});
