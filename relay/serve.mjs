// The chamber relay on your own machine: a VM (e.g. Maritime), a server, or a spare computer.
// It runs the same Worker as the Cloudflare deploy (src/index.js and wrangler.toml) in workerd,
// Cloudflare's open-source runtime, through the wrangler pinned here, and keeps chambers,
// messages and files on disk.
//
//   node relay/serve.mjs                      http://0.0.0.0:8787, data in ~/.chamber-relay
//   PORT=9000 CHAMBER_RELAY_DATA=/srv/chamber node relay/serve.mjs
//
// Put HTTPS in front of it (vm.sh sets up Caddy when given a domain). The relay is unclaimed until
// the first "Create a chamber → Use my own server" claims it; from then on it serves only that chamber.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WRANGLER = join(HERE, "node_modules", "wrangler", "bin", "wrangler.js");
const DATA = process.env.CHAMBER_RELAY_DATA || join(homedir(), ".chamber-relay");
const PORT = String(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
mkdirSync(DATA, { recursive: true });

const args = [WRANGLER, "dev", "--local", "--ip", HOST, "--port", PORT, "--persist-to", DATA, "--show-interactive-dev-session=false", "--log-level", "warn"];
const child = spawn(process.execPath, args, {
  cwd: HERE,
  stdio: ["ignore", "inherit", "inherit"],
  // No usage reports or update checks from a server.
  env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_HIDE_BANNER: "true", CI: "1" },
});
console.log(`chamber relay starting on http://${HOST}:${PORT} (data: ${DATA})`);

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
