#!/bin/sh
# Install Chamber: the `chamber` command, and on a Mac the Chamber app (which brings its own Node).
# A coding agent runs this when its person asks it to set Chamber up (skills/chamber/SKILL.md).
#
#   curl -fsSL https://raw.githubusercontent.com/sankhya-ai/chamber/main/get.sh | sh
#
# Mac (Apple silicon): the latest release's app, only if it is signed by Chamber's developer
# (team 986JMARB95) and notarized by Apple; then ~/.local/bin/chamber runs the app's own copy.
# Elsewhere: needs Node 22.4+ and git; clones the repository to ~/.chamber/src.
# It never replaces a `chamber` command you already have.
set -eu

REPO="sankhya-ai/chamber"
TEAM="986JMARB95"
BIN="${CHAMBER_BIN:-$HOME/.local/bin}"
APPS="${CHAMBER_APPS:-/Applications}"  # where the app goes (~/Applications if that isn't writable)
say() { printf '%s\n' "$*"; }
fail() { printf 'chamber: %s\n' "$*" >&2; exit 1; }

link() { # write the chamber command, unless one is there already
  mkdir -p "$BIN"
  if [ -e "$BIN/chamber" ] && ! grep -qs "# chamber launcher" "$BIN/chamber"; then
    say "Keeping your existing $BIN/chamber."
    return
  fi
  printf '#!/bin/sh\n# chamber launcher (get.sh)\n%s\n' "$1" > "$BIN/chamber"
  chmod +x "$BIN/chamber"
}

if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then
  APP=""
  for candidate in "$APPS/Chamber.app" "$HOME/Applications/Chamber.app"; do
    if [ -f "$candidate/Contents/Resources/app/bin/chamber.mjs" ]; then APP="$candidate"; break; fi
  done
  if [ -z "$APP" ]; then
    TMP="$(mktemp -d)"
    trap 'hdiutil detach -quiet "$TMP/mnt" 2>/dev/null || true; rm -rf "$TMP"' EXIT
    say "Downloading the Chamber app..."
    curl -fsSL "https://github.com/$REPO/releases/latest/download/chamber-darwin-arm64.dmg" -o "$TMP/chamber.dmg"
    hdiutil attach -quiet -nobrowse -readonly -noautoopen -mountpoint "$TMP/mnt" "$TMP/chamber.dmg"
    NEW="$TMP/mnt/Chamber.app"
    codesign --verify --deep --strict "$NEW" 2>/dev/null || fail "the downloaded app's signature doesn't check out; not installing it"
    codesign -dv "$NEW" 2>&1 | grep -q "^TeamIdentifier=$TEAM\$" || fail "the downloaded app isn't signed by Chamber's developer; not installing it"
    spctl --assess --type execute "$NEW" 2>/dev/null || fail "macOS doesn't accept the downloaded app (not notarized); not installing it"
    DEST="$APPS"
    if [ ! -w "$DEST" ]; then DEST="$HOME/Applications"; mkdir -p "$DEST"; fi
    ditto "$NEW" "$DEST/Chamber.app"
    APP="$DEST/Chamber.app"
    say "Installed $APP (signed by Chamber's developer, notarized by Apple)."
  fi
  link "CHAMBER_BUNDLED=1 exec \"$APP/Contents/MacOS/node\" \"$APP/Contents/Resources/app/bin/chamber.mjs\" \"\$@\""
else
  command -v node >/dev/null 2>&1 || fail "Chamber needs Node.js 22.4 or newer: https://nodejs.org"
  node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 4) ? 0 : 1)' \
    || fail "Chamber needs Node.js 22.4 or newer (this is $(node -v))"
  command -v git >/dev/null 2>&1 || fail "Chamber needs git"
  SRC="${CHAMBER_SRC:-$HOME/.chamber/src}"
  if [ -d "$SRC/.git" ]; then git -C "$SRC" pull --quiet --ff-only || true
  else git clone --quiet --depth 1 "https://github.com/$REPO.git" "$SRC"; fi
  link "exec node \"$SRC/bin/chamber.mjs\" \"\$@\""
fi

# The chamber command, from any new terminal.
case ":$PATH:" in
  *":$BIN:"*) ;;
  *)
    case "$(basename "${SHELL:-sh}")" in
      zsh) RC="$HOME/.zshrc" ;;
      bash) RC="$HOME/.bashrc" ;;
      *) RC="$HOME/.profile" ;;
    esac
    grep -qs "# added by chamber" "$RC" || printf '\nexport PATH="%s:$PATH"  # added by chamber\n' "$BIN" >> "$RC"
    ;;
esac

say "Chamber is installed: $BIN/chamber"
say "Next: create a chamber (chamber deploy . --as <name>), or join one (chamber join '<link>')."
