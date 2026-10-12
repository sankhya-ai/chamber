// `chamber board`: the board in your browser, served from this machine only.
//
//   http://127.0.0.1:7878         the board (prebuilt, in ../board)
//   /api/board…                   cards, a conversation, saying something, done, workspaces, invite
//
// Only this machine can use it: it listens on 127.0.0.1, answers only to a
// localhost Host (no DNS rebinding), and takes changes only from its own page
// (same Origin, JSON bodies), so another website cannot drive it.

import { execFile } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { Board } from "./board.mjs";
import { HOME, loadConfig, rename } from "./inbox.mjs";
import { LineError } from "./protocol.mjs";
import { setup, teardown } from "./setup.mjs";

const STATIC = resolve(fileURLToPath(import.meta.url), "../../board");
const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 2_000_000) throw new LineError("too large");
  }
  return text ? JSON.parse(text) : {};
}

function serveFile(res, path) {
  res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream", "cache-control": "no-cache" });
  createReadStream(path).pipe(res);
}

/** `live.board` is the current Board: renaming yourself replaces it. */
export function handler(live, port) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return async (req, res) => {
    const board = live.board;
    try {
      if (!hosts.has(req.headers.host || "")) return json(res, 403, { detail: "Host not allowed." });
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;
      if (req.method !== "GET") {
        const origin = req.headers.origin;
        if ((origin && origin !== `http://${req.headers.host}`) || !String(req.headers["content-type"] || "").startsWith("application/json")) {
          return json(res, 403, { detail: "Only the board itself can do that." });
        }
      }

      if (path === "/api/board" && req.method === "GET") return json(res, 200, board.overview());
      if (path === "/api/board/invite") return json(res, 200, { command: board.invite() });
      if (path === "/api/board/name" && req.method === "POST") {
        rename(String((await body(req)).name || ""));
        board.close();
        live.board = new Board(loadConfig());
        live.board.start();
        return json(res, 200, { name: live.board.owner });
      }
      if (path === "/api/board/files") {
        const file = resolve(url.searchParams.get("path") || "");
        if (!file.startsWith(resolve(HOME, "agents") + sep) || !existsSync(file) || !statSync(file).isFile()) return json(res, 404, { detail: "No such file." });
        res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${file.split(sep).pop()}"` });
        return createReadStream(file).pipe(res);
      }
      if (path === "/api/board/workspaces" && req.method === "POST") {
        const target = String((await body(req)).path || "").trim();
        if (!target || !existsSync(target) || !statSync(target).isDirectory()) throw new LineError(`not a folder: ${target || "(empty)"}`);
        const result = setup(target);
        return json(res, 200, { output: `In the chamber as ${board.owner}/${result.name}. Restart Claude Code there.` });
      }
      if (path === "/api/board/workspaces/remove" && req.method === "POST") {
        const target = String((await body(req)).path || "").trim();
        if (!target) throw new LineError("which folder?");
        teardown(target);
        return json(res, 200, { output: "Removed." });
      }
      if (path === "/api/board/talks" && req.method === "POST") {
        const { to, text, title } = await body(req);
        return json(res, 200, await board.say(String(to || ""), String(text || ""), { title: String(title || "") }));
      }
      const talk = /^\/api\/board\/talks\/([^/]+)(\/done)?$/.exec(path);
      if (talk) {
        const id = decodeURIComponent(talk[1]);
        if (talk[2] && req.method === "POST") {
          board.setDone(id, (await body(req)).done !== false);
          return json(res, 200, { ok: true });
        }
        if (req.method === "POST") {
          const { to, text } = await body(req);
          return json(res, 200, await board.say(String(to || ""), String(text || ""), { thread: id }));
        }
        const found = board.conversation(id);
        return found ? json(res, 200, found) : json(res, 404, { detail: "No such conversation." });
      }
      if (path.startsWith("/api/")) return json(res, 404, { detail: "Not found." });

      // The board itself: a file from ../board, else its page.
      const file = resolve(STATIC, `.${path}`);
      if (path !== "/" && file.startsWith(STATIC + sep) && existsSync(file) && statSync(file).isFile()) return serveFile(res, file);
      if (!existsSync(join(STATIC, "index.html"))) return json(res, 500, { detail: "The board is not built (npm run build in ui/)." });
      return serveFile(res, join(STATIC, "index.html"));
    } catch (error) {
      return json(res, error instanceof LineError || error instanceof SyntaxError ? 400 : 500, { detail: String(error.message || error) });
    }
  };
}

function openBrowser(url) {
  const [cmd, ...args] = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  execFile(cmd, args, () => {});
}

/** Serve the board; if one is already running on the port, just open it. */
export async function serveBoard(config, { port = 7878, open = true } = {}) {
  const url = `http://127.0.0.1:${port}`;
  try {
    const running = await fetch(`${url}/api/board`, { signal: AbortSignal.timeout(1500) });
    if (running.ok) {
      console.log(`The board is already running: ${url}`);
      if (open) openBrowser(url);
      return 0;
    }
  } catch {}
  const live = { board: new Board(config) };
  live.board.start();
  const server = createServer(handler(live, port));
  await new Promise((done, fail) => server.once("error", fail).listen(port, "127.0.0.1", done));
  console.log(`Board: ${url}  (Ctrl-C to stop)`);
  if (open) openBrowser(url);
  await new Promise((done) => {
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, done);
  });
  live.board.close();
  server.close();
  return 0;
}
