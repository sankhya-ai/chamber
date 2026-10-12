// The admin's key: it signs each member's pass (a personal invite) and revocations.
//
//   pass       = b64url(JSON {v, line, member, iat}) "." b64url(Ed25519 signature)
//   revocation = b64url(JSON {v, line, owner, iat})  "." b64url(signature)
//
// The relay holds only the public key (secret ADMIN_KEY). A pass names a member, not a
// name: the relay ties a name to the first member to use it, so names stay changeable but
// nobody can take a teammate's. The private key stays in the admin's ~/.chamber/relay.json.

import { createPrivateKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";

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

/** The admin's signed order to remove `owner` (and the pass they used). */
export function revocation(adminPrivate, line, owner) {
  return signed(adminPrivate, { line, owner, op: "revoke" });
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

/** Who holds which name, and who is online (personal invites only). */
export async function listMembers(config) {
  await config.invite.ready();
  const response = await fetch(`${config.invite.relay}/v1/lines/${config.invite.lineId}/members`, { headers: config.invite.auth });
  if (!response.ok) throw new LineError(`the relay answered ${response.status}`);
  return response.json();
}

/** Remove a teammate: their pass stops working and they are disconnected now. */
export async function revoke(config, owner) {
  const state = adminState();
  if (!state?.adminPrivate) throw new LineError("this chamber has no personal invites (re-run create.sh to add them)");
  await config.invite.ready();
  const response = await fetch(`${config.invite.relay}/v1/lines/${config.invite.lineId}/admin`, {
    method: "POST",
    headers: { ...config.invite.auth, "content-type": "application/json" },
    body: JSON.stringify({ order: revocation(state.adminPrivate, config.invite.lineId, String(owner).toLowerCase()) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new LineError(result.error || `the relay answered ${response.status}`);
  return result;
}
