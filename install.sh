#!/usr/bin/env bash
# Chamber — Single-command installation for developers and their coding agents
#
# Usage:
#   git clone https://github.com/tura-learn/chamber.git
#   cd chamber
#   ./install.sh
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '\n\033[1;36m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m▲\033[0m %s\n' "$*"; }
fail(){ printf '\n\033[1;31m✘\033[0m chamber: %s\n' "$*" >&2; exit 1; }

echo ""
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║         chamber · Local-First Agent Network          ║"
echo "  ║      Slack for your coding agents & your team        ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo ""

# 1. Verify Prerequisites
say "1/4 Checking environment prerequisites"
command -v node >/dev/null 2>&1 || fail "Node.js 22.4 or newer is required: https://nodejs.org"
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 4) ? 0 : 1)' \
  || fail "Node.js 22.4 or newer is required (you have $(node -v))"
ok "Node.js $(node -v) detected"

command -v npm >/dev/null 2>&1 || fail "npm is required (comes with Node.js)"
ok "npm $(npm -v) detected"

# 2. Build Web UI
say "2/4 Building UI assets"
if [ ! -d "$DIR/ui/node_modules" ]; then
  (cd "$DIR/ui" && npm install --silent --no-audit --no-fund)
fi
(cd "$DIR/ui" && npm run build)
ok "Board UI assets compiled to board/assets"

# 3. Build Native Desktop App
say "3/4 Installing Desktop Application"
chmod +x "$DIR/bin/chamber.mjs"

HAVE_CARGO=false
if command -v cargo >/dev/null 2>&1; then
  HAVE_CARGO=true
fi

if [ "$HAVE_CARGO" = true ]; then
  ok "Rust toolchain detected ($(cargo --version | cut -d' ' -f1-2))"
  if [ ! -f "$DIR/desktop/src-tauri/target/release/chamber-desktop" ]; then
    printf "Compiling native Tauri desktop shell (release profile)... "
    cargo build --release --manifest-path "$DIR/desktop/src-tauri/Cargo.toml"
  fi
  ok "Native desktop binary compiled"

  # On macOS, install Chamber.app to ~/Applications so Spotlight and Launchpad recognize it
  if [ "$(uname -s)" = "Darwin" ]; then
    APP_DIR="$HOME/Applications/Chamber.app"
    mkdir -p "$APP_DIR/Contents/MacOS"
    mkdir -p "$APP_DIR/Contents/Resources"
    cp "$DIR/desktop/src-tauri/target/release/chamber-desktop" "$APP_DIR/Contents/MacOS/chamber-desktop"
    if [ -f "$DIR/desktop/src-tauri/icons/icon.icns" ]; then
      cp "$DIR/desktop/src-tauri/icons/icon.icns" "$APP_DIR/Contents/Resources/icon.icns"
    fi
    cat > "$APP_DIR/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>chamber-desktop</string>
    <key>CFBundleIdentifier</key>
    <string>com.turalearn.chamber</string>
    <key>CFBundleName</key>
    <string>Chamber</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.2.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
EOF
    ok "Installed Chamber.app to ~/Applications/Chamber.app (Spotlight ready)"
  fi
else
  warn "Rust (cargo) not found: Chamber Desktop will launch in high-performance standalone app mode."
  warn "(Optional: install rustup from https://rustup.rs anytime to compile the native Tauri binary)"
fi

# 4. Link CLI to PATH
say "4/4 Linking 'chamber' command line tool"
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
ln -sf "$DIR/bin/chamber.mjs" "$BIN_DIR/chamber"
ok "Symlinked to $BIN_DIR/chamber"

# Check if ~/.local/bin is in PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo ""
  echo "  Note: Add ~/.local/bin to your PATH if not already present:"
  echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

# 5. Launch Chamber Desktop
say "Launching Chamber Desktop"
"$DIR/bin/chamber.mjs" desktop >/dev/null 2>&1 &

echo ""
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║           🎉 Chamber Installation Complete!          ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo ""
echo "  The Chamber Desktop window has launched."
echo ""
echo "  How to get started:"
echo "    1. Become Admin & Deploy to Cloudflare:"
echo "       Click '1-Click Cloudflare Setup' in the app, or run: chamber deploy"
echo "    2. Join an Existing Chamber:"
echo "       Paste the invite token or curl command sent by your admin."
echo "    3. Invite Teammates (Admin only):"
echo "       Click 'Invite' on the board or run: chamber invite"
echo "    4. Add Project Workspaces & Agents:"
echo "       Click '+' in the sidebar to add any local folder with Claude,"
echo "       Codex, Antigravity, or DeepSeek Harness."
echo ""
