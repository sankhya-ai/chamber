// The one-command install: the relay serves the `chamber` client itself, so a
// teammate needs neither the repository nor anything but Node:
//
//   curl -fsSL https://<relay>/install | sh -s -- <secret> [name]
//
// The client files are bundled into the Worker as text at deploy time
// (wrangler.toml [[rules]]), so redeploying the relay updates what it installs.

import script from "./install.sh";
import bin from "../../bin/chamber.mjs";
import client from "../../lib/client.mjs";
import hooks from "../../lib/hooks.mjs";
import inbox from "../../lib/inbox.mjs";
import mcp from "../../lib/mcp.mjs";
import protocol from "../../lib/protocol.mjs";
import setup from "../../lib/setup.mjs";
import board from "../../lib/board.mjs";
import admin from "../../lib/admin.mjs";
import dreamLib from "../../lib/dream.mjs";
import harnesses from "../../lib/harnesses.mjs";
import memory from "../../lib/memory.mjs";
import server from "../../lib/server.mjs";
import boardPage from "../../board/index.html";
import boardScript from "../../board/assets/board.mjs";
import boardStyle from "../../board/assets/board.css";

const FILES = {
  "bin/chamber.mjs": bin,
  "lib/client.mjs": client,
  "lib/hooks.mjs": hooks,
  "lib/inbox.mjs": inbox,
  "lib/mcp.mjs": mcp,
  "lib/protocol.mjs": protocol,
  "lib/setup.mjs": setup,
  "lib/board.mjs": board,
  "lib/admin.mjs": admin,
  "lib/dream.mjs": dreamLib,
  "lib/harnesses.mjs": harnesses,
  "lib/memory.mjs": memory,
  "lib/server.mjs": server,
  "board/index.html": boardPage,
  "board/assets/board.mjs": boardScript,
  "board/assets/board.css": boardStyle,
};

const text = (body) => new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** The installer or a client file, or null when the path is neither. */
export function install(url) {
  if (url.pathname === "/install" || url.pathname === "/new") {
    const mode = url.pathname === "/new" ? "new" : "join";
    return text(script.replaceAll("__RELAY__", url.origin).replace("__FILES__", Object.keys(FILES).join(" ")).replace("__MODE__", mode));
  }
  const file = url.pathname.startsWith("/client/") ? FILES[url.pathname.slice("/client/".length)] : undefined;
  return file === undefined ? null : text(file);
}
