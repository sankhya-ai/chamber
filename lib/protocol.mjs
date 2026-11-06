// The line's invite, keys and sealed messages: everything the relay must not see.
//
// An invite is `<relay url>/#<secret>`. The fragment never leaves this machine;
// the relay only learns what is derived from the secret for it:
//
//   token   = HMAC(secret, "chamber/token")   bearer for the relay
//   line id = sha256(token)[:32]                 the relay checks this, statelessly
//   key     = HMAC(secret, "chamber/key")      AES-256-GCM, never sent
//
// A body is sealed with its envelope (line, sender, recipient, id, reply_to) as
// associated data: the relay can route it but not read, alter, or re-attribute
// it. Byte-compatible with root's Python client (server/tura_code/line).

const enc = new TextEncoder();
export const AGENT = /^[a-z0-9][a-z0-9._-]{0,31}\/[a-z0-9][a-z0-9._-]{0,31}$/;
export const OWNER = /^[a-z0-9][a-z0-9._-]{0,31}$/;
export const INLINE_FILE_BYTES = 64 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export class LineError extends Error {}

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const unb64url = (text) => new Uint8Array(Buffer.from(text, "base64url"));

export class Invite {
  /** `pass`: this member's admin-signed pass (personal invites); empty on an open relay. */
  constructor(relay, secret, pass = "") {
    this.relay = relay.replace(/\/+$/, "");
    this.secret = secret;
    this.pass = pass;
  }

  static create(relay) {
    return new Invite(relay, b64url(crypto.getRandomValues(new Uint8Array(32))));
  }

  /** `https://<relay>/#<secret>`, or `…#<secret>~<pass>` for a personal invite. */
  static parse(text) {
    const [relay, key = ""] = String(text).trim().split("#");
    const [secret, pass = ""] = key.split("~");
    let url;
    try {
      url = new URL(relay);
    } catch {
      url = null;
    }
    if (!url || !/^https?:$/.test(url.protocol) || secret.length < 32) throw new LineError("an invite looks like https://<relay>/#<secret>");
    return new Invite(`${url.protocol}//${url.host}${url.pathname}`, secret, pass);
  }

