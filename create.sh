#!/bin/sh
# Make your own chamber, in one command (for the admin: the person who invites the team):
#
#   curl -fsSL https://raw.githubusercontent.com/tura-learn/chamber/main/create.sh | sh
#
# Run it inside your project. It deploys your relay to your Cloudflare account (free plan),
# makes a chamber, joins you, puts this project's Claude Code in it, and prints the one
# command to send your team. Your relay serves only chambers made here.
#
# Optional: sh -s -- [your-name]      Re-run anytime to update the relay; your chamber stays.
set -e

NAME="${1:-}"
HOME_DIR="${CHAMBER_HOME:-$HOME/.chamber}"
SRC="$HOME_DIR/src"
REPO="${CHAMBER_REPO:-https://codeload.github.com/tura-learn/chamber/tar.gz/refs/heads/main}"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\nchamber: %s\n' "$*" >&2; exit 1; }

# ----- what it needs: Node 22.4+ (with npm) and curl --------------------------------
command -v node >/dev/null 2>&1 || fail "needs Node.js 22.4 or newer: https://nodejs.org"
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 4) ? 0 : 1)' \
  || fail "needs Node.js 22.4 or newer (you have $(node -v))"
command -v npm >/dev/null 2>&1 || fail "needs npm (it comes with Node.js)"
# Wrangler may need to ask you something (e.g. a workers.dev subdomain on a new account): use the
# terminal when there is one, even though this script's own input is the download.
if (: < /dev/tty) 2>/dev/null; then TTY=/dev/tty; else TTY=/dev/null; fi

# ----- 1. chamber's source, and wrangler (Cloudflare's tool) ------------------------
say "1/5  Getting chamber"
mkdir -p "$HOME_DIR"
TMP="$(mktemp -d)"
curl -fsSL "$REPO" | tar -xz -C "$TMP"
rm -rf "$SRC" && mv "$TMP"/* "$SRC" && rm -rf "$TMP"
(cd "$SRC/relay" && npm install --silent --no-audit --no-fund >/dev/null 2>&1) || fail "npm install failed in $SRC/relay"
WRANGLER="$SRC/relay/node_modules/.bin/wrangler"
wr() { (cd "$SRC/relay" && "$WRANGLER" "$@"); }

# ----- 2. your Cloudflare account ---------------------------------------------------------
say "2/5  Cloudflare"
if wr whoami 2>&1 | grep -qi "not authenticated"; then
  echo "A browser window opens: sign in to Cloudflare (a free account is fine) and allow access."
  wr login < "$TTY"
fi
wr whoami 2>&1 | grep -i "associated with" || true

# ----- 3. storage for files over 64 KB (optional: some accounts must enable R2 first) -----
say "3/5  File storage"
if wr r2 bucket list 2>/dev/null | grep -q "chamber-blobs" || wr r2 bucket create chamber-blobs >/dev/null 2>&1; then
  wr r2 bucket lifecycle add chamber-blobs expire-week "" --expire-days 7 --force >/dev/null 2>&1 || true
  echo "Ready: files up to 25 MB."
else
  echo "R2 is not enabled on this account, so files are limited to 64 KB."
  echo "(To allow bigger files: enable R2 in the Cloudflare dashboard, then run this again.)"
  awk '/^# Optional: files too big/{skip=1} !skip' "$SRC/relay/wrangler.toml" > "$SRC/relay/wrangler.toml.new"
  mv "$SRC/relay/wrangler.toml.new" "$SRC/relay/wrangler.toml"
fi

# ----- 4. the relay ------------------------------------------------------------------------
say "4/5  Deploying your relay"
LOG="$(mktemp)"
wr deploy < "$TTY" 2>&1 | tee "$LOG" | grep -E "https://|Uploaded|ERROR|✘" || true
RELAY="$(grep -Eo 'https://[a-zA-Z0-9.-]+\.workers\.dev' "$LOG" | head -1)"
rm -f "$LOG"
[ -n "$RELAY" ] || fail "the deploy did not print a workers.dev address (see above)"

# Your chamber: keep the one you have on this relay, else make one. Only chambers listed
# here may use the relay. Personal invites: your admin key signs each teammate's pass; the
# relay gets only its public half. Re-running keeps the key, so invites stay valid.
STATE="$HOME_DIR/relay.json"
SECRET="$(node -e '
  const fs = require("fs");
  try { const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); if (s.relay === process.argv[2] && s.secret) { console.log(s.secret); process.exit(0); } } catch {}
  try { const [relay, key] = JSON.parse(fs.readFileSync(process.argv[3], "utf8")).invite.split("/#"); if (relay === process.argv[2] && key) { console.log(key.split("~")[0]); process.exit(0); } } catch {}
  console.log(require("crypto").randomBytes(32).toString("base64url"));
' "$STATE" "$RELAY" "$HOME_DIR/config.json")"
LINE="$(node --input-type=module -e "
  const { Invite } = await import('$SRC/lib/protocol.mjs');
  console.log((await new Invite('$RELAY', '$SECRET').ready()).lineId);
")"
ADMIN="$(CHAMBER_HOME="$HOME_DIR" node --input-type=module -e "
  import { readFileSync, writeFileSync } from 'node:fs';
  const { newAdminKey, issuePass } = await import('$SRC/lib/admin.mjs');
  let s = {};
  try { s = JSON.parse(readFileSync('$STATE', 'utf8')); } catch {}
  const key = s.relay === '$RELAY' && s.adminPrivate ? { public: s.adminPublic, private: s.adminPrivate } : newAdminKey();
  writeFileSync('$STATE', JSON.stringify({ relay: '$RELAY', secret: '$SECRET', lines: ['$LINE'], adminPublic: key.public, adminPrivate: key.private }), { mode: 0o600 });
  console.log(key.public + ' ' + issuePass(key.private, '$LINE'));
")"
ADMIN_PUBLIC="${ADMIN%% *}"
ADMIN_PASS="${ADMIN#* }"
printf '%s' "$LINE" | wr secret put ALLOWED_LINES >/dev/null 2>&1 || fail "could not make the relay private (wrangler secret put)"
printf '%s' "$ADMIN_PUBLIC" | wr secret put ADMIN_KEY >/dev/null 2>&1 || fail "could not set up personal invites (wrangler secret put ADMIN_KEY)"
echo "Relay: $RELAY (private to your chamber)"

# ----- 5. join, and put this project in -------------------------------------------------------
say "5/5  Joining"
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS "$RELAY/install" -o /dev/null 2>/dev/null && break
  sleep 3
done
curl -fsSL "$RELAY/install" | sh -s -- "$SECRET~$ADMIN_PASS" $NAME

say "Done."
echo "You are this chamber's admin. Invite each teammate with their own command (a personal key):"
echo
echo "  chamber invite        (or Invite on the board)"
echo
echo "Remove someone anytime: chamber revoke <name>"
echo
echo "See every conversation: chamber board"
