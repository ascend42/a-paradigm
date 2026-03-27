#!/bin/bash
# build-conductor.sh — Build Paradigm Conductor as a macOS .app bundle
#
# Usage:
#   ./build-conductor.sh                          # Build only
#   ./build-conductor.sh --install                # Build + copy to /Applications
#   ./build-conductor.sh --install --force        # Kill running instance + install
#   ./build-conductor.sh --sign-identity "Dev ID" # Sign with Developer ID
#   ./build-conductor.sh --enable-autolaunch      # Install LaunchAgent for login start
#   ./build-conductor.sh --disable-autolaunch     # Remove LaunchAgent

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
APP_BUNDLE="$BUILD_DIR/Conductor.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"

# Parse arguments
INSTALL=false
FORCE=false
SIGN_IDENTITY="-"
ENABLE_AUTOLAUNCH=false
DISABLE_AUTOLAUNCH=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install) INSTALL=true; shift ;;
    --force) FORCE=true; shift ;;
    --sign-identity) SIGN_IDENTITY="$2"; shift 2 ;;
    --enable-autolaunch) ENABLE_AUTOLAUNCH=true; shift ;;
    --disable-autolaunch) DISABLE_AUTOLAUNCH=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Handle autolaunch toggle (no build needed)
LAUNCH_AGENT_DEST="$HOME/Library/LaunchAgents/com.a-company.paradigm.conductor.plist"
if $DISABLE_AUTOLAUNCH; then
  if [ -f "$LAUNCH_AGENT_DEST" ]; then
    launchctl unload "$LAUNCH_AGENT_DEST" 2>/dev/null || true
    rm -f "$LAUNCH_AGENT_DEST"
    echo "✓ Auto-launch disabled"
  else
    echo "Auto-launch was not enabled"
  fi
  exit 0
fi

# ── Step 1: Read version ──────────────────────────────────────────
VERSION=$(cat "$SCRIPT_DIR/VERSION" | tr -d '[:space:]')
BUILD_NUMBER=$(cd "$SCRIPT_DIR/../.." && git rev-list --count HEAD 2>/dev/null || echo "1")
echo "Building Conductor $VERSION (build $BUILD_NUMBER)..."

# ── Step 2: Swift build ──────────────────────────────────────────
echo "  Compiling (release)..."
cd "$SCRIPT_DIR"
swift build -c release 2>&1 | tail -1

BINARY="$SCRIPT_DIR/.build/release/Conductor"
if [ ! -f "$BINARY" ]; then
  echo "ERROR: Build failed — binary not found at $BINARY"
  exit 1
fi

# ── Step 3: Create .app bundle ────────────────────────────────────
echo "  Creating app bundle..."
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_MACOS" "$APP_RESOURCES"

# Copy binary
cp "$BINARY" "$APP_MACOS/Conductor"

# Generate Info.plist with version substitution
sed -e "s/__VERSION__/$VERSION/g" \
    -e "s/__BUILD_NUMBER__/$BUILD_NUMBER/g" \
    "$SCRIPT_DIR/Resources/Info.plist" > "$APP_CONTENTS/Info.plist"

# Copy icon (if available)
if [ -f "$SCRIPT_DIR/Resources/AppIcon.icns" ]; then
  cp "$SCRIPT_DIR/Resources/AppIcon.icns" "$APP_RESOURCES/AppIcon.icns"
