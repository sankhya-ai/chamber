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

/**
 * Identity v2: the admin's certificate enrolling `owner` with THEIR public key on `line`.
 * The member generates the keypair on their own machine (identity.enrollOwner) and hands the
 * admin the PUBLIC half out-of-band; the private half is never part of the certificate, the
 * invite, or anything the admin signs. This cert rides the invite where a v1 pass rides.
 * With `enc` (the member's X25519 encryption public key) the certificate is v3: it ALSO binds
 * the key epoch keys are wrapped to. The signing key is never reused for encryption.
 */
export function issueCertificate(adminPrivate, line, owner, pubkey, enc = null, member = null) {
  // `member`: the invite pass's member id when certifying someone who joined with one, so the
  // name they hold, their removal, and their certificate all stay one member.
  member ||= b64(randomBytes(9));
  return signed(adminPrivate, enc ? { v: 3, line, member, owner: String(owner).toLowerCase(), pubkey, enc } : { v: 2, line, member, owner: String(owner).toLowerCase(), pubkey });
}

/** The raw public half of the admin's key (older admin records kept only the private half). */
export function adminPublicOf(state) {
  if (state?.adminPublic) return state.adminPublic;
  if (!state?.adminPrivate) return "";
  return b64(createPublicKey(createPrivateKey({ key: Buffer.from(state.adminPrivate, "base64url"), format: "der", type: "pkcs8" })).export({ format: "der", type: "spki" }).subarray(-32));
}

/** The admin's signed order to remove `owner` (and the pass they used), or to let the name back in.
 *  With `epoch` (v3), the revocation and the rotation ride ONE signed order: the relay drops the
 *  member and advances the trusted current epoch atomically, so no old-epoch send lands in between. */
export function revocation(adminPrivate, line, owner, op = "revoke", epoch = null) {
  return signed(adminPrivate, { line, owner, op, ...(epoch != null ? { epoch } : {}) });
}

