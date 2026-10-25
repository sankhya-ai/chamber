#!/usr/bin/env bash
# Build the downloadable Mac app (Chamber.app and its .dmg) with its own Node inside, so the
# person who downloads it needs nothing installed.
#
#   desktop/bundle.sh             unsigned, for trying it out
#   desktop/bundle.sh --release   Developer ID signed, notarized and stapled: what you publish
#
# --release uses the same signing identity and notary profile as Tura's Mac app
# (see Plank/docs/tura-release.md). Override with CHAMBER_SIGNING_IDENTITY / CHAMBER_NOTARY_PROFILE.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/src-tauri"

RELEASE=false; [ "${1:-}" = "--release" ] && RELEASE=true
IDENTITY="${CHAMBER_SIGNING_IDENTITY:-Developer ID Application: Shreya Malaviya (986JMARB95)}"
PROFILE="${CHAMBER_NOTARY_PROFILE:-tura-notary}"
ENTITLEMENTS="$PWD/entitlements.plist"
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"

mkdir -p binaries
cp "$(command -v node)" "binaries/node-$TRIPLE"
npm --prefix ../../relay ci --silent
npm --prefix ../../ui ci --silent && npm --prefix ../../ui run build

if $RELEASE; then
  # Apple rejects a notarization if any executable inside is unsigned or lacks the hardened runtime.
  # Tauri signs the app and the node sidecar; sign everything bundled as a resource here.
  echo "Signing bundled executables…"
  find ../../relay/node_modules -type f -print0 | while IFS= read -r -d '' f; do
    if file -b "$f" | grep -q "Mach-O"; then
      codesign --force --options runtime --timestamp --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" "$f"
    fi
  done
  export APPLE_SIGNING_IDENTITY="$IDENTITY"
fi

CHAMBER_NODE="$(command -v node)" npx --yes @tauri-apps/cli@2 build --bundles app

# The disk image: the signed app and an Applications shortcut (hdiutil, not Tauri's Finder-scripted one).
OUT="target/release/bundle"
DMG="$OUT/dmg/chamber-darwin-arm64.dmg"
STAGE="$(mktemp -d)"
mkdir -p "$OUT/dmg"; rm -f "$DMG"
cp -R "$OUT/macos/Chamber.app" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -quiet -volname Chamber -srcfolder "$STAGE" -format UDZO -fs HFS+ "$DMG"
rm -rf "$STAGE"

if $RELEASE; then
  codesign --force --timestamp --sign "$IDENTITY" "$DMG"
  echo "Notarizing (a few minutes)…"
  xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
  xcrun stapler staple "$DMG"
  spctl -a -vvv -t exec "$OUT/macos/Chamber.app"
  xcrun stapler validate "$DMG"
fi

echo "Upload to R2: chamber/releases/stable/<version>/chamber-darwin-arm64.dmg  ($PWD/$DMG)"
