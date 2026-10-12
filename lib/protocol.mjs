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
  constructor(relay, secret) {
    this.relay = relay.replace(/\/+$/, "");
    this.secret = secret;
  }

  static create(relay) {
    return new Invite(relay, b64url(crypto.getRandomValues(new Uint8Array(32))));
  }

  static parse(text) {
    const [relay, secret = ""] = String(text).trim().split("#");
    let url;
    try {
      url = new URL(relay);
    } catch {
      url = null;
    }
    if (!url || !/^https?:$/.test(url.protocol) || secret.length < 32) throw new LineError("an invite looks like https://<relay>/#<secret>");
    return new Invite(`${url.protocol}//${url.host}${url.pathname}`, secret);
  }

  toString() {
    return `${this.relay}/#${this.secret}`;
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
