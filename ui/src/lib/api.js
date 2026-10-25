// The board's API, served by `chamber board` on this machine.
let cachedSessionToken = "";
async function getSessionToken() {
    if (cachedSessionToken)
        return cachedSessionToken;
    try {
        const meta = document.querySelector('meta[name="chamber-token"]')?.content;
        if (meta) {
            cachedSessionToken = meta;
            return cachedSessionToken;
        }
    }
    catch { }
    try {
        const res = await fetch("/api/board/session");
        if (res.ok) {
            const data = await res.json();
            if (data?.token) {
                cachedSessionToken = data.token;
                return cachedSessionToken;
            }
        }
    }
    catch { }
    return "";
}
async function request(path, init = {}) {
    const token = await getSessionToken();
    const headers = {
        "Content-Type": "application/json",
        ...(token ? { "x-chamber-token": token } : {}),
        ...(init.headers ?? {}),
    };
    const response = await fetch(path, { ...init, headers });
    if (!response.ok) {
        let detail = response.statusText;
        try {
            detail = (await response.json()).detail ?? detail;
        }
        catch {
            /* not JSON */
        }
        throw new Error(String(detail));
    }
    return response.json();
}
const post = (path, body = {}) => request(path, { method: "POST", body: JSON.stringify(body) });
export const api = {
    board: () => request("/api/board"),
    session: () => request("/api/board/session"),
    talk: (id) => request(`/api/board/talks/${encodeURIComponent(id)}?seen=1`), // opening a talk marks it read
    say: (id, to, text, files = []) => post(`/api/board/talks/${encodeURIComponent(id)}`, { to, text, files }),
    startTalk: (to, text, title, files = []) => post("/api/board/talks", { to, text, title, files }),
    markDone: (id, done = true) => post(`/api/board/talks/${encodeURIComponent(id)}/done`, { done }),
    channel: (op, name, owner) => post("/api/board/channels", { op, name, owner }),
    addWorkspace: (path) => post("/api/board/workspaces", { path }),
    pickFolder: () => post("/api/board/workspaces/pick"),
    removeWorkspace: (path) => post("/api/board/workspaces/remove", { path }),
    invite: () => request("/api/board/invite"),
    memory: () => request("/api/board/memory"),
    memoryFile: (path, version = 0) => request(`/api/board/memory/file?path=${encodeURIComponent(path)}${version ? `&version=${version}` : ""}`),
    saveMemoryFile: (path, text, message, base) => post("/api/board/memory/file", { path, text, message, base }),
    memoryHistory: () => request("/api/board/memory/history"),
    memorySearch: (q) => request(`/api/board/memory/search?q=${encodeURIComponent(q)}`),
    dreams: () => request("/api/board/memory/dreams"),
    dream: () => post("/api/board/memory/dream"),
    settings: () => request("/api/board/settings"),
    saveSettings: (changes) => post("/api/board/settings", changes),
    members: () => request("/api/board/members"),
    revoke: (owner, op = "revoke") => post("/api/board/revoke", { owner, op }),
    setName: (name) => post("/api/board/name", { name }),
    search: (q, channel = "", type = "") => request(`/api/board/search?q=${encodeURIComponent(q)}${channel ? `&channel=${encodeURIComponent(channel)}` : ""}${type ? `&type=${encodeURIComponent(type)}` : ""}`),
    gates: () => request("/api/board/gates"),
    resolveGate: (gateId, decision, token) => post("/api/board/gates", { gateId, decision, token }),
    awayStatus: () => request("/api/board/away"),
    setAway: (enabled, status) => post("/api/board/away", { enabled, status }),
    reviewPatch: (patch, workspacePath) => post("/api/board/review_patch", { patch, workspacePath }),
    applyPatch: (patch, workspacePath) => post("/api/board/apply_patch", { patch, workspacePath }),
    coordinationTasks: (status, op) => request(`/api/board/coordination${status || op ? `?${status ? `status=${encodeURIComponent(status)}&` : ""}${op ? `op=${encodeURIComponent(op)}` : ""}` : ""}`),
    claimCoordination: (id, agent) => post("/api/board/coordination", { action: "claim", id, agent }),
    resolveCoordination: (id, resolution, evidence, contract) => post("/api/board/coordination", { action: "resolve", id, resolution, evidence, contract }),
    rejectCoordination: (id, reason) => post("/api/board/coordination", { action: "reject", id, reason }),
    quota: () => request("/api/board/quota"),
    joinOnboarding: (invite, as, project) => post("/api/board/onboarding/join", { invite, as, project }),
    newOnboarding: (relay, as, project) => post("/api/board/onboarding/new", { relay, as, project }),
    cloudflareAuth: () => request("/api/board/onboarding/cloudflare-auth"),
    cloudflareSetup: (as, project) => post("/api/board/onboarding/cloudflare-setup", { as, project }),
    detectHarnesses: () => request("/api/board/detect"),
    toggleReaction: (messageId, emoji) => post("/api/board/reactions", { messageId, emoji }),
    getUserStatus: () => request("/api/board/user_status"),
    setUserStatus: (emoji, text) => post("/api/board/user_status", { emoji, text }),
};