/** The admin's signed order advancing the line's trusted current epoch (v3). Monotonic at the relay. */
export function rotation(adminPrivate, line, epoch) {
  return signed(adminPrivate, { line, op: "rotate", epoch });
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

import { checkEnrollClaims, enrollOwner, loadMemberKey, parseCert, passMember, verifyCertificate } from "./identity.mjs";
import { generateEpochKey, loadEpochs, saveEpoch } from "./epoch.mjs";
import { adminState, markAdmin, saveConfig } from "./inbox.mjs";
import { Invite, LineError, sealTicket } from "./protocol.mjs";

/** The join command for one new teammate: the chamber key, plus a fresh personal pass and the
 *  admin's public key (what every member checks certificates against) if the chamber uses
 *  personal invites. On a v3 chamber the pass is single-use: it asks to join once. */
export async function inviteCommand(config) {
  const state = adminState();
  await config.invite.ready();
  let key = config.invite.secret;
  if (state?.adminPrivate) key += `~${issuePass(state.adminPrivate, config.invite.lineId)}~${adminPublicOf(state)}`;
  return `curl -fsSL ${config.invite.relay}/install | sh -s -- ${key}`;
}

/** The invite code for one new teammate: paste it into Chamber Desktop's "Join a chamber". */
export async function inviteCode(config) {
  const state = adminState();
  await config.invite.ready();
  if (!state?.adminPrivate) return config.invite.withPass("").toString();
  return new Invite(config.invite.relay, config.invite.secret, issuePass(state.adminPrivate, config.invite.lineId), adminPublicOf(state)).toString();
}

// ----- verified (v3) chambers: making one, letting people in, removing them ---------------

async function adminOrder(config, claims) {
  const state = adminState();
  const response = await fetch(`${config.invite.relay}/v1/lines/${config.invite.lineId}/admin`, {
    method: "POST",
    headers: { ...config.invite.auth, "content-type": "application/json" },
    body: JSON.stringify({ order: signed(state.adminPrivate, { line: config.invite.lineId, ...claims }) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new LineError(result.error || `the relay answered ${response.status}`);
  return result;
}

/** Is this chamber verified (v3) from this machine's side: its invite carries a v3 certificate? */
export const isVerified = (config) => parseCert(config.invite.pass)?.v === 3;

/**
 * Make this chamber verified (v3): every member signs with their own key, and reads with keys the
 * admin hands out and rotates. New chambers do this right after they're made; an existing one with
 * `chamber upgrade` (teammates' apps then rejoin on their own, through the admin's app).
 *   1. the admin certifies their own keys (the admin is a member like any other),
 *   2. epoch 1's key is made and kept here before the relay is told (never a key the relay has
 *      started but nobody holds),
 *   3. one signed order turns the chamber v3 at epoch 1,
 *   4. team memory is sealed again under epoch 1 (it was under the shared chamber key).
 */
export async function secureChamber(config, { resealMemory = true } = {}) {
  const state = adminState();
  if (!state?.adminPrivate) throw new LineError("this chamber has no personal invites, so it can't verify members (chambers made with the app or `chamber new` have them)");
  const invite = config.invite;
  await invite.ready();
  const line = invite.lineId;
  const owner = config.owner;
  if (isVerified(config)) return { version: 3, already: true };
  const member = passMember(invite.pass);
  if (!member) throw new LineError("your own invite has no personal pass: re-run the setup that made this chamber");
  const info = await listMembers(config);
  enrollOwner(line, owner);
  const key = loadMemberKey(line, owner);
  const cert = issueCertificate(state.adminPrivate, line, owner, key.public, key.encPublic, member);
  const adopt = () => {
    invite.pass = cert;
    invite.adminPub = adminPublicOf(state);
    saveConfig(invite, owner);
  };
  if (info.version >= 3) {
    // Already v3 (this admin's own invite was replaced, e.g. setup ran again): certify yourself again.
    adopt();
    return { version: 3, epoch: info.epoch };
  }
  const epoch = Math.max(1, Number(info.epoch || 0) + 1);
  saveEpoch(line, owner, epoch, generateEpochKey());
  await adminOrder(config, { op: "upgrade", version: 3, epoch });
  adopt();
  markAdmin(invite, { distributed: epoch });
  let resealed = 0;
  if (resealMemory) resealed = await resealTeamMemory(config);
  return { version: 3, epoch, resealed };
}

/** Seal every team memory file again under the current epoch key (same text, a new version). */
async function resealTeamMemory(config) {
  const { TeamMemory } = await import("./memory.mjs");
  const memory = new TeamMemory(config.invite, `${config.owner}/admin`);
  for (let attempt = 0; attempt < 3; attempt++) {
    const files = await memory.all();
    const changes = Object.entries(files).map(([path, { version, text }]) => ({ path, text, base: version }));
    if (!changes.length) return 0;
    const result = await memory.commit(changes, "Sealed with the chamber's own keys (verified chamber)");
    if (result.ok) return changes.length;
  }
  return 0;
}

/** Members' certified encryption keys, from the relay's member list, each checked against the admin key. */
function certifiedMembers(config, info, state) {
  const out = [];
  for (const m of info.members || []) {
    const claims = m.cert ? verifyCertificate(adminPublicOf(state), m.cert, { line: config.invite.lineId, owner: m.owner }) : null;
    if (claims?.v === 3) out.push({ owner: m.owner, enc: claims.enc });
  }
  return out;
}

/**
 * The admin's app, every few seconds (or `chamber approve`): let in whoever asked to join, and keep
 * the epoch keys whole. For each request: it must open with the chamber key, be signed by the key
 * it names, use an unused invite pass, and ask for a name that's free. Then the certificate, a
 * sealed grant (the admin's public key, for members from before the upgrade), and every epoch key
 * this admin holds, wrapped to the newcomer alone (so they read the chamber's history too).
 * `client`: the admin's connected LineClient (key distributions are messages).
 */
export async function approvePending(config, client) {
  const state = adminState();
  if (!state?.adminPrivate || !isVerified(config)) return { approved: [], rejected: [] };
  const invite = config.invite;
  await invite.ready();
  const line = invite.lineId;
  const response = await fetch(`${invite.relay}/v1/lines/${line}/enroll/pending`, { headers: { ...invite.auth, "x-chamber-order": signed(state.adminPrivate, { line, op: "enroll-list" }) } });
  if (!response.ok) return { approved: [], rejected: [] };
  const { pending = [] } = await response.json();
  const out = { approved: [], rejected: [] };
  if (pending.length) {
    const info = await listMembers(config);
    for (const p of pending) {
      const claims = await invite.openFor(p.request, `enroll|${p.member}`).catch(() => null);
      const holder = claims && (info.members || []).find((m) => m.owner === claims.owner);
      const why = !claims
        ? "the request doesn't open with this chamber's key"
        : !checkEnrollClaims(claims, { line, member: p.member })
          ? "the request isn't signed by the key it asks for"
          : (info.removed || []).some((r) => r.owner === claims.owner)
            ? `the name ${claims.owner} was removed from this chamber`
            : holder && holder.member !== p.member
              ? `the name ${claims.owner} belongs to someone else here: join with another name`
              : "";
      if (why) {
        await postApproval(config, { op: "enroll-reject", member: p.member, reason: why });
        out.rejected.push({ member: p.member, owner: claims?.owner || null, reason: why });
        continue;
      }
      const cert = issueCertificate(state.adminPrivate, line, claims.owner, claims.pubkey, claims.enc, p.member);
      const grant = await invite.sealFor({ adminPub: adminPublicOf(state) }, `grant|${p.member}`);
      await postApproval(config, { op: "enroll", member: p.member, cert, grant });
      const epochs = loadEpochs(line, config.owner);
      for (const n of Object.keys(epochs.keys).map(Number).sort((a, b) => a - b)) {
        await client.sendDistribution(state.adminPrivate, n, epochs.keys[String(n)], [{ owner: claims.owner, enc: claims.enc }]);
      }
      out.approved.push(claims.owner);
    }
  }
  await healEpochs(config, client);
  return out;
}

async function postApproval(config, claims) {
  const state = adminState();
  const response = await fetch(`${config.invite.relay}/v1/lines/${config.invite.lineId}/enroll/approve`, {
    method: "POST",
    headers: { ...config.invite.auth, "content-type": "application/json" },
    body: JSON.stringify({ order: signed(state.adminPrivate, { line: config.invite.lineId, ...claims }) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new LineError(result.error || `the relay answered ${response.status}`);
  return result;
}

/**
 * Keep the epoch keys whole after an interruption: if the relay is at an epoch this admin holds no
 * key for (a removal committed, then the app quit before keeping the key), start a fresh epoch; if
 * the current epoch's key never reached the members (the distribution failed), send it again.
 */
export async function healEpochs(config, client) {
  const state = adminState();
  const line = config.invite.lineId;
  const info = await listMembers(config);
  if (info.version !== 3) return null;
  const mine = loadEpochs(line, config.owner);
  if (info.epoch > 0 && !mine.keys[String(info.epoch)]) return rotateEpoch(config, client, info);
  if (Number(state.distributed || 0) < info.epoch) {
    await client.sendDistribution(state.adminPrivate, info.epoch, mine.keys[String(info.epoch)], certifiedMembers(config, info, state));
    markAdmin(config.invite, { distributed: info.epoch });
    return { epoch: info.epoch, resent: true };
  }
  return null;
}

/** A fresh epoch for everyone certified now (no removal): the relay first, then the key to each. */
async function rotateEpoch(config, client, info) {
  const state = adminState();
  const epoch = Math.max(info.epoch, loadEpochs(config.invite.lineId, config.owner).current) + 1;
  const key = generateEpochKey();
  await adminOrder(config, { op: "rotate", epoch });
  saveEpoch(config.invite.lineId, config.owner, epoch, key);
  await client.sendDistribution(state.adminPrivate, epoch, key, certifiedMembers(config, info, state));
  markAdmin(config.invite, { distributed: epoch });
  return { epoch, rotated: true };
}

/**
 * Remove a teammate. On a v3 chamber this is always remove-and-rotate: one signed order removes
 * them and starts a new epoch together (the relay refuses either alone), then the new epoch's key
 * goes to everyone who stays. Whoever was removed keeps the keys they had - so they can still read
 * what they could read before - but nothing sent from now on.
 * `client`: the admin's connected LineClient (needed on v3 chambers, for the key distribution).
 */
export async function removeMember(config, owner, client = null) {
  owner = String(owner).toLowerCase();
  const info = await listMembers(config);
  if (info.version !== 3) return revoke(config, owner);
  if (!client) throw new LineError("removing someone from a verified chamber hands everyone else a new key: it needs the chamber connection");
  const state = adminState();
  const epoch = Math.max(info.epoch, loadEpochs(config.invite.lineId, config.owner).current) + 1;
  const key = generateEpochKey();
  const result = await revoke(config, owner, "revoke", epoch);
  saveEpoch(config.invite.lineId, config.owner, epoch, key);
  const staying = certifiedMembers(config, info, state).filter((m) => m.owner !== owner);
  await client.sendDistribution(state.adminPrivate, epoch, key, staying);
  markAdmin(config.invite, { distributed: epoch });
  return { ...result, epoch, rekeyed: staying.map((m) => m.owner) };
}

/**
 * A one-time join link for one teammate (relay v8+): `https://<relay>/join/<line>.<id>#<key>`.
 * The relay keeps their invite sealed and gives it out once, so the link is safe to paste into a
 * chat or a coding agent. Returns { link, expires }, or null on an older relay (use inviteCode).
 */
export async function createTicket(config, { name = null, days = 3 } = {}) {
  await config.invite.ready();
  const relay = config.invite.relay;
  const info = await fetch(`${relay}/v1/relay`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => ({}));
  if (!(Number(info.relay) >= 8)) return null;
  const state = adminState();
  const line = config.invite.lineId;
  const payload = { invite: await inviteCode(config), name: name ? String(name).toLowerCase() : null, from: config.owner, chamber: config.name || null };
  const ticket = await sealTicket(line, payload);
  const response = await fetch(`${relay}/v1/lines/${line}/tickets`, {
    method: "POST",
    headers: { ...config.invite.auth, ...(config.invite.pass ? { "x-chamber-pass": config.invite.pass } : {}), "content-type": "application/json" },
    body: JSON.stringify({
      id: ticket.id,
      sealed: ticket.sealed,
      ttlMs: Math.round(days * 24 * 3600 * 1000),
      order: state?.adminPrivate ? signed(state.adminPrivate, { op: "ticket", line, id: ticket.id }) : undefined,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new LineError(body.error || `the relay answered ${response.status}`);
  return { link: `${relay}/join/${line}.${ticket.id}#${ticket.key}`, expires: body.expires };
}

/**
 * What the admin sends one teammate: a message they paste into Claude Code or Codex, whose agent
 * then sets Chamber up for them (the relay's /setup.md says how). Falls back to the invite code on
 * an older relay.
 */
export async function inviteMessage(config, { name = null, days = 3 } = {}) {
  const ticket = await createTicket(config, { name, days });
  if (!ticket) {
    return { ticket: null, text: `Join our team's Chamber. Open the Chamber app, choose "Join a chamber" and paste this invite code (it's your personal key, keep it private):\n\n${await inviteCode(config)}` };
  }
  const when = new Date(ticket.expires).toUTCString().replace(/:\d\d GMT$/, " UTC");
  const text = [
    `Join our team's Chamber, where our coding agents ask each other things directly.`,
    `Paste this whole message into Claude Code or Codex, in one of your projects:`,
    ``,
    `  Set me up on my team's Chamber: read ${config.invite.relay}/setup.md and follow it.`,
    `  My one-time join link: ${ticket.link}`,
    ``,
    `(It works once and expires ${when}. Or paste just the link into the Chamber app under "Join a chamber".)`,
  ].join("\n");
  return { ticket, text };
}

/** The billing site for Chamber Cloud; a signed link proves the admin opened it (a day or two old at most). */
export const BILLING_SITE = "https://chamber.sankhyaailabs.com/billing";

/**
 * This chamber's plan on Chamber Cloud (trial, status, seats, members), or null when its relay isn't
 * hosted. For the admin, also the link to the billing page, signed with the admin key.
 */
export async function cloudPlan(config) {
  await config.invite.ready();
  const relay = config.invite.relay;
  try {
    const info = await (await fetch(`${relay}/v1/relay`, { signal: AbortSignal.timeout(5000) })).json();
    if (!info.hosted) return null;
  } catch {
    return null;
  }
  const response = await fetch(`${relay}/v1/hosted/status?line=${config.invite.lineId}`, { headers: config.invite.auth, signal: AbortSignal.timeout(5000) });
  if (!response.ok) return null;
  const { adminKey, account, ...plan } = await response.json();
  const state = adminState();
  const billing = state?.adminPrivate
    ? `${BILLING_SITE}?line=${config.invite.lineId}&proof=${encodeURIComponent(signed(state.adminPrivate, { op: "billing", line: config.invite.lineId }))}`
    : null;
  return { ...plan, admin: Boolean(state?.adminPrivate), billing };
}

/** Who holds which name, and who is online (personal invites only). */
export async function listMembers(config) {
  await config.invite.ready();
  const response = await fetch(`${config.invite.relay}/v1/lines/${config.invite.lineId}/members`, { headers: config.invite.auth });
  if (!response.ok) throw new LineError(`the relay answered ${response.status}`);
  return response.json();
}

/** Remove a teammate: their pass stops working and they are disconnected now. `op` "restore" lets the name back in.
 *  v3: pass `epoch` to rotate atomically with the removal (then distribute the new epoch to the rest). */
export async function revoke(config, owner, op = "revoke", epoch = null) {
  const state = adminState();
  if (!state?.adminPrivate) throw new LineError("this chamber has no personal invites (re-run create.sh to add them)");
  await config.invite.ready();
  const response = await fetch(`${config.invite.relay}/v1/lines/${config.invite.lineId}/admin`, {
    method: "POST",
    headers: { ...config.invite.auth, "content-type": "application/json" },
    body: JSON.stringify({ order: revocation(state.adminPrivate, config.invite.lineId, String(owner).toLowerCase(), op, epoch) }),
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
