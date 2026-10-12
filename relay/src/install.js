// The one-command install: the relay serves the `root-line` client itself, so a
// teammate needs neither the repository nor anything but Node:
//
//   curl -fsSL https://<relay>/install | sh -s -- <secret> [name]
//
// The client files are bundled into the Worker as text at deploy time
// (wrangler.toml [[rules]]), so redeploying the relay updates what it installs.

import script from "./install.sh";
import bin from "../../bin/line.mjs";
import client from "../../lib/client.mjs";
import hooks from "../../lib/hooks.mjs";
import inbox from "../../lib/inbox.mjs";
import mcp from "../../lib/mcp.mjs";
import protocol from "../../lib/protocol.mjs";
import setup from "../../lib/setup.mjs";

const FILES = {
  "bin/line.mjs": bin,
  "lib/client.mjs": client,
  "lib/hooks.mjs": hooks,
  "lib/inbox.mjs": inbox,
  "lib/mcp.mjs": mcp,
  "lib/protocol.mjs": protocol,
  "lib/setup.mjs": setup,
};

const text = (body) => new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** The installer or a client file, or null when the path is neither. */
export function install(url) {
  if (url.pathname === "/install") {
    return text(script.replaceAll("__RELAY__", url.origin).replace("__FILES__", Object.keys(FILES).join(" ")));
  }
  const file = url.pathname.startsWith("/client/") ? FILES[url.pathname.slice("/client/".length)] : undefined;
  return file === undefined ? null : text(file);
}