  /**
   * What a person pastes to join: an invite code (`https://<relay>/#<secret>~<pass>`), or the
   * older `curl -fsSL https://<relay>/install | sh -s -- <secret>~<pass>` command.
   */
  static fromInput(text) {
    const input = String(text).trim();
    const curl = /(https?:\/\/[^\s'"|]+?)\/install\b[\s\S]*?sh -s --\s+([A-Za-z0-9._~-]+)/.exec(input);
    if (curl) return Invite.parse(`${curl[1]}/#${curl[2]}`);
    const link = /https?:\/\/[^\s'"]+#[^\s'"]+/.exec(input);
    // Only the key, copied without the relay address in front of it.
    if (!link && /^[A-Za-z0-9_-]{30,}(~[A-Za-z0-9._-]+)?$/.test(input.replace(/\s+/g, ""))) {
      throw new LineError("That invite is missing the start. Ask your admin to copy the whole invite code: it begins with https://");
    }
    return Invite.parse(link ? link[0] : input);
  }

  toString() {
    return `${this.relay}/#${this.secret}${this.pass ? `~${this.pass}` : ""}`;
  }

  /** The same chamber, with a member's pass. */
  withPass(pass) {
    return new Invite(this.relay, this.secret, pass);
  }

  /** Derive the token, line id and key (WebCrypto is async, so this is separate). */
  async ready() {
    if (this.lineId) return this;
    const mac = await crypto.subtle.importKey("raw", unb64url(this.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const derive = async (label) => new Uint8Array(await crypto.subtle.sign("HMAC", mac, enc.encode(`chamber/${label}`)));
    this.token = b64url(await derive("token"));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(this.token)));
    this.lineId = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    this.key = await crypto.subtle.importKey("raw", await derive("key"), "AES-GCM", false, ["encrypt", "decrypt"]);
    return this;
  }

  get wsUrl() {
    return `${this.relay.replace(/^http/, "ws")}/v1/lines/${this.lineId}/ws`;
  }

  blobUrl(blobId) {
    return `${this.relay}/v1/lines/${this.lineId}/blobs/${blobId}`;
  }

  syncUrl(since = 0, limit = 100) {
    return `${this.relay}/v1/lines/${this.lineId}/sync?since=${since}&limit=${limit}`;
  }

  coordinationUrl(sub = "") {
    return `${this.relay}/v1/lines/${this.lineId}/coordination${sub ? `/${sub}` : ""}`;
  }

  get auth() {
    return { Authorization: `Bearer ${this.token}` };
  }

  async #seal(data, aad) {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: enc.encode(aad) }, this.key, data));
    const out = new Uint8Array(12 + sealed.length);
    out.set(nonce);
    out.set(sealed, 12);
    return out;
  }

  async #open(raw, aad, what) {
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12), additionalData: enc.encode(aad) }, this.key, raw.slice(12)));
    } catch {
      throw new LineError(`${what} that does not open with this line's key`);
    }
  }

  #aad({ sender, to, id, replyTo }) {
    return [this.lineId, sender, to, id, replyTo || ""].join("|");
  }

  async seal(payload, meta) {
    return b64url(await this.#seal(enc.encode(JSON.stringify(payload)), this.#aad(meta)));
  }

  async open(body, meta) {
    return JSON.parse(new TextDecoder().decode(await this.#open(unb64url(body), this.#aad(meta), "a message")));
  }

  sealBlob(data, blobId) {
    return this.#seal(data, `${this.lineId}|blob|${blobId}`);
  }

  openBlob(raw, blobId) {
    return this.#open(raw, `${this.lineId}|blob|${blobId}`, "a file");
  }
}

// ----- join tickets: a one-time invite link (relay v8) ---------------------------------
//
//   https://<relay>/join/<line>.<ticket>#<key>
//
// The relay keeps the teammate's invite sealed with `key`, which only travels in the link's
// fragment, and gives the sealed copy out once. So the link can sit in Slack or in a coding
// agent's transcript: once used (or expired), it opens nothing.

export const TICKET_LINK = /(https?:\/\/[^\s'"#<>]+?)\/join\/([0-9a-f]{32})\.([0-9a-f]{32})#([A-Za-z0-9_-]{43})/;

async function ticketCipher(key) {
  const mac = await crypto.subtle.importKey("raw", unb64url(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const raw = new Uint8Array(await crypto.subtle.sign("HMAC", mac, enc.encode("chamber/ticket")));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** A new ticket: its id, its key, and its payload sealed for the relay to keep. */
export async function sealTicket(line, payload) {
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: enc.encode(`${line}|ticket|${id}`) }, await ticketCipher(key), enc.encode(JSON.stringify(payload))),
  );
  const out = new Uint8Array(12 + sealed.length);
  out.set(nonce);
  out.set(sealed, 12);
  return { id, key, sealed: b64url(out) };
}

/**
 * Use a join link: the relay hands its sealed invite over once. Returns { invite, name, from,
 * chamber }, or null when `text` holds no join link.
 */
export async function redeemTicket(text, { fetchImpl = fetch } = {}) {
  const match = TICKET_LINK.exec(String(text));
  if (!match) return null;
  const [, relay, line, id, key] = match;
  let response;
  try {
    response = await fetchImpl(`${relay}/v1/join/${line}/${id}`, { method: "POST", signal: AbortSignal.timeout(15000) });
  } catch {
    throw new LineError(`could not reach the chamber at ${relay}`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new LineError(body.error || `the chamber's relay answered ${response.status}`);
  let payload;
  try {
    const raw = unb64url(body.sealed);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12), additionalData: enc.encode(`${line}|ticket|${id}`) }, await ticketCipher(key), raw.slice(12));
    payload = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new LineError("that invite doesn't open with its key: copy the whole link, including the part after #");
  }
  const invite = await Invite.parse(payload.invite).ready();
  // The sealed invite must be for the chamber the link names.
  if (invite.lineId !== line || invite.relay !== relay.replace(/\/+$/, "")) throw new LineError("that invite is for a different chamber than its link says");
  return { invite, name: payload.name || null, from: payload.from || null, chamber: payload.chamber || null };
}

/** What a person pasted to join: a join link (redeemed now), an invite code, or an install command. */
export async function resolveInvite(text, options) {
  return (await redeemTicket(text, options)) ?? { invite: Invite.fromInput(text), name: null, from: null, chamber: null };
}

// ----- secrets never leave in a message -------------------------------------------------
//
// A last line of defence, under the agents' own care: a woken agent asked "what's in .env?", or one
// pasting a config to be helpful. Only patterns that are almost surely secrets are touched, so
// commit hashes, ids and paths go through as they are.

const MESSAGE_SECRETS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[private key redacted]"],
  [/\b(?:sk|rk)[-_](?:live|test|proj|ant(?:-api\d*)?)[-_][A-Za-z0-9_-]{16,}/g, "[redacted]"],
  [/\bsk-[A-Za-z0-9_-]{32,}/g, "[redacted]"],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g, "[redacted]"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "[redacted]"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[redacted]"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, "[redacted]"],
  [/\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g, "[redacted]"],
  // NAME=value where the name says it is a secret (.env files, shell exports, YAML)
  [/^(\s*(?:export\s+)?[A-Za-z0-9_.-]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIALS?|DATABASE_URL|DSN)[A-Za-z0-9_.-]*\s*[=:]\s*)(["']?)[^\s"'#]{6,}\2/gim, "$1[redacted]"],
  // a password inside a URL: scheme://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]{3,}@/gi, "$1[redacted]@"],
  // a chamber invite or join link's key
  [/(https?:\/\/[^\s#]+#)[A-Za-z0-9_-]{43}(?:~[A-Za-z0-9._-]+)?/g, "$1[redacted]"],
];

/** `text` with anything that is almost surely a secret replaced; `count` says how many. */
export function scrubSecrets(text) {
  let out = String(text ?? "");
  let count = 0;
  for (const [pattern, replacement] of MESSAGE_SECRETS) {
    out = out.replace(pattern, (...args) => {
      count++;
      return replacement.replace(/\$(\d)/g, (_, n) => args[Number(n)] ?? "");
    });
  }
  return { text: out, count };
}

/** Files that hold secrets by their name: never attached to a message. */
export const SECRET_FILE = /(^|[\\/])(\.env(\..*)?|\.npmrc|\.pypirc|\.netrc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|p12|pfx|keystore|jks)|credentials(\.json)?|.*service[-_]account.*\.json|secrets?\.(json|ya?ml|toml))$/i;