elif [ -f "$SCRIPT_DIR/Resources/AppIcon.png" ]; then
  echo "  Generating icon from PNG..."
  ICONSET_DIR="$BUILD_DIR/AppIcon.iconset"
  mkdir -p "$ICONSET_DIR"
  sips -z 16 16     "$SCRIPT_DIR/Resources/AppIcon.png" --out "$ICONSET_DIR/icon_16x16.png"     >/dev/null
  sips -z 32 32     "$SCRIPT_DIR/Resources/AppIcon.png" --out "$ICONSET_DIR/icon_16x16@2x.png"  >/dev/null
  sips -z 32 32     "$SCRIPT_DIR/Resources/AppIcon.png" --out "$ICONSET_DIR/icon_32x32.png"     >/dev/null
  sips -z 64 64     "$SCRIPT_DIR/Resources/AppIcon.png" --out "$ICONSET_DIR/icon_32x32@2x.png"  >/dev/null
  sips -z 128 128   "$SCRIPT_DIR/Resources/AppIcon.png" --out "$ICONSET_DIR/icon_128x128.png"   >/dev/null
  sips -z 256 256   "$SCRIPT_DIR/Resources/AppIcon.png" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
  sips -z 256 256   "$SCRIPT_DIR/Resources/AppIcon.png" --out "$ICONSET_DIR/icon_256x256.png"   >/dev/null
  sips -z 512 512   "$SCRIPT_DIR/Resources/AppIcon.png" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
  sips -z 512 512   "$SCRIPT_DIR/Resources/AppIcon.png" --out "$ICONSET_DIR/icon_512x512.png"   >/dev/null
  sips -z 1024 1024 "$SCRIPT_DIR/Resources/AppIcon.png" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null
  iconutil -c icns "$ICONSET_DIR" -o "$APP_RESOURCES/AppIcon.icns"
  rm -rf "$ICONSET_DIR"
fi

# Copy SwiftPM resource bundle if present
RESOURCE_BUNDLE="$SCRIPT_DIR/.build/release/Conductor_Conductor.bundle"
if [ -d "$RESOURCE_BUNDLE" ]; then
  cp -R "$RESOURCE_BUNDLE" "$APP_RESOURCES/"
fi

# ── Step 4: Code sign ─────────────────────────────────────────────
echo "  Signing..."
SIGN_OPTS="--force --deep --sign $SIGN_IDENTITY --entitlements $SCRIPT_DIR/Conductor.entitlements"
if [ "$SIGN_IDENTITY" != "-" ]; then
  SIGN_OPTS="$SIGN_OPTS --options runtime"
fi
codesign $SIGN_OPTS "$APP_BUNDLE"

# ── Step 5: Install (optional) ────────────────────────────────────
if $INSTALL; then
  INSTALL_PATH="/Applications/Conductor.app"

  # Check if running
  if pgrep -f "Conductor.app/Contents/MacOS/Conductor" >/dev/null 2>&1; then
    if $FORCE; then
      echo "  Stopping running Conductor..."
      pkill -f "Conductor.app/Contents/MacOS/Conductor" 2>/dev/null || true
      sleep 2
    else
      echo "  WARNING: Conductor is running. Use --force to kill it, or quit manually."
      echo "  Built at: $APP_BUNDLE"
      exit 0
    fi
  fi

  echo "  Installing to $INSTALL_PATH..."
  rm -rf "$INSTALL_PATH"
  cp -R "$APP_BUNDLE" "$INSTALL_PATH"
  echo "  ✓ Installed"
fi

# ── Step 6: Enable auto-launch (optional) ─────────────────────────
if $ENABLE_AUTOLAUNCH; then
  mkdir -p "$(dirname "$LAUNCH_AGENT_DEST")"
  cp "$SCRIPT_DIR/Resources/com.a-company.paradigm.conductor.plist" "$LAUNCH_AGENT_DEST"
  launchctl load "$LAUNCH_AGENT_DEST" 2>/dev/null || true
  echo "  ✓ Auto-launch enabled (launches at login)"
fi

# ── Summary ───────────────────────────────────────────────────────
echo ""
echo "Conductor $VERSION (build $BUILD_NUMBER)"
echo "  Bundle: $APP_BUNDLE"
echo "  Signing: $([ "$SIGN_IDENTITY" = "-" ] && echo "ad-hoc" || echo "$SIGN_IDENTITY")"
if $INSTALL; then
  echo "  Installed: /Applications/Conductor.app"
fi
echo ""
echo "To launch: open $APP_BUNDLE"
echo "To update: git pull && ./build-conductor.sh --install"
