// The board's API, served by `chamber board` on this machine.

import type { BoardData, Talk } from "./board.ts";

export interface Dream {
  ts: number;
  ms: number;
  ok: boolean;
  message: string;
  reason: string;
  inbox: number;
  steps: number;
  cost: number;
  model: string;
  changes: string[];
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      detail = (await response.json()).detail ?? detail;
    } catch {
      /* not JSON */
    }
    throw new Error(String(detail));
  }
  return response.json() as Promise<T>;
}

const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  board: () => request<BoardData>("/api/board"),
  talk: (id: string) => request<Talk>(`/api/board/talks/${encodeURIComponent(id)}`),
  say: (id: string, to: string, text: string) => post<{ id: string; thread: string }>(`/api/board/talks/${encodeURIComponent(id)}`, { to, text }),
  startTalk: (to: string, text: string, title: string) => post<{ id: string; thread: string }>("/api/board/talks", { to, text, title }),
  setDone: (id: string, done: boolean) => post<{ ok: boolean }>(`/api/board/talks/${encodeURIComponent(id)}/done`, { done }),
  channel: (op: "join" | "leave" | "add", name: string, owner?: string) => post<{ ok: boolean; channel: string }>("/api/board/channels", { op, name, owner }),
  addWorkspace: (path: string) => post<{ output: string }>("/api/board/workspaces", { path }),
  pickFolder: () => post<{ path?: string; cancelled?: boolean }>("/api/board/workspaces/pick"),
  removeWorkspace: (path: string) => post<{ output: string }>("/api/board/workspaces/remove", { path }),
  invite: () => request<{ command: string }>("/api/board/invite"),
  memory: () => request<{ files: { path: string; version: number; author: string; ts: number }[] }>("/api/board/memory"),
  memoryFile: (path: string, version = 0) => request<{ path: string; version: number; text: string | null }>(`/api/board/memory/file?path=${encodeURIComponent(path)}${version ? `&version=${version}` : ""}`),
  memoryHistory: () => request<{ commits: { seq: number; author: string; message: string; ts: number; changes: { path: string; from: number; to: number; deleted: boolean }[] }[] }>("/api/board/memory/history"),
  memorySearch: (q: string) => request<{ hits: { path: string; line: number; text: string }[] }>(`/api/board/memory/search?q=${encodeURIComponent(q)}`),
  dreams: () => request<{ dreams: Dream[]; running: { started: number; log: { kind: string; text: string; ts: number }[] } | null }>("/api/board/memory/dreams"),
  dream: () => post<{ started: boolean }>("/api/board/memory/dream"),
  settings: () => request<{ hasKey: boolean; dreamModel: string; lastDream: number }>("/api/board/settings"),
  saveSettings: (changes: { openrouterKey?: string; dreamModel?: string }) => post<{ hasKey: boolean; dreamModel: string; lastDream: number }>("/api/board/settings", changes),
  members: () => request<{ personal: boolean; members: { owner: string; online: boolean; since: number }[] }>("/api/board/members"),
  revoke: (owner: string) => post<{ ok: boolean }>("/api/board/revoke", { owner }),
  setName: (name: string) => post<{ name: string }>("/api/board/name", { name }),
};
