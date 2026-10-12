#!/bin/sh
# root-line installer, served by your relay:
#   curl -fsSL __RELAY__/install | sh -s -- <secret> [your-name]
# Installs the `root-line` command, joins the line, and puts the project you are
# in (if it is a git repository) on it.
set -e
RELAY="__RELAY__"
SECRET="$1"
NAME="$2"
if [ -z "$SECRET" ]; then
  echo "usage: curl -fsSL $RELAY/install | sh -s -- <secret> [your-name]" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "root-line needs Node.js 22.4 or newer: https://nodejs.org" >&2
  exit 1
fi
if ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 4) ? 0 : 1)'; then
  echo "root-line needs Node.js 22.4 or newer (you have $(node -v))" >&2
  exit 1
fi

APP="${ROOT_LINE_HOME:-$HOME/.root-line}/app"
mkdir -p "$APP/bin" "$APP/lib"
for file in __FILES__; do
  curl -fsSL "$RELAY/client/$file" -o "$APP/$file"
done
chmod +x "$APP/bin/line.mjs"

BIN="${ROOT_LINE_BIN:-$HOME/.local/bin}"
mkdir -p "$BIN"
printf '#!/bin/sh\nexec node "%s/bin/line.mjs" "$@"\n' "$APP" > "$BIN/root-line"
chmod +x "$BIN/root-line"

if [ -n "$NAME" ]; then
  node "$APP/bin/line.mjs" join "$RELAY/#$SECRET" --as "$NAME"
else
  node "$APP/bin/line.mjs" join "$RELAY/#$SECRET"
fi
if PROJECT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  node "$APP/bin/line.mjs" setup "$PROJECT"
else
  echo "Next: run 'root-line setup' inside each project whose Claude Code should be on the line."
fi
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) echo "Note: $BIN is not on your PATH. Add it, or run $BIN/root-line." ;;
esac
