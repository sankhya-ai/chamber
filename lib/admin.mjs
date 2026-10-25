// The admin's key: it signs each member's pass (a personal invite) and revocations.
//
//   pass       = b64url(JSON {v, line, member, iat}) "." b64url(Ed25519 signature)
//   revocation = b64url(JSON {v, line, owner, iat})  "." b64url(signature)
//
// The relay holds only the public key (secret ADMIN_KEY). A pass names a member, not a
// name: the relay ties a name to the first member to use it, so names stay changeable but
// nobody can take a teammate's. The private key stays in the admin's ~/.chamber/relay.json.

import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";

const b64 = (bytes) => Buffer.from(bytes).toString("base64url");

/** A new admin key: `public` is the raw 32-byte key the relay verifies with. */
export function newAdminKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { public: b64(raw), private: b64(privateKey.export({ format: "der", type: "pkcs8" })) };
}

function signed(adminPrivate, claims) {
  const key = createPrivateKey({ key: Buffer.from(adminPrivate, "base64url"), format: "der", type: "pkcs8" });
  const body = b64(JSON.stringify({ v: 1, iat: Math.floor(Date.now() / 1000), ...claims }));
  return `${body}.${b64(sign(null, Buffer.from(body), key))}`;
}

/** A pass for one new member of the chamber `line`. */
export function issuePass(adminPrivate, line) {
  return signed(adminPrivate, { line, member: b64(randomBytes(9)) });
}

/** The admin's signed order to remove `owner` (and the pass they used), or to let the name back in. */
export function revocation(adminPrivate, line, owner, op = "revoke") {
  return signed(adminPrivate, { line, owner, op });
}

/** The admin signs a workflow file using Ed25519 with chamber line domain separation. */
export function signWorkflow(content, adminPrivate, { lineId = "" } = {}) {
  const key = createPrivateKey({ key: Buffer.from(adminPrivate, "base64url"), format: "der", type: "pkcs8" });
  const normalized = content.trim();
  const domain = `chamber-workflow-v1:${lineId}:${normalized}`;
  const sig = sign(null, Buffer.from(domain, "utf8"), key);
  const meta = JSON.stringify({ v: 1, line: lineId, sig: b64(sig) });
  return `# chamber-signature: ${b64(Buffer.from(meta, "utf8"))}\n${normalized}\n`;
}

/** Verify a workflow's Ed25519 signature against pinned admin public key. */
export function verifyWorkflow(signedContent, adminPublic, { lineId = "" } = {}) {
  const match = signedContent.match(/^# chamber-signature:\s*([A-Za-z0-9_-]+)\n([\s\S]*)$/);
  if (!match) return { valid: false, error: "Workflow missing admin signature header" };

  const [, b64Meta, body] = match;
  let meta;
  try {
    meta = JSON.parse(Buffer.from(b64Meta, "base64url").toString("utf8"));
  } catch {
    return { valid: false, error: "Invalid signature metadata" };
  }

  if (meta.v !== 1) return { valid: false, error: `Unsupported workflow signature version ${meta.v}` };
  if (lineId && meta.line && meta.line !== lineId) {
    return { valid: false, error: `Workflow signature line mismatch (expected ${lineId}, got ${meta.line})` };
  }

  try {
    const spkiHeader = Buffer.from("302a300506032b6570032100", "hex");
    const rawPub = Buffer.from(adminPublic, "base64url");
    const der = Buffer.concat([spkiHeader, rawPub]);
    const pubKey = createPublicKey({ key: der, format: "der", type: "spki" });

    const normalized = body.trim();
    const domain = `chamber-workflow-v1:${meta.line || lineId}:${normalized}`;
    const valid = verify(null, Buffer.from(domain, "utf8"), pubKey, Buffer.from(meta.sig, "base64url"));
    if (!valid) return { valid: false, error: "Signature verification failed" };
    return { valid: true, body: normalized, meta };
  } catch (err) {
    return { valid: false, error: `Verification error: ${err.message}` };
  }
}

// ----- what the admin does, from the CLI or the board --------------------------------

import { adminState } from "./inbox.mjs";
import { LineError } from "./protocol.mjs";

/** The join command for one new teammate: the chamber key, plus a fresh personal pass if the
 *  chamber uses personal invites. */
export async function inviteCommand(config) {
  const state = adminState();
  await config.invite.ready();
  let key = config.invite.secret;
  if (state?.adminPrivate) key += `~${issuePass(state.adminPrivate, config.invite.lineId)}`;
  return `curl -fsSL ${config.invite.relay}/install | sh -s -- ${key}`;
}

/** The invite code for one new teammate: paste it into Chamber Desktop's "Join a chamber". */
export async function inviteCode(config) {
  const state = adminState();
  await config.invite.ready();
  const pass = state?.adminPrivate ? issuePass(state.adminPrivate, config.invite.lineId) : config.invite.pass;
  return config.invite.withPass(state?.adminPrivate ? pass : "").toString();
}

/** Who holds which name, and who is online (personal invites only). */
export async function listMembers(config) {
  await config.invite.ready();
  const response = await fetch(`${config.invite.relay}/v1/lines/${config.invite.lineId}/members`, { headers: config.invite.auth });
  if (!response.ok) throw new LineError(`the relay answered ${response.status}`);
  return response.json();
}

/** Remove a teammate: their pass stops working and they are disconnected now. `op` "restore" lets the name back in. */
export async function revoke(config, owner, op = "revoke") {
  const state = adminState();
  if (!state?.adminPrivate) throw new LineError("this chamber has no personal invites (re-run create.sh to add them)");
  await config.invite.ready();
  const response = await fetch(`${config.invite.relay}/v1/lines/${config.invite.lineId}/admin`, {
    method: "POST",
    headers: { ...config.invite.auth, "content-type": "application/json" },
    body: JSON.stringify({ order: revocation(state.adminPrivate, config.invite.lineId, String(owner).toLowerCase(), op) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new LineError(result.error || `the relay answered ${response.status}`);
  return result;
}

/**
 * Claim an unclaimed relay for a new chamber: an admin key, proof of holding it, and the
 * admin's own pass. Returns { key, pass } when claimed, {} when the relay needs no claim
 * (already private through create.sh's secrets for this chamber, or an older relay).
 */
export async function claimRelay(invite) {
  await invite.ready();
  let state;
  try {
    state = await (await fetch(`${invite.relay}/v1/relay`)).json();
  } catch {
    throw new LineError(`no chamber relay at ${invite.relay}`);
  }
  if (state.claimed !== false) {
    if (state.claimed) throw new LineError("this relay already belongs to a chamber; ask its admin for an invite, or deploy your own");
    return {};
  }
  const key = newAdminKey();
  const response = await fetch(`${invite.relay}/v1/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminPublic: key.public, proof: signed(key.private, { op: "claim", line: invite.lineId }) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new LineError(body.error || `the relay answered ${response.status}`);
  return { key, pass: issuePass(key.private, invite.lineId) };
}
