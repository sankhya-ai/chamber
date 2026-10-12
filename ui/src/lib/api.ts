// The board's API, served by `chamber board` on this machine.

import type { BoardData, Talk } from "./board.ts";

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
  addWorkspace: (path: string) => post<{ output: string }>("/api/board/workspaces", { path }),
  removeWorkspace: (path: string) => post<{ output: string }>("/api/board/workspaces/remove", { path }),
  invite: () => request<{ command: string }>("/api/board/invite"),
  setName: (name: string) => post<{ name: string }>("/api/board/name", { name }),
};
