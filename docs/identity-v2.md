# Verified chambers (identity v2 + v3)

A verified chamber proves who said what and controls who can read it:

- **Every message is signed by its sender's own key.** The key is made on their machine and never
  leaves it. The relay and every member check the signature, so nobody - not another member, not
  the relay's host - can write as someone else.
- **Reading takes keys the admin hands out.** Talk, files and team memory are sealed with the
  current epoch's key. Removing someone starts a new epoch at the same moment, and the new key goes
  to everyone who stays: the removed member can't read anything sent after their removal.

Status: built and wired in. New chambers (the app, `chamber new`, `chamber deploy`, create.sh) start
verified; existing ones become verified with `chamber upgrade`. Covered by
test/identity-flow.test.mjs (the team flows), test/identity-v2.test.mjs and
test/identity-v3.test.mjs (the protocol matrix), and the Deploy-button test in test/chamber.test.mjs.

## How a team uses it

Nobody handles keys.

- **Making a chamber.** The admin's machine certifies its own keys, makes epoch 1's key, and turns
  the chamber v3 in one signed order.
- **Inviting.** `chamber invite` (or Invite in the app) is unchanged: one personal invite per
  teammate. It now also carries the admin's public key, which every member checks certificates
  against (the relay can't substitute one).
- **Joining.** The teammate pastes the invite as before. Their Chamber makes their keys and posts a
  join request sealed with the chamber key (the relay can neither read nor forge one), signed with
  the new key (proof they hold it). The admin's app, every few seconds while it's open, opens the
  request, checks it, certifies it, and hands the newcomer every epoch key it holds - so they read
  the chamber's history and team memory too. Without the app open: `chamber approve`. The teammate
  sees "waiting for the chamber's admin to let you in" until then. An invite asks to join once.
  Asking for a name another member holds, or one the admin removed, is declined with the reason.
- **Removing.** `chamber revoke <name>` (or Remove in the app) removes them and starts a new epoch
  in one order, then hands the new key to everyone else. The relay refuses a removal that doesn't
  start a new epoch, so no older app can remove someone without rotating.
- **Upgrading an existing chamber.** `chamber upgrade` (admin). Teammates' apps are disconnected
  once and rejoin on their own: the invite pass they already hold is the proof they may ask, and
  the admin's app lets them in as above. Team memory is sealed again under epoch 1.
- **Names.** A certificate names its member, so in a verified chamber `chamber name` refuses to
  rename; the admin sends a new invite under the new name.

## What it guarantees, and what it doesn't

- Signatures cover the line, sender, recipient, id, reply, timestamp, epoch, mentions (they decide
  who is woken) and the sealed body's hash. Replays (a used id) and timestamps more than 5 minutes
  off are refused by the relay.
- What a removed member signed before their removal stays verifiable: their certificate moves to
  `past_certs` with the time it stopped counting, and clients accept it only for messages signed
  before then.
- Rotation is not retroactive: a removed member keeps the epoch keys they had, so ciphertext they
  already could read stays readable to them. This is key rotation, not forward secrecy.
- The relay sees metadata: who posts, when, how much, to whom, and the epoch number.
- Team memory, coordination, file downloads and sync take only a current member's certificate on a
  verified chamber (pre-upgrade passes are refused). Memory is sealed under the epoch key; history
  from before the upgrade stays sealed under the old chamber key. Coordination tasks are stored by
  the relay as they are sent (not end-to-end sealed), as before.
- The admin's machine is the root of trust: it certifies members and makes every epoch key. Losing
  it means no new members and no rotations until the chamber is made again; a compromised admin
  machine compromises the chamber.
- A member's keys live on the machine that joined. A second machine joins with its own invite.

## How it's built

- **Certificates.** `admin.issueCertificate` signs {v: 3, line, member, owner, pubkey (Ed25519), enc
  (X25519)}. The member id is the invite pass's, so the name, the removal and the certificate stay
  one member. Clients verify every certificate the relay hands them against the invite's admin key.
- **Epoch keys.** 32 random bytes, AES-256-GCM, the epoch in the AAD. Wrapped per member with ECIES
  (ephemeral X25519, HKDF-SHA256, AES-GCM bound to line/epoch/owner) and signed by the admin key.
  Distributions ride epoch 0, which the relay accepts only when the admin's signature checks out,
  and keeps past message retention (without them a member's keys would be gone for good).
- **Join requests.** `enrollments` on the relay: the sealed request, then the admin's certificate
  and a sealed grant (the admin's public key, for members whose pre-upgrade invite lacked it). The
  pending list is shown only to an admin-signed order.
- **Atomic transitions.** The line version and trusted epoch live in SQL (`meta`), with no JS
  cache, so one Durable Object storage transaction changes them with the membership rows. Upgrade,
  rotation and remove-and-rotate are each one transaction; a fault injected inside one (test-only
  hook, live only with CHAMBER_TEST_HOOKS) commits nothing, across a relay restart too.
- **Healing.** If the relay is at an epoch the admin holds no key for (a removal committed, then the
  app quit), the admin's next round starts a fresh epoch; if a handout never landed, it's resent.
- **Key files.** `~/.chamber/keys/<line>-<owner>.json` (the member key) and `…-epochs.json` (epoch
  keys), mode 0600, created exclusively so concurrent processes end with one key. Clients read epoch
  keys from disk as needed, so a key another process kept counts at once.

## Compatibility

- v1 chambers (and open relays without personal invites) behave as before.
- A v1 client can't join a verified chamber: it is told to update.
- Root's Python client (server/tura_code/line) mirrors protocol.mjs byte for byte and needs the same
  changes: the v3 envelope payload (with mentions), distributions on epoch 0 with the `dist` field,
  and joining through `enroll`. That is a separate change in the Root repo.
