// Chamber installs as a plugin in two shapes from this one repository:
//
//   Claude Code      .claude-plugin/plugin.json + .claude-plugin/marketplace.json
//   Codex / ChatGPT  the portable Agent Plugins manifest at plugin.json, discovered through
//                    the repo marketplace at .agents/plugins/marketplace.json
//
// Both point at the same skill (skills/chamber). These checks keep every manifest valid JSON,
// every path they name on disk, and the versions in step, so a rename somewhere doesn't turn
// an install command from the README into a plugin that doesn't load.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const has = (path) => existsSync(join(ROOT, path));

test("the Claude Code plugin manifest and its marketplace agree", () => {
  const plugin = read(".claude-plugin/plugin.json");
  assert.equal(plugin.name, "chamber");
  assert.match(plugin.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case");
  assert.ok(plugin.description, "what the person sees in /plugin");
  const market = read(".claude-plugin/marketplace.json");
  assert.ok(market.name && market.owner?.name, "marketplace identity");
  const names = market.plugins.map((p) => p.name);
  assert.deepEqual(names, [...new Set(names)], "no duplicate plugins");
  for (const entry of market.plugins) {
    const source = typeof entry.source === "string" ? entry.source : entry.source?.path;
    assert.ok(source?.startsWith("./"), `${entry.name}: source stays in this repository`);
    assert.ok(has(join(source, ".claude-plugin/plugin.json")), `${entry.name}: ${source} holds a plugin`);
  }
});

test("the portable Agent Plugins manifest (Codex, ChatGPT) is complete and in step", () => {
  const plugin = read("plugin.json");
  const claude = read(".claude-plugin/plugin.json");
  assert.equal(plugin.name, claude.name, "one plugin, one name on every host");
  assert.equal(plugin.version, claude.version, "versions move together");
  assert.ok(plugin.description && plugin.license, "directory metadata");
  const openai = plugin.extensions?.["com.openai"];
  assert.ok(openai, "OpenAI presentation");
  assert.ok(has(openai.onboardingSkill), `onboarding skill at ${openai.onboardingSkill}`);
  for (const key of ["composerIcon", "logo"]) assert.ok(has(openai.interface[key]), `${key} at ${openai.interface[key]}`);
  assert.ok(has("skills/chamber/SKILL.md"), "hosts discover the skill from skills/");
});

test("the Codex repo marketplace lists only plugins that are there", () => {
  const market = read(".agents/plugins/marketplace.json");
  assert.ok(market.name, "the marketplace's own name");
  for (const entry of market.plugins) {
    assert.ok(entry.name, "plugin name");
    assert.ok(entry.policy?.installation && entry.policy?.authentication, `${entry.name}: install policy`);
    assert.ok(entry.category, `${entry.name}: category`);
    const path = typeof entry.source === "string" ? entry.source : entry.source?.path;
    assert.ok(path?.startsWith("./"), `${entry.name}: path stays in this repository`);
    assert.ok(has(join(path, "plugin.json")), `${entry.name}: ${path} holds a portable manifest`);
  }
});

test("the skill every host loads has the frontmatter hosts require", () => {
  const skill = readFileSync(join(ROOT, "skills/chamber/SKILL.md"), "utf8");
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(frontmatter, "frontmatter block");
  assert.match(frontmatter[1], /^name: chamber$/m);
  assert.match(frontmatter[1], /^description: .+/m);
});
